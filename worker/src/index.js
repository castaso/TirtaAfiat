// Tirta Afiat - Booking API (Cloudflare Worker + D1)
// Deploy: wrangler deploy
// Local dev: wrangler dev

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  'Access-Control-Max-Age': '86400',
};

const PROGRAMS = ['Les Renang', 'Hydro Therapy', 'Zen-Flow Yoga', 'Pemulihan Cair'];

function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...CORS_HEADERS },
  });
}

function isAdmin(request, env) {
  const auth = request.headers.get('Authorization') || '';
  return auth === `Bearer ${env.ADMIN_TOKEN}`;
}

const isDate = (s) => /^\d{4}-\d{2}-\d{2}$/.test(s);
const isTime = (s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s);

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, '');

    try {
      // ---- Availability lookup (public) ----
      if (path === '/api/availability') {
        const month = url.searchParams.get('month');
        const date = url.searchParams.get('date');

        if (month && isDate(month + '-01')) {
          const prefix = month + '%';
          const [holidays, booked] = await Promise.all([
            env.DB.prepare('SELECT date FROM holidays WHERE date LIKE ?').bind(prefix).all(),
            env.DB.prepare('SELECT date, time FROM bookings WHERE date LIKE ?').bind(prefix).all(),
          ]);
          return json({
            month,
            holidays: holidays.results.map((r) => r.date),
            booked: booked.results,
          });
        }

        if (date && isDate(date)) {
          const [holiday, booked] = await Promise.all([
            env.DB.prepare('SELECT date FROM holidays WHERE date = ?').bind(date).first(),
            env.DB.prepare('SELECT time FROM bookings WHERE date = ?').bind(date).all(),
          ]);
          return json({
            date,
            isHoliday: !!holiday,
            bookedTimes: booked.results.map((r) => r.time),
          });
        }

        return json({ error: 'Parameter month atau date tidak valid' }, 400);
      }

      // ---- Create booking (public) ----
      if (path === '/api/bookings' && request.method === 'POST') {
        const body = await request.json().catch(() => null);
        if (!body) return json({ error: 'Body JSON tidak valid' }, 400);

        const { name, email, phone, program, date, time } = body;
        if (!name || !email || !program || !isDate(date) || !isTime(time)) {
          return json({ error: 'Data tidak lengkap atau tidak valid' }, 400);
        }
        if (!PROGRAMS.includes(program)) {
          return json({ error: 'Program tidak dikenali' }, 400);
        }
        if (new Date(date) < new Date(new Date().toISOString().slice(0, 10))) {
          return json({ error: 'Tidak bisa booking di masa lalu' }, 400);
        }

        const holiday = await env.DB.prepare('SELECT date FROM holidays WHERE date = ?').bind(date).first();
        if (holiday) return json({ error: 'Tanggal tersebut libur' }, 409);

        const taken = await env.DB.prepare(
          'SELECT id FROM bookings WHERE date = ? AND time = ?'
        ).bind(date, time).first();
        if (taken) return json({ error: 'Slot waktu sudah dibooking' }, 409);

        const res = await env.DB.prepare(
          'INSERT INTO bookings (name, email, phone, program, date, time) VALUES (?, ?, ?, ?, ?, ?)'
        ).bind(name, email, phone || null, program, date, time).run();

        return json({ ok: true, id: res.meta.last_row_id });
      }

      // ---- Admin: list bookings ----
      if (path === '/api/bookings' && request.method === 'GET') {
        if (!isAdmin(request, env)) return json({ error: 'Tidak berizin' }, 401);
        const res = await env.DB.prepare('SELECT * FROM bookings ORDER BY date, time').all();
        return json({ bookings: res.results });
      }

      // ---- Admin: cancel booking ----
      if (path === '/api/bookings' && request.method === 'DELETE') {
        if (!isAdmin(request, env)) return json({ error: 'Tidak berizin' }, 401);
        const id = url.searchParams.get('id');
        await env.DB.prepare('DELETE FROM bookings WHERE id = ?').bind(id).run();
        return json({ ok: true });
      }

      // ---- Admin: manage holidays ----
      if (path === '/api/holidays') {
        if (!isAdmin(request, env)) return json({ error: 'Tidak berizin' }, 401);

        if (request.method === 'GET') {
          const res = await env.DB.prepare('SELECT date FROM holidays ORDER BY date').all();
          return json({ holidays: res.results.map((r) => r.date) });
        }

        if (request.method === 'POST') {
          const body = await request.json().catch(() => null);
          if (!body || !isDate(body.date)) return json({ error: 'Tanggal tidak valid' }, 400);
          await env.DB.prepare('INSERT OR IGNORE INTO holidays (date) VALUES (?)').bind(body.date).run();
          return json({ ok: true });
        }

        if (request.method === 'DELETE') {
          const date = url.searchParams.get('date');
          if (!isDate(date)) return json({ error: 'Tanggal tidak valid' }, 400);
          await env.DB.prepare('DELETE FROM holidays WHERE date = ?').bind(date).run();
          return json({ ok: true });
        }
      }

      return json({ error: 'Rute tidak ditemukan' }, 404);
    } catch (err) {
      return json({ error: 'Internal server error' }, 500);
    }
  },
};
