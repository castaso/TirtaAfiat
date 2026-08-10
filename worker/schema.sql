-- Skema database D1 untuk Tirta Afiat booking
-- Jalankan: wrangler d1 execute tirta-afiat --local --file=./schema.sql

DROP TABLE IF EXISTS bookings;
DROP TABLE IF EXISTS holidays;

CREATE TABLE bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  program TEXT NOT NULL,
  date TEXT NOT NULL,            -- format YYYY-MM-DD
  time TEXT NOT NULL,            -- format HH:MM
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE INDEX idx_bookings_date ON bookings(date);

CREATE TABLE holidays (
  date TEXT PRIMARY KEY          -- format YYYY-MM-DD
);
