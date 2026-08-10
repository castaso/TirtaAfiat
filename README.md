# Tirta Afiat — Calendar Booking (Calendly-style)

Landing page aqua-gym Tirta Afiat dengan widget booking sesi gratis ala Calendly:
pilih program → pilih tanggal di kalender → pilih slot waktu → isi data → konfirmasi.

## Struktur

```
index.html            Landing page + booking widget + panel admin
worker/               Backend API Cloudflare Worker + D1
  wrangler.toml       Konfigurasi Worker + binding D1
  schema.sql          Skema tabel bookings & holidays
  src/index.js        Implementasi API (availability, bookings, holidays)
```

## Cara kerja

- Frontend memanggil REST API Worker Cloudflare (endpoint `/api/*`).
- Data booking & tanggal libur disimpan di Cloudflare D1.
- Jika `API_BASE` kosong atau Worker belum ter-deploy, frontend otomatis
  memakai `localStorage` sebagai fallback agar flow tetap bisa dicoba.
- Panel admin (ikon gear di kartu booking) untuk melihat booking, membatalkan
  booking, dan mengelola tanggal libur. Token admin sama dengan `ADMIN_TOKEN`
  di `wrangler.toml`.

## Deploy backend (Cloudflare Worker + D1)

Prasyarat: akun Cloudflare, `npm i -g wrangler`, sudah login (`wrangler login`).

```bash
cd worker

# 1. Buat database D1
wrangler d1 create tirta-afiat

# 2. Salin Database ID dari output, isi ke wrangler.toml (database_id)

# 3. Buat tabel (remote)
wrangler d1 execute tirta-afiat --remote --file=./schema.sql

# 4. (Opsional) set token admin, atau ubah langsung di wrangler.toml
wrangler secret put ADMIN_TOKEN

# 5. Deploy
wrangler deploy
```

Setelah deploy, Worker mendapatkan URL seperti
`https://tirta-afiat-booking.<subdomain>.workers.dev`.

### Menghubungkan ke frontend

Buka `index.html`, ubah konstanta:

```js
const API_BASE = 'https://tirta-afiat-booking.<subdomain>.workers.dev';
```

Token admin default di `wrangler.toml` & fallback lokal: `admin123`.
Sesuaikan sebelum produksi.

### Pengembangan lokal Worker

```bash
cd worker
wrangler d1 execute tirta-afiat --local --file=./schema.sql
wrangler dev
```

## API

| Method | Path | Deskripsi | Auth |
| ------ | ---- | --------- | ---- |
| GET | `/api/availability?month=YYYY-MM` | Libur + booking bulan tsb | - |
| GET | `/api/availability?date=YYYY-MM-DD` | Cek hari libur & slot terisi | - |
| POST | `/api/bookings` | Buat booking baru | - |
| GET | `/api/bookings` | Daftar semua booking | Bearer |
| DELETE | `/api/bookings?id=N` | Batalkan booking | Bearer |
| GET | `/api/holidays` | Daftar tanggal libur | Bearer |
| POST | `/api/holidays` | Tambah tanggal libur | Bearer |
| DELETE | `/api/holidays?date=YYYY-MM-DD` | Hapus tanggal libur | Bearer |

Contoh booking:

```bash
curl -X POST https://<worker-url>/api/bookings \
  -H "Content-Type: application/json" \
  -d '{"name":"Elena","email":"elena@mail.com","phone":"+62 812-0000","program":"Aqua-Power HIIT","date":"2026-08-15","time":"09:00"}'
```
