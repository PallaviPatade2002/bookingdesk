-- Multi-tenant schema: every business (tenant) has its own users, services, staff, bookings and settings.

CREATE TABLE IF NOT EXISTS businesses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'other',
  active INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- role 'platform' = the person who runs the hosted app (business_id is NULL); 'staff' = a team member with a login
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  phone TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin','staff','platform')),
  notes TEXT,
  birthday TEXT,
  optout INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, phone)
);

CREATE TABLE IF NOT EXISTS settings (
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  value TEXT NOT NULL DEFAULT '',
  PRIMARY KEY (business_id, key)
);

-- mode: 'slot' = booked for a time, 'day' = booked for the whole day, 'quote' = customer sends an enquiry
CREATE TABLE IF NOT EXISTS services (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  category TEXT NOT NULL DEFAULT 'Other',
  image_url TEXT,
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  price REAL NOT NULL DEFAULT 0,
  mode TEXT NOT NULL DEFAULT 'slot' CHECK (mode IN ('slot','day','quote')),
  ask_venue INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_services_business ON services(business_id);

-- dow: 0 = Sunday ... 6 = Saturday. Minutes since midnight. open_min NULL = closed that day.
CREATE TABLE IF NOT EXISTS business_hours (
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  dow INTEGER NOT NULL CHECK (dow BETWEEN 0 AND 6),
  open_min INTEGER,
  close_min INTEGER,
  PRIMARY KEY (business_id, dow)
);

CREATE TABLE IF NOT EXISTS holidays (
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  reason TEXT,
  PRIMARY KEY (business_id, date)
);

-- team members. days_off is a comma list of weekdays (0 = Sunday ... 6 = Saturday); commission is a percent of service sales
CREATE TABLE IF NOT EXISTS staff (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  title TEXT,
  photo_url TEXT,
  days_off TEXT NOT NULL DEFAULT '',
  commission_pct REAL NOT NULL DEFAULT 0,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  active INTEGER NOT NULL DEFAULT 1
);
CREATE INDEX IF NOT EXISTS idx_staff_business ON staff(business_id);

CREATE TABLE IF NOT EXISTS staff_services (
  staff_id INTEGER NOT NULL REFERENCES staff(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (staff_id, service_id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  staff_id INTEGER REFERENCES staff(id),
  date TEXT NOT NULL,
  start_min INTEGER NOT NULL,
  end_min INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'booked' CHECK (status IN ('booked','completed','cancelled','no_show')),
  note TEXT,
  venue TEXT,
  guests INTEGER,
  price REAL,
  coupon_code TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_bookings_date ON bookings(business_id, date);
CREATE INDEX IF NOT EXISTS idx_bookings_staff ON bookings(staff_id, date);

CREATE TABLE IF NOT EXISTS reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  booking_id INTEGER NOT NULL UNIQUE REFERENCES bookings(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  staff_id INTEGER REFERENCES staff(id),
  rating INTEGER NOT NULL CHECK (rating BETWEEN 1 AND 5),
  comment TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS coupons (
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  code TEXT NOT NULL,
  percent INTEGER NOT NULL CHECK (percent BETWEEN 1 AND 90),
  expires TEXT,
  active INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (business_id, code)
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  text TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);

-- ---------- billing ----------
CREATE TABLE IF NOT EXISTS products (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  price REAL NOT NULL DEFAULT 0,
  stock INTEGER NOT NULL DEFAULT 0,
  active INTEGER NOT NULL DEFAULT 1
);

-- a package sells N sessions (of one service, or any) valid for some days
CREATE TABLE IF NOT EXISTS packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  price REAL NOT NULL,
  sessions INTEGER NOT NULL CHECK (sessions > 0),
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  valid_days INTEGER NOT NULL DEFAULT 365,
  active INTEGER NOT NULL DEFAULT 1
);

CREATE TABLE IF NOT EXISTS customer_packages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  package_id INTEGER REFERENCES packages(id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  service_id INTEGER REFERENCES services(id) ON DELETE SET NULL,
  sessions_left INTEGER NOT NULL,
  expires TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS invoices (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  number INTEGER NOT NULL,
  booking_id INTEGER REFERENCES bookings(id) ON DELETE SET NULL,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  subtotal REAL NOT NULL,
  discount REAL NOT NULL DEFAULT 0,
  tax REAL NOT NULL DEFAULT 0,
  tax_percent REAL NOT NULL DEFAULT 0,
  tip REAL NOT NULL DEFAULT 0,
  total REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE (business_id, number)
);
CREATE INDEX IF NOT EXISTS idx_invoices_user ON invoices(business_id, user_id);

CREATE TABLE IF NOT EXISTS invoice_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('service','product','package','custom')),
  ref_id INTEGER,
  name TEXT NOT NULL,
  qty INTEGER NOT NULL DEFAULT 1,
  price REAL NOT NULL,
  staff_id INTEGER REFERENCES staff(id)
);

CREATE TABLE IF NOT EXISTS payments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  invoice_id INTEGER NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  amount REAL NOT NULL CHECK (amount > 0),
  method TEXT NOT NULL CHECK (method IN ('cash','upi','card','package')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_payments_invoice ON payments(invoice_id);

-- ---------- messages (reminders, offers, one-time codes) ----------
-- status: queued -> sending -> sent (provider accepted) | logged (no provider configured, test mode) | failed
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  phone TEXT NOT NULL,
  text TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'info',
  booking_id INTEGER,
  status TEXT NOT NULL DEFAULT 'queued',
  error TEXT,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_messages_business ON messages(business_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_messages_reminder ON messages(booking_id, kind) WHERE kind = 'reminder';

CREATE TABLE IF NOT EXISTS otps (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash TEXT NOT NULL,
  expires_at INTEGER NOT NULL,
  attempts INTEGER NOT NULL DEFAULT 0,
  used INTEGER NOT NULL DEFAULT 0
);

-- ---------- enquiries (for services priced by quote) and gallery ----------
CREATE TABLE IF NOT EXISTS enquiries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  service_id INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  date TEXT NOT NULL,
  details TEXT,
  venue TEXT,
  guests INTEGER,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','quoted','confirmed','declined')),
  quote_price REAL,
  reply TEXT,
  booking_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_enquiries_business ON enquiries(business_id, status);

CREATE TABLE IF NOT EXISTS gallery (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  business_id INTEGER NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
  url TEXT NOT NULL,
  caption TEXT,
  sort INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_gallery_business ON gallery(business_id);
