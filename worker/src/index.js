/**
 * Tirta Afiat Booking API — Cloudflare Worker + D1
 *
 * Endpoints:
 *   GET  /api/availability?month=YYYY-MM   — holidays + booked slots for a month
 *   GET  /api/availability?date=YYYY-MM-DD — check if date is holiday & booked times
 *   POST /api/bookings                     — create a new booking (also sends Telegram notification)
 *   GET  /api/bookings                     — list all bookings (requires Bearer token)
 *   DELETE /api/bookings?id=N              — cancel a booking (requires Bearer token)
 *   GET  /api/holidays                     — list holidays (requires Bearer token)
 *   POST /api/holidays                     — add a holiday (requires Bearer token)
 *   DELETE /api/holidays?date=YYYY-MM-DD   — remove a holiday (requires Bearer token)
 *
 * Required secrets:
 *   ADMIN_TOKEN  — admin auth token
 *   TELEGRAM_BOT_TOKEN — Telegram Bot API token
 *   TELEGRAM_CHAT_ID   — Telegram chat/group ID to notify
 */

export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const path = url.pathname;

    // CORS headers
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    };

    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders });
    }

    try {
      let response;

      if (path === '/api/availability') {
        response = await handleAvailability(request, env);
      } else if (path === '/api/bookings') {
        response = await handleBookings(request, env);
      } else if (path === '/api/holidays') {
        response = await handleHolidays(request, env);
      } else {
        response = json({ error: 'Not found' }, 404);
      }

      // Add CORS headers to response
      const newResponse = new Response(response.body, response);
      for (const [key, value] of Object.entries(corsHeaders)) {
        newResponse.headers.set(key, value);
      }
      return newResponse;
    } catch (err) {
      console.error('Worker error:', err);
      return json({ error: err.message || 'Internal error' }, 500, corsHeaders);
    }
  }
};

// ─── Helpers ───────────────────────────────────────────────────────────────────

function json(data, status = 200, extraHeaders = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...extraHeaders }
  });
}

function authCheck(request, env) {
  const auth = request.headers.get('Authorization') || '';
  const token = auth.replace(/^Bearer\s+/i, '').trim();
  return token && token === env.ADMIN_TOKEN;
}

// ─── Telegram Notification ──────────────────────────────────────────────────────

async function sendTelegramNotification(env, booking) {
  const botToken = env.TELEGRAM_BOT_TOKEN;
  const chatId = env.TELEGRAM_CHAT_ID;

  if (!botToken || !chatId) {
    console.log('Telegram not configured — skipping notification');
    return;
  }

  const dayNames = ['Min', 'Sen', 'Sel', 'Rab', 'Kam', 'Jum', 'Sab'];
  const monthNames = [
    'Januari', 'Februari', 'Maret', 'April', 'Mei', 'Juni',
    'Juli', 'Agustus', 'September', 'Oktober', 'November', 'Desember'
  ];

  const [y, m, d] = booking.date.split('-').map(Number);
  const dateObj = new Date(y, m - 1, d);
  const dayName = dayNames[dateObj.getDay()];
  const monthName = monthNames[m - 1];
  const formattedDate = `${dayName}, ${d} ${monthName} ${y}`;

  const message =
    `🏊 *Booking Baru — Tirta Afiat* 🏊\n\n` +
    `👤 *Nama:* ${booking.name}\n` +
    `📧 *Email:* ${booking.email}\n` +
    `📱 *Telepon:* ${booking.phone}\n` +
    `🎯 *Program:* ${booking.program}\n` +
    `📅 *Tanggal:* ${formattedDate}\n` +
    `⏰ *Jam:* ${booking.time}\n\n` +
    `_Dikonfirmasi otomatis via website._`;

  try {
    const res = await fetch(
      `https://api.telegram.org/bot${botToken}/sendMessage`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          chat_id: chatId,
          text: message,
          parse_mode: 'Markdown'
        })
      }
    );

    if (!res.ok) {
      const errBody = await res.text();
      console.error('Telegram API error:', res.status, errBody);
    }
  } catch (err) {
    console.error('Failed to send Telegram notification:', err.message);
  }
}

// ─── Availability ───────────────────────────────────────────────────────────────

async function handleAvailability(request, env) {
  const url = new URL(request.url);
  const month = url.searchParams.get('month');
  const date = url.searchParams.get('date');

  if (month) {
    const holidays = await env.DB.prepare(
      `SELECT date FROM holidays WHERE date LIKE ? || '%'`
    ).bind(month).all();

    const booked = await env.DB.prepare(
      `SELECT date, time FROM bookings WHERE date LIKE ? || '%'`
    ).bind(month).all();

    return json({
      month,
      holidays: holidays.results.map(r => r.date),
      booked: booked.results.map(r => ({ date: r.date, time: r.time }))
    });
  }

  if (date) {
    const holiday = await env.DB.prepare(
      `SELECT date FROM holidays WHERE date = ?`
    ).bind(date).first();

    const booked = await env.DB.prepare(
      `SELECT time FROM bookings WHERE date = ?`
    ).bind(date).all();

    return json({
      date,
      isHoliday: !!holiday,
      bookedTimes: booked.results.map(r => r.time)
    });
  }

  return json({ error: 'Provide month or date parameter' }, 400);
}

// ─── Bookings ──────────────────────────────────────────────────────────────────

async function handleBookings(request, env) {
  const url = new URL(request.url);

  // GET — list all bookings (admin only)
  if (request.method === 'GET') {
    if (!authCheck(request, env)) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const rows = await env.DB.prepare(
      `SELECT * FROM bookings ORDER BY date ASC, time ASC`
    ).all();

    return json({ bookings: rows.results });
  }

  // DELETE — cancel a booking (admin only)
  if (request.method === 'DELETE') {
    if (!authCheck(request, env)) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const id = url.searchParams.get('id');
    if (!id) return json({ error: 'Missing id parameter' }, 400);

    await env.DB.prepare(`DELETE FROM bookings WHERE id = ?`).bind(Number(id)).run();
    return json({ ok: true });
  }

  // POST — create a new booking
  if (request.method === 'POST') {
    const body = await request.json();
    const { name, email, phone, program, date, time } = body;

    if (!name || !email || !phone || !program || !date || !time) {
      return json({ error: 'All fields are required' }, 400);
    }

    // Check if date is a holiday
    const holiday = await env.DB.prepare(
      `SELECT date FROM holidays WHERE date = ?`
    ).bind(date).first();

    if (holiday) {
      return json({ error: 'Tanggal tersebut libur' }, 400);
    }

    // Check if slot is already booked
    const existing = await env.DB.prepare(
      `SELECT id FROM bookings WHERE date = ? AND time = ?`
    ).bind(date, time).first();

    if (existing) {
      return json({ error: 'Slot waktu sudah dibooking' }, 409);
    }

    // Create the booking
    const result = await env.DB.prepare(
      `INSERT INTO bookings (name, email, phone, program, date, time)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).bind(name, email, phone, program, date, time).run();

    const booking = { name, email, phone, program, date, time };

    // Send Telegram notification (non-blocking)
    await sendTelegramNotification(env, booking);

    return json({ ok: true, id: result.meta.last_row_id }, 201);
  }

  return json({ error: 'Method not allowed' }, 405);
}

// ─── Holidays ──────────────────────────────────────────────────────────────────

async function handleHolidays(request, env) {
  const url = new URL(request.url);

  // GET — list holidays
  if (request.method === 'GET') {
    if (!authCheck(request, env)) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const rows = await env.DB.prepare(
      `SELECT date FROM holidays ORDER BY date ASC`
    ).all();

    return json({ holidays: rows.results.map(r => r.date) });
  }

  // POST — add a holiday
  if (request.method === 'POST') {
    if (!authCheck(request, env)) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const body = await request.json();
    const { date } = body;
    if (!date) return json({ error: 'Missing date' }, 400);

    await env.DB.prepare(
      `INSERT OR IGNORE INTO holidays (date) VALUES (?)`
    ).bind(date).run();

    return json({ ok: true });
  }

  // DELETE — remove a holiday
  if (request.method === 'DELETE') {
    if (!authCheck(request, env)) {
      return json({ error: 'Unauthorized' }, 401);
    }

    const date = url.searchParams.get('date');
    if (!date) return json({ error: 'Missing date parameter' }, 400);

    await env.DB.prepare(`DELETE FROM holidays WHERE date = ?`).bind(date).run();
    return json({ ok: true });
  }

  return json({ error: 'Method not allowed' }, 405);
}
