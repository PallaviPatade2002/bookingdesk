const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const db = require('./db');
const { sign, requireAuth } = require('./auth');
const tenant = require('./tenant');
const { icon } = require('./icon');

// One-business mode: set SINGLE_BUSINESS=<slug> and the site serves only that business at the root address
const SINGLE = /^[a-z0-9-]+$/.test(process.env.SINGLE_BUSINESS || '') ? process.env.SINGLE_BUSINESS : null;

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1);
app.use(cors());
app.use(express.json({ limit: '100kb' }));
app.use((req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'strict-origin-when-cross-origin' }); // OpenStreetMap tiles need a Referer, or they answer 403
  next();
});

if (SINGLE) {
  // the platform parts (sign-up, directory, platform admin) and every other business are switched off
  app.use('/api', (req, res, next) => {
    const p = req.path;
    if (/^\/(signup|directory|platform|types|slug-check)/.test(p)) return res.status(404).json({ error: 'Not found' });
    if (p.startsWith('/b/') && p.split('/')[2] !== SINGLE) return res.status(404).json({ error: 'Business not found' });
    next();
  });
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const STATUSES = ['booked', 'completed', 'cancelled', 'no_show'];
const SLOT_STEP = 15; // minutes between possible start times

const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
const toTime = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const isDate = (d) => DATE_RE.test(d || '') && !Number.isNaN(Date.parse(d + 'T00:00:00Z'));
const dow = (d) => new Date(d + 'T00:00:00Z').getUTCDay();
const pad = (n) => String(n).padStart(2, '0');
const todayStr = () => {
  const n = new Date();
  return `${n.getFullYear()}-${pad(n.getMonth() + 1)}-${pad(n.getDate())}`;
};
const nowMin = () => {
  const n = new Date();
  return n.getHours() * 60 + n.getMinutes();
};
const str = (v, max) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
// image links must be same-site paths or http(s) URLs
const okImage = (v) => !v || (typeof v === 'string' && v.length <= 500 && /^(https?:\/\/|\/(?!\/))/.test(v));
const bad = (res, msg) => res.status(400).json({ error: msg });
// throw httpError(409, 'message') anywhere (also inside tx) and the client gets that status and message
const httpError = (status, message) => Object.assign(new Error(message), { status });
// run several statements as one unit: all succeed or none do
const tx = (fn) => {
  db.exec('BEGIN');
  try {
    const r = fn();
    db.exec('COMMIT');
    return r;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};

// map pin: empty means "not set"; otherwise a real latitude / longitude
const coordError = (b) => {
  for (const [k, max] of [['lat', 90], ['lng', 180]]) {
    if (k in b && b[k] !== '' && b[k] !== null) {
      const n = Number(b[k]);
      if (!Number.isFinite(n) || Math.abs(n) > max) return 'Map location is not valid';
    }
  }
  return null;
};
const km = (lat1, lng1, lat2, lng2) => {
  const r = (d) => (d * Math.PI) / 180;
  const h = Math.sin(r(lat2 - lat1) / 2) ** 2 + Math.cos(r(lat1)) * Math.cos(r(lat2)) * Math.sin(r(lng2 - lng1) / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.sqrt(h));
};
const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

// ---------- Simple in-memory rate limits ----------
function limiter(max, windowMs, message) {
  const hits = new Map();
  return (req, res, next) => {
    const now = Date.now();
    const rec = (hits.get(req.ip) || []).filter((t) => now - t < windowMs);
    if (rec.length >= max) return res.status(429).json({ error: message });
    rec.push(now);
    hits.set(req.ip, rec);
    next();
  };
}
const authLimit = limiter(30, 15 * 60 * 1000, 'Too many attempts. Try again in a few minutes.');
const signupLimit = limiter(Number(process.env.SIGNUP_LIMIT) || 10, 60 * 60 * 1000, 'Too many sign-ups from this network. Try again later.');

// ---------- In-app notifications ----------
const notify = (userId, text) => run('INSERT INTO notifications (user_id, text) VALUES (?,?)', userId, text);
const notifyAdmins = (bid, text) => all("SELECT id FROM users WHERE business_id = ? AND role = 'admin'", bid).forEach((a) => notify(a.id, text));
const userName = (id) => one('SELECT name FROM users WHERE id = ?', id)?.name || 'A customer';
const when = (date, startMin) => date + ' ' + toTime(startMin);

// Customers may only cancel or move a booking until cancel_hours before it starts
function tooLate(bid, b) {
  const hrs = Number(one("SELECT value FROM settings WHERE business_id = ? AND key = 'cancel_hours'", bid)?.value) || 0;
  const startsAt = new Date(b.date + 'T' + toTime(b.start_min) + ':00').getTime();
  return startsAt - Date.now() < hrs * 3600 * 1000 ? hrs : 0;
}
const lateMsg = (h) => 'Bookings can only be changed ' + h + ' hour' + (h === 1 ? '' : 's') + ' before the appointment. Please call us.';

// ---------- Staff / slot helpers ----------
const parseOff = (s) => (s ? s.split(',').map(Number) : []);
// public: only what customers need. admin: also commission and login details
const staffRow = (s, admin = false) => ({
  id: s.id,
  name: s.name,
  title: s.title,
  photo_url: s.photo_url,
  days_off: parseOff(s.days_off),
  active: s.active,
  service_ids: all('SELECT service_id FROM staff_services WHERE staff_id = ?', s.id).map((r) => r.service_id),
  ...(admin ? { commission_pct: s.commission_pct, login_phone: s.user_id ? one('SELECT phone FROM users WHERE id = ?', s.user_id)?.phone || null : null } : {}),
});

// length of a booking: a "full day" service takes the whole opening time of that day
const lengthOf = (bid, date, svc) => {
  if (svc.mode !== 'day') return svc.duration_min;
  const h = one('SELECT open_min, close_min FROM business_hours WHERE business_id = ? AND dow = ?', bid, dow(date));
  return h && h.open_min != null ? h.close_min - h.open_min : svc.duration_min;
};

const hasStaff = (serviceId) =>
  !!one('SELECT 1 FROM staff_services ss JOIN staff st ON st.id = ss.staff_id WHERE ss.service_id = ? AND st.active = 1', serviceId);

// Map of start time -> staff id (or null when the service has no staff) that can take the booking.
// A service with no staff attached behaves as one shared chair.
function slotInfo(bid, date, service, staffId, excludeId) {
  const out = new Map();
  if (service.mode === 'quote') return out; // booked through an enquiry, not a slot
  if (one('SELECT 1 FROM holidays WHERE business_id = ? AND date = ?', bid, date)) return out;
  const h = one('SELECT open_min, close_min FROM business_hours WHERE business_id = ? AND dow = ?', bid, dow(date));
  if (!h || h.open_min == null) return out;

  const day = all("SELECT id, staff_id, start_min, end_min FROM bookings WHERE business_id = ? AND date = ? AND status != 'cancelled'", bid, date).filter(
    (b) => b.id !== excludeId
  );
  let candidates;
  if (hasStaff(service.id)) {
    candidates = all(
      `SELECT st.id, st.days_off FROM staff st JOIN staff_services ss ON ss.staff_id = st.id
       WHERE ss.service_id = ? AND st.active = 1 AND st.business_id = ?`,
      service.id, bid
    )
      .filter((s) => !parseOff(s.days_off).includes(dow(date)))
      .map((s) => s.id);
    if (staffId) candidates = candidates.filter((id) => id === Number(staffId));
    // the person with the lightest day gets "any" bookings
    const load = (id) => day.filter((b) => b.staff_id === id).length;
    candidates.sort((a, b) => load(a) - load(b) || a - b);
  } else {
    candidates = [null];
  }

  const len = lengthOf(bid, date, service);
  for (let s = h.open_min; s + len <= h.close_min; s += SLOT_STEP) {
    const e = s + len;
    if (date < todayStr() || (date === todayStr() && s <= nowMin())) continue;
    for (const c of candidates) {
      const busy = day.filter((b) => (b.staff_id ?? null) === c);
      if (!busy.some((b) => s < b.end_min && e > b.start_min)) {
        out.set(toTime(s), c);
        break;
      }
    }
  }
  return out;
}

const view = (b) => ({ ...b, start: toTime(b.start_min), end: toTime(b.end_min) });

// =====================================================================
// Platform level: onboarding new businesses and the platform admin
// =====================================================================
app.get('/api/types', (req, res) => {
  res.json(Object.entries(tenant.TYPES).map(([id, t]) => ({ id, label: t.label })));
});

app.get('/api/slug-check', (req, res) => {
  const slug = tenant.slugify(req.query.slug);
  res.json({ slug, available: slug.length >= 3 && !tenant.slugTaken(slug) });
});

// Public directory: customers search businesses by name, city or type and by distance
app.get('/api/directory', (req, res) => {
  const q = str(req.query.q, 60).toLowerCase();
  const type = str(req.query.type, 20);
  const lat = req.query.lat === undefined ? NaN : Number(req.query.lat);
  const lng = req.query.lng === undefined ? NaN : Number(req.query.lng);
  const near = Number.isFinite(lat) && Number.isFinite(lng);

  let list = all('SELECT id, slug, name, type FROM businesses WHERE active = 1').map((b) => {
    const s = { ...tenant.DEFAULT_SETTINGS, ...Object.fromEntries(all('SELECT key, value FROM settings WHERE business_id = ?', b.id).map((r) => [r.key, r.value])) };
    const rating = one('SELECT COUNT(*) c, AVG(rating) a FROM reviews WHERE business_id = ?', b.id);
    const pr = one('SELECT MIN(price) p, COUNT(*) c FROM services WHERE business_id = ? AND active = 1', b.id);
    const pic = one("SELECT image_url FROM services WHERE business_id = ? AND active = 1 AND image_url IS NOT NULL AND image_url != '' LIMIT 1", b.id);
    const hasPin = s.lat !== '' && s.lng !== '' && Number.isFinite(Number(s.lat)) && Number.isFinite(Number(s.lng));
    return {
      slug: b.slug, name: b.name, type: b.type, tagline: s.tagline, city: s.city, address: s.address, listed: s.listed === '1',
      lat: hasPin ? Number(s.lat) : null, lng: hasPin ? Number(s.lng) : null,
      rating: rating.c ? Math.round(rating.a * 10) / 10 : null, rating_count: rating.c,
      from_price: pr.c ? pr.p : null, services: pr.c, image: pic?.image_url || null,
      distance_km: near && hasPin ? Math.round(km(lat, lng, Number(s.lat), Number(s.lng)) * 10) / 10 : null,
    };
  });
  list = list.filter((b) => b.listed && b.services > 0);
  if (type) list = list.filter((b) => b.type === type);
  if (q) list = list.filter((b) => [b.name, b.city, b.address, b.tagline].join(' ').toLowerCase().includes(q));
  list.sort((x, y) =>
    near ? (x.distance_km ?? 1e9) - (y.distance_km ?? 1e9) : (y.rating ?? 0) - (x.rating ?? 0) || x.name.localeCompare(y.name)
  );
  res.json(list.slice(0, 100).map(({ listed, ...b }) => b));
});

// A business owner registers: creates the business, the owner login and starter content
app.post('/api/signup', signupLimit, (req, res) => {
  const name = str(req.body.business_name, 60);
  const ownerName = str(req.body.owner_name, 80);
  const phone = str(req.body.phone, 20);
  const { password } = req.body;
  if (name.length < 2 || !ownerName || !phone || typeof password !== 'string' || password.length < 6) {
    return bad(res, 'Business name, your name, phone and a password (min 6 characters) are required');
  }
  let slug;
  if (req.body.slug) {
    slug = tenant.slugify(req.body.slug);
    if (slug.length < 3) return bad(res, 'Web address must be at least 3 letters or numbers');
    if (tenant.slugTaken(slug)) return res.status(409).json({ error: 'That web address is already taken' });
  } else {
    slug = tenant.uniqueSlug(name);
  }
  const locErr = coordError(req.body);
  if (locErr) return bad(res, locErr);
  const extra = {
    city: str(req.body.city, 60),
    address: str(req.body.address, 200),
    lat: req.body.lat === undefined || req.body.lat === '' || req.body.lat === null ? '' : String(Number(req.body.lat)),
    lng: req.body.lng === undefined || req.body.lng === '' || req.body.lng === null ? '' : String(Number(req.body.lng)),
    listed: req.body.listed === false ? '0' : '1',
  };
  const made = tenant.createBusiness({ name, slug, type: req.body.type, ownerName, phone, password, sample: req.body.sample !== false, extra });
  const user = { id: made.ownerId, role: 'admin', business_id: made.id };
  res.status(201).json({ slug, token: sign(user), user: { id: made.ownerId, name: ownerName, phone, role: 'admin' } });
});

app.post('/api/platform/login', authLimit, (req, res) => {
  const { phone, password } = req.body;
  const u = one("SELECT * FROM users WHERE business_id IS NULL AND role = 'platform' AND phone = ?", phone);
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) return res.status(401).json({ error: 'Wrong phone or password' });
  res.json({ token: sign(u), user: { id: u.id, name: u.name, phone: u.phone, role: 'platform' } });
});

app.get('/api/platform/businesses', requireAuth('platform'), (req, res) => {
  res.json(
    all(
      `SELECT b.id, b.slug, b.name, b.type, b.active, b.created_at,
         (SELECT u.name FROM users u WHERE u.business_id = b.id AND u.role = 'admin' ORDER BY u.id LIMIT 1) AS owner_name,
         (SELECT u.phone FROM users u WHERE u.business_id = b.id AND u.role = 'admin' ORDER BY u.id LIMIT 1) AS owner_phone,
         (SELECT COUNT(*) FROM users u WHERE u.business_id = b.id AND u.role = 'customer') AS customers,
         (SELECT COUNT(*) FROM bookings k WHERE k.business_id = b.id AND k.status != 'cancelled') AS bookings,
         (SELECT MAX(k.created_at) FROM bookings k WHERE k.business_id = b.id) AS last_booking_at
       FROM businesses b ORDER BY b.created_at DESC`
    )
  );
});

app.put('/api/platform/businesses/:id', requireAuth('platform'), (req, res) => {
  const r = run('UPDATE businesses SET active = ? WHERE id = ?', req.body.active ? 1 : 0, req.params.id);
  if (!r.changes) return res.status(404).json({ error: 'Business not found' });
  res.json({ ok: true });
});

// =====================================================================
// Business level: everything below lives under /api/b/:slug and only sees that business's data
// =====================================================================
const biz = express.Router({ mergeParams: true });
app.use(
  '/api/b/:slug',
  (req, res, next) => {
    const b = one('SELECT * FROM businesses WHERE slug = ?', req.params.slug);
    if (!b) return res.status(404).json({ error: 'Business not found' });
    if (!b.active) return res.status(403).json({ error: 'This business is currently unavailable' });
    req.biz = b;
    next();
  },
  biz
);

// ---------- Auth ----------
biz.post('/auth/register', authLimit, (req, res) => {
  const B = req.biz.id;
  const name = str(req.body.name, 80);
  const phone = str(req.body.phone, 20);
  const { password } = req.body;
  if (!name || !phone || typeof password !== 'string' || password.length < 6) {
    return bad(res, 'name, phone and password (min 6 chars) required');
  }
  if (one('SELECT id FROM users WHERE business_id = ? AND phone = ?', B, phone)) {
    return res.status(409).json({ error: 'Phone already registered' });
  }
  const r = run('INSERT INTO users (business_id, name, phone, password_hash) VALUES (?,?,?,?)', B, name, phone, bcrypt.hashSync(password, 10));
  const user = { id: Number(r.lastInsertRowid), role: 'customer', business_id: B };
  res.status(201).json({ token: sign(user), user: { id: user.id, role: 'customer', name, phone } });
});

biz.post('/auth/login', authLimit, (req, res) => {
  const { phone, password } = req.body;
  const u = one('SELECT * FROM users WHERE business_id = ? AND phone = ?', req.biz.id, phone);
  if (!u || !bcrypt.compareSync(password || '', u.password_hash)) {
    return res.status(401).json({ error: 'Wrong phone or password' });
  }
  res.json({ token: sign(u), user: { id: u.id, name: u.name, phone: u.phone, role: u.role } });
});

biz.get('/auth/me', requireAuth(), (req, res) => {
  const u = one('SELECT id, name, phone, role, birthday, optout FROM users WHERE id = ? AND business_id = ?', req.user.id, req.biz.id);
  if (!u) return res.status(401).json({ error: 'Login required' });
  res.json(u);
});

biz.put('/auth/profile', requireAuth(), (req, res) => {
  const name = str(req.body.name, 80);
  if (!name) return bad(res, 'Name is required');
  const cur = one('SELECT birthday, optout FROM users WHERE id = ?', req.user.id);
  let birthday = cur.birthday;
  if ('birthday' in req.body) {
    if (req.body.birthday && !isDate(req.body.birthday)) return bad(res, 'Birthday must be a date');
    birthday = req.body.birthday || null;
  }
  const optout = 'optout' in req.body ? (req.body.optout ? 1 : 0) : cur.optout;
  run('UPDATE users SET name = ?, birthday = ?, optout = ? WHERE id = ?', name, birthday, optout, req.user.id);
  res.json({ ok: true, name, birthday, optout });
});

biz.put('/auth/password', requireAuth(), authLimit, (req, res) => {
  const { current, next } = req.body;
  if (typeof next !== 'string' || next.length < 6) return bad(res, 'New password must be at least 6 characters');
  const u = one('SELECT * FROM users WHERE id = ?', req.user.id);
  if (!u || !bcrypt.compareSync(current || '', u.password_hash)) {
    return res.status(401).json({ error: 'Current password is wrong' });
  }
  run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(next, 10), u.id);
  res.json({ ok: true });
});

// ---------- Business settings ----------
const SETTING_KEYS = Object.keys(tenant.DEFAULT_SETTINGS);
const HEX = /^#[0-9a-fA-F]{6}$/;
const readSettings = (biz_) => {
  const s = {
    ...tenant.DEFAULT_SETTINGS,
    ...Object.fromEntries(all('SELECT key, value FROM settings WHERE business_id = ?', biz_.id).map((r) => [r.key, r.value])),
    slug: biz_.slug,
    type: biz_.type,
  };
  delete s.ical_key; // secret, only the owner's calendar link uses it
  // always return the colour and font that are actually in use
  const d = tenant.TYPE_THEME[biz_.type] || tenant.TYPE_THEME.other;
  if (!HEX.test(s.brand)) s.brand = d.brand;
  if (s.font !== 'serif' && s.font !== 'sans') s.font = d.font;
  return s;
};
const brandOf = (b) => readSettings(b).brand;

biz.get('/settings', (req, res) => res.json(readSettings(req.biz)));

biz.put('/settings', requireAuth('admin'), (req, res) => {
  const body = req.body || {};
  if ('name' in body && !str(body.name, 60)) return bad(res, 'Business name is required');
  const locErr = coordError(body);
  if (locErr) return bad(res, locErr);
  if ('brand' in body && body.brand !== '' && !HEX.test(body.brand)) return bad(res, 'Colour must look like #c9647a');
  if ('font' in body && !['', 'serif', 'sans'].includes(body.font)) return bad(res, 'Heading style must be serif or sans');
  if ('listed' in body) body.listed = body.listed === true || body.listed === '1' || body.listed === 1 ? '1' : '0';
  if ('cancel_hours' in body && !(Number.isInteger(Number(body.cancel_hours)) && Number(body.cancel_hours) >= 0 && Number(body.cancel_hours) <= 72)) {
    return bad(res, 'Cancellation window must be 0 to 72 hours');
  }
  if ('gst_percent' in body && !(Number(body.gst_percent) >= 0 && Number(body.gst_percent) <= 28)) return bad(res, 'GST must be 0 to 28 percent');
  if ('upi_id' in body && body.upi_id !== '' && !/^[\w.\-]{2,60}@[A-Za-z0-9]{2,30}$/.test(body.upi_id)) return bad(res, 'UPI ID must look like name@bank');
  if ('reminder_hours' in body && !(Number.isInteger(Number(body.reminder_hours)) && Number(body.reminder_hours) >= 0 && Number(body.reminder_hours) <= 72)) return bad(res, 'Reminder time must be 0 to 72 hours');
  if ('language' in body && !['en', 'mr', 'hi'].includes(body.language)) return bad(res, 'Language must be en, mr or hi');
  if ('invoice_prefix' in body && !/^[A-Za-z0-9-]{0,8}$/.test(String(body.invoice_prefix))) return bad(res, 'Invoice prefix: up to 8 letters or numbers');
  const up = db.prepare('INSERT INTO settings (business_id, key, value) VALUES (?,?,?) ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value');
  for (const k of SETTING_KEYS) if (k in body) up.run(req.biz.id, k, str(String(body[k] ?? ''), k === 'address' || k === 'tagline' || k === 'invoice_footer' ? 200 : 60));
  if ('name' in body) run('UPDATE businesses SET name = ? WHERE id = ?', str(body.name, 60), req.biz.id);
  res.json(readSettings(one('SELECT * FROM businesses WHERE id = ?', req.biz.id)));
});

// ---------- Services ----------
const serviceFields = (b, cur = {}) => {
  const n = { ...cur, ...b };
  const out = {
    name: str(n.name, 80),
    description: str(n.description, 300) || null,
    category: str(n.category, 40) || 'Other',
    image_url: n.image_url ? String(n.image_url).trim() : null,
    duration_min: Math.round(Number(n.duration_min)),
    price: Number(n.price),
    mode: ['slot', 'day', 'quote'].includes(n.mode) ? n.mode : 'slot',
    ask_venue: n.ask_venue ? 1 : 0,
    active: n.active ? 1 : 0,
  };
  if (!out.name || !(out.duration_min > 0) || out.duration_min > 720 || !(out.price >= 0)) return { error: 'name, duration_min (1-720) and price (>=0) required' };
  if (!okImage(out.image_url)) return { error: 'Image must be a link (https://...) or a /photos/... path' };
  return { v: out };
};

biz.get('/services', (req, res) => {
  res.json(all('SELECT * FROM services WHERE business_id = ? AND active = 1 ORDER BY category, name', req.biz.id));
});

biz.get('/services/all', requireAuth('admin'), (req, res) => {
  res.json(all('SELECT * FROM services WHERE business_id = ? ORDER BY category, name', req.biz.id));
});

biz.post('/services', requireAuth('admin'), (req, res) => {
  const { v, error } = serviceFields({ active: true, ...req.body });
  if (error) return bad(res, error);
  const r = run(
    'INSERT INTO services (business_id, name, description, category, image_url, duration_min, price, mode, ask_venue, active) VALUES (?,?,?,?,?,?,?,?,?,?)',
    req.biz.id, v.name, v.description, v.category, v.image_url, v.duration_min, v.price, v.mode, v.ask_venue, v.active
  );
  res.status(201).json({ id: Number(r.lastInsertRowid) });
});

biz.put('/services/:id', requireAuth('admin'), (req, res) => {
  const cur = one('SELECT * FROM services WHERE id = ? AND business_id = ?', req.params.id, req.biz.id);
  if (!cur) return res.status(404).json({ error: 'Service not found' });
  const { v, error } = serviceFields(req.body, cur);
  if (error) return bad(res, error);
  run('UPDATE services SET name=?, description=?, category=?, image_url=?, duration_min=?, price=?, mode=?, ask_venue=?, active=? WHERE id=?',
    v.name, v.description, v.category, v.image_url, v.duration_min, v.price, v.mode, v.ask_venue, v.active, cur.id);
  res.json({ ok: true });
});

// a service with booking history is hidden instead of deleted, so old records stay intact
biz.delete('/services/:id', requireAuth('admin'), (req, res) => {
  const cur = one('SELECT id FROM services WHERE id = ? AND business_id = ?', req.params.id, req.biz.id);
  if (!cur) return res.status(404).json({ error: 'Service not found' });
  if (one('SELECT 1 FROM bookings WHERE service_id = ?', cur.id)) {
    run('UPDATE services SET active = 0 WHERE id = ?', cur.id);
    return res.json({ ok: true, hidden: true });
  }
  run('DELETE FROM services WHERE id = ?', cur.id);
  res.json({ ok: true, deleted: true });
});

// ---------- Staff ----------
biz.get('/staff', (req, res) => {
  let rows = all('SELECT * FROM staff WHERE business_id = ? AND active = 1 ORDER BY name', req.biz.id).map((s) => staffRow(s));
  if (req.query.service_id) rows = rows.filter((s) => s.service_ids.includes(Number(req.query.service_id)));
  res.json(rows);
});

biz.get('/admin/staff', requireAuth('admin'), (req, res) => {
  res.json(all('SELECT * FROM staff WHERE business_id = ? ORDER BY active DESC, name', req.biz.id).map((s) => staffRow(s, true)));
});

const saveStaff = (res, bid, id, b, cur = {}) => {
  const name = str('name' in b ? b.name : cur.name, 60);
  if (!name) return bad(res, 'Name is required');
  const photo = 'photo_url' in b ? (b.photo_url ? String(b.photo_url).trim() : null) : cur.photo_url || null;
  if (!okImage(photo)) return bad(res, 'Photo must be a link (https://...) or a /photos/... path');
  const off = 'days_off' in b ? b.days_off : parseOff(cur.days_off);
  if (!Array.isArray(off) || off.some((d) => !Number.isInteger(d) || d < 0 || d > 6)) return bad(res, 'days_off must be weekday numbers 0-6');
  const title = str('title' in b ? b.title : cur.title, 60) || null;
  const active = 'active' in b ? (b.active ? 1 : 0) : cur.active ?? 1;
  const pct = 'commission_pct' in b ? Number(b.commission_pct) : Number(cur.commission_pct) || 0;
  if (!Number.isFinite(pct) || pct < 0 || pct > 100) return bad(res, 'Commission must be 0 to 100 percent');
  let ids = null;
  if ('service_ids' in b) {
    if (!Array.isArray(b.service_ids)) return bad(res, 'service_ids must be a list');
    ids = [...new Set(b.service_ids.map(Number))].filter((sid) => one('SELECT 1 FROM services WHERE id = ? AND business_id = ?', sid, bid));
  }
  const offStr = [...new Set(off)].sort().join(',');
  if (id == null) {
    id = Number(run('INSERT INTO staff (business_id, name, title, photo_url, days_off, commission_pct, active) VALUES (?,?,?,?,?,?,?)', bid, name, title, photo, offStr, pct, active).lastInsertRowid);
  } else {
    run('UPDATE staff SET name=?, title=?, photo_url=?, days_off=?, commission_pct=?, active=? WHERE id=?', name, title, photo, offStr, pct, active, id);
  }
  if (ids) {
    run('DELETE FROM staff_services WHERE staff_id = ?', id);
    const ins = db.prepare('INSERT INTO staff_services (staff_id, service_id) VALUES (?,?)');
    ids.forEach((sid) => ins.run(id, sid));
  }
  return id;
};

biz.post('/admin/staff', requireAuth('admin'), (req, res) => {
  const id = saveStaff(res, req.biz.id, null, req.body || {});
  if (res.headersSent) return;
  res.status(201).json({ id });
});

biz.put('/admin/staff/:id', requireAuth('admin'), (req, res) => {
  const cur = one('SELECT * FROM staff WHERE id = ? AND business_id = ?', req.params.id, req.biz.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  saveStaff(res, req.biz.id, cur.id, req.body || {}, cur);
  if (!res.headersSent) res.json({ ok: true });
});

biz.delete('/admin/staff/:id', requireAuth('admin'), (req, res) => {
  const cur = one('SELECT id FROM staff WHERE id = ? AND business_id = ?', req.params.id, req.biz.id);
  if (!cur) return res.status(404).json({ error: 'Not found' });
  if (one('SELECT 1 FROM bookings WHERE staff_id = ?', cur.id)) {
    run('UPDATE staff SET active = 0 WHERE id = ?', cur.id);
    return res.json({ ok: true, hidden: true });
  }
  run('DELETE FROM staff WHERE id = ?', cur.id);
  res.json({ ok: true, deleted: true });
});

// ---------- Slots ----------
biz.get('/slots', (req, res) => {
  const { date, service_id, staff_id, exclude } = req.query;
  if (!isDate(date)) return bad(res, 'date must be YYYY-MM-DD');
  const svc = one('SELECT * FROM services WHERE id = ? AND business_id = ? AND active = 1', service_id, req.biz.id);
  if (!svc) return res.status(404).json({ error: 'Service not found' });
  res.json({ date, slots: [...slotInfo(req.biz.id, date, svc, staff_id, exclude ? Number(exclude) : undefined).keys()] });
});

// ---------- Coupons ----------
function findCoupon(bid, raw) {
  const code = String(raw || '').trim().toUpperCase();
  const c = one('SELECT * FROM coupons WHERE business_id = ? AND code = ? AND active = 1', bid, code);
  if (!c || (c.expires && c.expires < todayStr())) return null;
  return c;
}

biz.get('/coupons/check', requireAuth(), (req, res) => {
  const c = findCoupon(req.biz.id, req.query.code);
  if (!c) return res.status(404).json({ error: 'That coupon is not valid or has expired' });
  res.json({ code: c.code, percent: c.percent });
});

// ---------- Bookings (customer) ----------
const BOOKING_SELECT = `SELECT b.*, (SELECT rating FROM reviews r WHERE r.booking_id = b.id) AS my_rating, (SELECT i.id FROM invoices i WHERE i.booking_id = b.id) AS invoice_id, s.name AS service_name,
    COALESCE(b.price, s.price) AS price, st.name AS staff_name
  FROM bookings b JOIN services s ON s.id = b.service_id LEFT JOIN staff st ON st.id = b.staff_id`;

biz.post('/bookings', requireAuth('customer'), (req, res) => {
  const B = req.biz.id;
  const { service_id, date, time, staff_id } = req.body;
  const note = str(req.body.note, 300);
  if (!isDate(date) || !TIME_RE.test(time || '')) return bad(res, 'date (YYYY-MM-DD) and time (HH:MM) required');
  const svc = one('SELECT * FROM services WHERE id = ? AND business_id = ? AND active = 1', service_id, B);
  if (!svc) return res.status(404).json({ error: 'Service not found' });
  if (svc.mode === 'quote') return res.status(409).json({ error: 'This service is booked by sending an enquiry for a quote' });
  const venue = str(req.body.venue, 200);
  const guests = req.body.guests ? Math.round(Number(req.body.guests)) : null;
  if (svc.ask_venue && !venue) return bad(res, 'Please enter the address or venue');
  if (guests !== null && !(guests >= 1 && guests <= 100000)) return bad(res, 'Guests must be a number');
  // node:sqlite is synchronous, so the check and insert below cannot interleave with another request
  const info = slotInfo(B, date, svc, staff_id);
  if (!info.has(time)) {
    return res.status(409).json({ error: 'That time is not available. Please pick another slot.' });
  }
  let price = svc.price;
  let code = null;
  if (req.body.coupon) {
    const c = findCoupon(B, req.body.coupon);
    if (!c) return bad(res, 'That coupon is not valid or has expired');
    code = c.code;
    price = Math.round((svc.price * (100 - c.percent)) / 100);
  }
  const start = toMin(time);
  const r = run(
    'INSERT INTO bookings (business_id, user_id, service_id, staff_id, date, start_min, end_min, note, venue, guests, price, coupon_code) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)',
    B, req.user.id, svc.id, info.get(time), date, start, start + lengthOf(B, date, svc), note || null, venue || null, guests, price, code
  );
  notifyAdmins(B, 'New booking: ' + userName(req.user.id) + ' · ' + svc.name + ' · ' + when(date, start));
  res.status(201).json({ id: Number(r.lastInsertRowid), staff_id: info.get(time), price, start: toTime(start), end: toTime(start + lengthOf(B, date, svc)) });
});

// Move an upcoming booking to another day/time (the booking's own slot counts as free while it moves)
biz.patch('/bookings/:id/reschedule', requireAuth('customer'), (req, res) => {
  const B = req.biz.id;
  const b = one('SELECT * FROM bookings WHERE id = ? AND user_id = ? AND business_id = ?', req.params.id, req.user.id, B);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (b.status !== 'booked') return res.status(409).json({ error: 'Only upcoming bookings can be rescheduled' });
  const late = tooLate(B, b);
  if (late) return res.status(409).json({ error: lateMsg(late) });
  const { date, time } = req.body;
  if (!isDate(date) || !TIME_RE.test(time || '')) return bad(res, 'date (YYYY-MM-DD) and time (HH:MM) required');
  const svc = one('SELECT * FROM services WHERE id = ?', b.service_id);
  const pref = 'staff_id' in req.body ? req.body.staff_id : b.staff_id;
  const info = slotInfo(B, date, svc, pref, b.id);
  if (!info.has(time)) return res.status(409).json({ error: 'That time is not available. Please pick another slot.' });
  const start = toMin(time);
  run('UPDATE bookings SET date = ?, start_min = ?, end_min = ?, staff_id = ? WHERE id = ?', date, start, start + lengthOf(B, date, svc), info.get(time), b.id);
  notifyAdmins(B, userName(req.user.id) + ' moved a booking to ' + when(date, start));
  res.json({ ok: true, staff_id: info.get(time) });
});

// Rate a completed visit (one review per booking)
biz.post('/bookings/:id/review', requireAuth('customer'), (req, res) => {
  const B = req.biz.id;
  const b = one('SELECT * FROM bookings WHERE id = ? AND user_id = ? AND business_id = ?', req.params.id, req.user.id, B);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (b.status !== 'completed') return res.status(409).json({ error: 'You can review a visit after it is completed' });
  const rating = Number(req.body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) return bad(res, 'rating must be 1 to 5');
  if (one('SELECT 1 FROM reviews WHERE booking_id = ?', b.id)) return res.status(409).json({ error: 'Already reviewed' });
  run('INSERT INTO reviews (business_id, booking_id, user_id, service_id, staff_id, rating, comment) VALUES (?,?,?,?,?,?,?)',
    B, b.id, req.user.id, b.service_id, b.staff_id, rating, str(req.body.comment, 400) || null);
  res.status(201).json({ ok: true });
});

biz.get('/reviews', (req, res) => {
  const B = req.biz.id;
  const agg = one('SELECT COUNT(*) c, AVG(rating) a FROM reviews WHERE business_id = ?', B);
  const items = all(
    `SELECT r.rating, r.comment, r.created_at, u.name AS customer, s.name AS service_name
     FROM reviews r JOIN users u ON u.id = r.user_id JOIN services s ON s.id = r.service_id
     WHERE r.business_id = ? AND r.comment IS NOT NULL AND r.comment != '' ORDER BY r.rating DESC, r.created_at DESC LIMIT 6`, B
  ).map((r) => ({ ...r, customer: r.customer.split(' ')[0] }));
  res.json({ count: agg.c, average: agg.c ? Math.round(agg.a * 10) / 10 : null, items });
});

biz.get('/bookings/mine', requireAuth('customer'), (req, res) => {
  const rows = all(`${BOOKING_SELECT} WHERE b.user_id = ? AND b.business_id = ? ORDER BY b.date DESC, b.start_min DESC`, req.user.id, req.biz.id);
  res.json(rows.map(view));
});

biz.patch('/bookings/:id/cancel', requireAuth('customer'), (req, res) => {
  const B = req.biz.id;
  const b = one('SELECT * FROM bookings WHERE id = ? AND user_id = ? AND business_id = ?', req.params.id, req.user.id, B);
  if (!b) return res.status(404).json({ error: 'Booking not found' });
  if (b.status !== 'booked') return res.status(409).json({ error: 'Only upcoming bookings can be cancelled' });
  const late = tooLate(B, b);
  if (late) return res.status(409).json({ error: lateMsg(late) });
  run("UPDATE bookings SET status = 'cancelled' WHERE id = ?", b.id);
  notifyAdmins(B, userName(req.user.id) + ' cancelled ' + when(b.date, b.start_min));
  res.json({ ok: true });
});

// ---------- Notifications ----------
biz.get('/notifications', requireAuth(), (req, res) => {
  const items = all('SELECT id, text, read, created_at FROM notifications WHERE user_id = ? ORDER BY id DESC LIMIT 20', req.user.id);
  const unread = one('SELECT COUNT(*) c FROM notifications WHERE user_id = ? AND read = 0', req.user.id).c;
  res.json({ unread, items });
});
biz.post('/notifications/read-all', requireAuth(), (req, res) => {
  run('UPDATE notifications SET read = 1 WHERE user_id = ?', req.user.id);
  res.json({ ok: true });
});

// ---------- Opening hours ----------
const hoursOf = (bid) =>
  all('SELECT * FROM business_hours WHERE business_id = ? ORDER BY dow', bid).map((r) => ({
    dow: r.dow,
    open: r.open_min == null ? null : toTime(r.open_min),
    close: r.close_min == null ? null : toTime(r.close_min),
  }));
biz.get('/hours', (req, res) => res.json(hoursOf(req.biz.id)));
biz.get('/admin/hours', requireAuth('admin'), (req, res) => res.json(hoursOf(req.biz.id)));

biz.put('/admin/hours/:dow', requireAuth('admin'), (req, res) => {
  const d = Number(req.params.dow);
  const { open, close } = req.body;
  if (!Number.isInteger(d) || d < 0 || d > 6) return bad(res, 'dow must be 0-6');
  if (open == null && close == null) {
    run('UPDATE business_hours SET open_min = NULL, close_min = NULL WHERE business_id = ? AND dow = ?', req.biz.id, d);
    return res.json({ ok: true });
  }
  if (!TIME_RE.test(open || '') || !TIME_RE.test(close || '') || toMin(open) >= toMin(close)) {
    return bad(res, 'open and close (HH:MM) required, open before close');
  }
  run('UPDATE business_hours SET open_min = ?, close_min = ? WHERE business_id = ? AND dow = ?', toMin(open), toMin(close), req.biz.id, d);
  res.json({ ok: true });
});

biz.get('/admin/holidays', requireAuth('admin'), (req, res) => {
  res.json(all('SELECT date, reason FROM holidays WHERE business_id = ? ORDER BY date', req.biz.id));
});
biz.post('/admin/holidays', requireAuth('admin'), (req, res) => {
  const { date, reason } = req.body;
  if (!isDate(date)) return bad(res, 'date must be YYYY-MM-DD');
  run('INSERT OR REPLACE INTO holidays (business_id, date, reason) VALUES (?,?,?)', req.biz.id, date, str(reason, 100) || null);
  res.status(201).json({ ok: true });
});
biz.delete('/admin/holidays/:date', requireAuth('admin'), (req, res) => {
  run('DELETE FROM holidays WHERE business_id = ? AND date = ?', req.biz.id, req.params.date);
  res.json({ ok: true });
});

// ---------- Admin: appointments ----------
biz.get('/admin/bookings', requireAuth('admin'), (req, res) => {
  const { date } = req.query;
  if (date && !isDate(date)) return bad(res, 'date must be YYYY-MM-DD');
  const rows = all(
    `SELECT b.*, (SELECT i.id FROM invoices i WHERE i.booking_id = b.id) AS invoice_id, s.name AS service_name, COALESCE(b.price, s.price) AS price, st.name AS staff_name, u.name AS customer_name, u.phone AS customer_phone
     FROM bookings b JOIN services s ON s.id = b.service_id JOIN users u ON u.id = b.user_id
     LEFT JOIN staff st ON st.id = b.staff_id
     WHERE b.business_id = ? ${date ? 'AND b.date = ?' : ''} ORDER BY b.date, b.start_min`,
    ...[req.biz.id, ...(date ? [date] : [])]
  );
  res.json(rows.map(view));
});

biz.patch('/admin/bookings/:id', requireAuth('admin'), (req, res) => {
  const { status } = req.body;
  if (!STATUSES.includes(status)) return bad(res, 'Invalid status');
  const cur = one(
    'SELECT b.*, s.name AS service_name FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.id = ? AND b.business_id = ?',
    req.params.id, req.biz.id
  );
  if (!cur) return res.status(404).json({ error: 'Booking not found' });
  run('UPDATE bookings SET status = ? WHERE id = ?', status, cur.id);
  if (status !== cur.status) {
    if (status === 'cancelled') notify(cur.user_id, 'Your ' + cur.service_name + ' appointment on ' + when(cur.date, cur.start_min) + ' was cancelled by us.');
    if (status === 'completed') notify(cur.user_id, 'Thanks for visiting! Tell us how your ' + cur.service_name + ' went: open My bookings and rate your visit.');
  }
  res.json({ ok: true });
});

// Owner books for a walk-in or phone customer (customer record is created from the phone number)
biz.post('/admin/bookings', requireAuth('admin'), (req, res) => {
  const B = req.biz.id;
  const { service_id, date, time, staff_id } = req.body;
  const name = str(req.body.name, 80);
  const phone = str(req.body.phone, 20);
  if (!name || !phone) return bad(res, 'Customer name and phone are required');
  if (!isDate(date) || !TIME_RE.test(time || '')) return bad(res, 'date (YYYY-MM-DD) and time (HH:MM) required');
  const svc = one('SELECT * FROM services WHERE id = ? AND business_id = ? AND active = 1', service_id, B);
  if (!svc) return res.status(404).json({ error: 'Service not found' });
  const info = slotInfo(B, date, svc, staff_id);
  if (!info.has(time)) return res.status(409).json({ error: 'That time is not available. Please pick another slot.' });
  let u = one('SELECT id FROM users WHERE business_id = ? AND phone = ?', B, phone);
  if (!u) {
    const pw = bcrypt.hashSync(crypto.randomBytes(12).toString('hex'), 10);
    u = { id: Number(run('INSERT INTO users (business_id, name, phone, password_hash) VALUES (?,?,?,?)', B, name, phone, pw).lastInsertRowid) };
  }
  const start = toMin(time);
  const r = run(
    'INSERT INTO bookings (business_id, user_id, service_id, staff_id, date, start_min, end_min, note, price) VALUES (?,?,?,?,?,?,?,?,?)',
    B, u.id, svc.id, info.get(time), date, start, start + lengthOf(B, date, svc), str(req.body.note, 300) || null, svc.price
  );
  res.status(201).json({ id: Number(r.lastInsertRowid), staff_id: info.get(time) });
});

// ---------- Admin: customers ----------
biz.get('/admin/customers', requireAuth('admin'), (req, res) => {
  res.json(
    all(
      `SELECT u.id, u.name, u.phone, u.notes, u.created_at, u.birthday, u.optout,
         (SELECT COALESCE(SUM(i.total), 0) FROM invoices i WHERE i.user_id = u.id AND i.business_id = u.business_id)
           - (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN invoices i ON i.id = p.invoice_id WHERE i.user_id = u.id AND i.business_id = u.business_id) AS due,
         (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.status != 'cancelled') AS bookings,
         (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.status = 'completed') AS visits,
         (SELECT COALESCE(SUM(COALESCE(b.price, s.price)), 0) FROM bookings b JOIN services s ON s.id = b.service_id
            WHERE b.user_id = u.id AND b.status = 'completed') AS spent,
         (SELECT MAX(b.date) FROM bookings b WHERE b.user_id = u.id AND b.status != 'cancelled') AS last_booking
       FROM users u WHERE u.business_id = ? AND u.role = 'customer' ORDER BY last_booking DESC, u.name`,
      req.biz.id
    )
  );
});

biz.put('/admin/customers/:id', requireAuth('admin'), (req, res) => {
  const r = run("UPDATE users SET notes = ? WHERE id = ? AND business_id = ? AND role = 'customer'", str(req.body.notes, 500) || null, req.params.id, req.biz.id);
  if (!r.changes) return res.status(404).json({ error: 'Customer not found' });
  res.json({ ok: true });
});

// "Forgot password" without email/SMS: the owner issues a temporary password and shares it
biz.post('/admin/customers/:id/reset-password', requireAuth('admin'), (req, res) => {
  const temp = crypto.randomBytes(5).toString('hex');
  const r = run("UPDATE users SET password_hash = ? WHERE id = ? AND business_id = ? AND role = 'customer'", bcrypt.hashSync(temp, 10), req.params.id, req.biz.id);
  if (!r.changes) return res.status(404).json({ error: 'Customer not found' });
  res.json({ temp_password: temp });
});

// ---------- Admin: offers / coupons ----------
biz.get('/admin/coupons', requireAuth('admin'), (req, res) => {
  res.json(
    all(
      `SELECT c.*, (SELECT COUNT(*) FROM bookings b WHERE b.business_id = c.business_id AND b.coupon_code = c.code) AS used
       FROM coupons c WHERE c.business_id = ? ORDER BY c.active DESC, c.code`,
      req.biz.id
    )
  );
});

biz.post('/admin/coupons', requireAuth('admin'), (req, res) => {
  const code = str(req.body.code, 20).toUpperCase();
  const percent = Number(req.body.percent);
  const expires = req.body.expires || null;
  if (!/^[A-Z0-9]{3,20}$/.test(code)) return bad(res, 'Code must be 3-20 letters or numbers');
  if (!Number.isInteger(percent) || percent < 1 || percent > 90) return bad(res, 'Discount must be 1 to 90 percent');
  if (expires && !isDate(expires)) return bad(res, 'expires must be YYYY-MM-DD');
  if (one('SELECT 1 FROM coupons WHERE business_id = ? AND code = ?', req.biz.id, code)) return res.status(409).json({ error: 'That code already exists' });
  run('INSERT INTO coupons (business_id, code, percent, expires) VALUES (?,?,?,?)', req.biz.id, code, percent, expires);
  res.status(201).json({ ok: true });
});

biz.put('/admin/coupons/:code', requireAuth('admin'), (req, res) => {
  const r = run('UPDATE coupons SET active = ? WHERE business_id = ? AND code = ?', req.body.active ? 1 : 0, req.biz.id, req.params.code);
  if (!r.changes) return res.status(404).json({ error: 'Coupon not found' });
  res.json({ ok: true });
});

biz.delete('/admin/coupons/:code', requireAuth('admin'), (req, res) => {
  run('DELETE FROM coupons WHERE business_id = ? AND code = ?', req.biz.id, req.params.code);
  res.json({ ok: true });
});

// ---------- Admin: reports ----------
const PRICE = 'COALESCE(b.price, s.price)';

biz.get('/admin/report', requireAuth('admin'), (req, res) => {
  const B = req.biz.id;
  const month = req.query.month || todayStr().slice(0, 7);
  const like = month + '%';
  const count = (status) => one('SELECT COUNT(*) c FROM bookings WHERE business_id = ? AND date LIKE ? AND status = ?', B, like, status).c;
  res.json({
    month,
    bookings: one("SELECT COUNT(*) c FROM bookings WHERE business_id = ? AND date LIKE ? AND status != 'cancelled'", B, like).c,
    completed: count('completed'),
    cancelled: count('cancelled'),
    no_show: count('no_show'),
    income: one(
      `SELECT COALESCE(SUM(${PRICE}),0) v FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.business_id = ? AND b.date LIKE ? AND b.status = 'completed'`,
      B, like
    ).v,
  });
});

// month of bookings as a CSV file (opens in Excel / Google Sheets)
biz.get('/admin/export', requireAuth('admin'), (req, res) => {
  const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayStr().slice(0, 7);
  const rows = all(
    `SELECT b.date, b.start_min, u.name AS customer, u.phone, s.name AS service, st.name AS stylist, ${PRICE} AS price, b.status, b.coupon_code
     FROM bookings b JOIN services s ON s.id = b.service_id JOIN users u ON u.id = b.user_id LEFT JOIN staff st ON st.id = b.staff_id
     WHERE b.business_id = ? AND b.date LIKE ? ORDER BY b.date, b.start_min`,
    req.biz.id, month + '%'
  );
  const cell = (v) => {
    let t = String(v ?? '');
    if (/^[=+\-@]/.test(t)) t = "'" + t;
    return '"' + t.replace(/"/g, '""') + '"';
  };
  const csv = ['Date,Time,Customer,Phone,Treatment,Staff,Price,Status,Coupon']
    .concat(rows.map((r) => [r.date, toTime(r.start_min), r.customer, r.phone, r.service, r.stylist, r.price, r.status, r.coupon_code].map(cell).join(',')))
    .join('\r\n');
  res.set({ 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': 'attachment; filename="bookings-' + month + '.csv"' }).send(csv);
});

// Overview for the owner's home screen: today, this month, last 14 days, top services, income per stylist
biz.get('/admin/dashboard', requireAuth('admin'), (req, res) => {
  const B = req.biz.id;
  const today = todayStr();
  const month = today.slice(0, 7) + '%';

  const todayRows = all(
    `SELECT b.id, b.start_min, b.end_min, b.status, s.name AS service_name, st.name AS staff_name, u.name AS customer_name
     FROM bookings b JOIN services s ON s.id = b.service_id JOIN users u ON u.id = b.user_id
     LEFT JOIN staff st ON st.id = b.staff_id
     WHERE b.business_id = ? AND b.date = ? AND b.status != 'cancelled' ORDER BY b.start_min`, B, today
  ).map(view);

  const from = new Date();
  from.setDate(from.getDate() - 13);
  const fromStr = `${from.getFullYear()}-${pad(from.getMonth() + 1)}-${pad(from.getDate())}`;
  const perDay = Object.fromEntries(
    all(
      `SELECT b.date, COUNT(*) AS count, COALESCE(SUM(CASE WHEN b.status = 'completed' THEN ${PRICE} END), 0) AS income
       FROM bookings b JOIN services s ON s.id = b.service_id
       WHERE b.business_id = ? AND b.date >= ? AND b.date <= ? AND b.status != 'cancelled' GROUP BY b.date`, B, fromStr, today
    ).map((r) => [r.date, r])
  );
  const daily = Array.from({ length: 14 }, (_, i) => {
    const d = new Date(from);
    d.setDate(from.getDate() + i);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    return { date: key, count: perDay[key]?.count || 0, income: perDay[key]?.income || 0 };
  });

  const rating = one('SELECT COUNT(*) c, AVG(rating) a FROM reviews WHERE business_id = ?', B);
  res.json({
    today: { date: today, total: todayRows.length, upcoming: todayRows.filter((b) => b.status === 'booked' && b.start_min > nowMin()).slice(0, 5), rows: todayRows },
    month: {
      bookings: one("SELECT COUNT(*) c FROM bookings WHERE business_id = ? AND date LIKE ? AND status != 'cancelled'", B, month).c,
      completed: one("SELECT COUNT(*) c FROM bookings WHERE business_id = ? AND date LIKE ? AND status = 'completed'", B, month).c,
      no_show: one("SELECT COUNT(*) c FROM bookings WHERE business_id = ? AND date LIKE ? AND status = 'no_show'", B, month).c,
      income: one(
        `SELECT COALESCE(SUM(${PRICE}),0) v FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.business_id = ? AND b.date LIKE ? AND b.status = 'completed'`,
        B, month
      ).v,
      customers: one('SELECT COUNT(DISTINCT user_id) c FROM bookings WHERE business_id = ? AND date LIKE ?', B, month).c,
    },
    daily,
    rating: { count: rating.c, average: rating.c ? Math.round(rating.a * 10) / 10 : null },
    topServices: all(
      `SELECT s.name, COUNT(*) AS count FROM bookings b JOIN services s ON s.id = b.service_id
       WHERE b.business_id = ? AND b.date LIKE ? AND b.status != 'cancelled' GROUP BY s.id ORDER BY count DESC, s.name LIMIT 5`, B, month
    ),
    byStaff: all(
      `SELECT COALESCE(st.name, 'Unassigned') AS name, COUNT(*) AS count, COALESCE(SUM(${PRICE}), 0) AS income
       FROM bookings b JOIN services s ON s.id = b.service_id LEFT JOIN staff st ON st.id = b.staff_id
       WHERE b.business_id = ? AND b.date LIKE ? AND b.status = 'completed' GROUP BY st.id ORDER BY income DESC`, B, month
    ),
  });
});

// Billing, messaging, enquiries, gallery and the staff portal live in their own files
const ctx = {
  db, one, all, run, bad, str, okImage, isDate, todayStr, nowMin, toMin, toTime, TIME_RE, dow, requireAuth, bcrypt, crypto,
  notify, notifyAdmins, userName, when, readSettings, view, PRICE, lengthOf, slotInfo, authLimit, tenant, tx, httpError,
};
require('./money')(biz, ctx);
require('./messaging').mount(biz, ctx);
require('./extras')(biz, ctx);

// Unknown API routes answer with JSON, not the website
app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

// Serve the built frontend (single-server deploy)
const dist = path.join(__dirname, '..', '..', 'frontend', 'dist');
if (fs.existsSync(dist)) {
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c]);
  const getBiz = (slug) => one('SELECT * FROM businesses WHERE slug = ?', slug);

  // PNG app icon in any brand colour: /icon/192.png?c=c9647a
  app.get(/^\/icon\/(192|512|180)\.png$/, (req, res) => {
    const c = String(req.query.c || '').replace('#', '');
    const hex = /^[0-9a-fA-F]{6}$/.test(c) ? '#' + c : '#4f46e5';
    res.set('Cache-Control', 'public, max-age=86400').type('png').send(icon(Number(req.params[0]), hex));
  });

  const manifestFor = (b, base) => {
    const brand = brandOf(b);
    return {
      name: b.name + ': Book an appointment',
      short_name: b.name.slice(0, 12),
      start_url: base,
      scope: base.endsWith('/') ? base : base + '/',
      display: 'standalone',
      background_color: '#ffffff',
      theme_color: brand,
      icons: [192, 512].map((n) => ({ src: `/icon/${n}.png?c=${brand.slice(1)}`, sizes: `${n}x${n}`, type: 'image/png', purpose: 'any maskable' })),
    };
  };

  // the index page, personalised for one business (title, colour, own phone-app manifest)
  const page = (b) => {
    let html = fs.readFileSync(path.join(dist, 'index.html'), 'utf8');
    if (!b) return html;
    const brand = brandOf(b);
    html = html
      .replace('href="/manifest.webmanifest"', `href="${SINGLE ? '/manifest.webmanifest' : '/b/' + b.slug + '/manifest.webmanifest'}"`)
      .replace(/<title>.*?<\/title>/, `<title>${esc(b.name)}: Book an appointment</title>`)
      .replace(/name="theme-color" content="#[0-9a-fA-F]{6}"/, `name="theme-color" content="${brand}"`)
      .replace(/href="\/icon\/180\.png\?c=[0-9a-fA-F]{6}"/, `href="/icon/180.png?c=${brand.slice(1)}"`);
    if (SINGLE) html = html.replace('</head>', `<script>window.__SINGLE__=${JSON.stringify(b.slug)}</script></head>`);
    return html;
  };

  if (SINGLE) {
    app.get('/manifest.webmanifest', (req, res) => {
      const b = getBiz(SINGLE);
      if (!b) return res.status(404).json({ error: 'Business not found' });
      res.type('application/manifest+json').json(manifestFor(b, '/'));
    });
  }
  app.use(express.static(dist, { index: false }));
  app.get(/^\/b\/([a-z0-9-]+)\/manifest\.webmanifest$/, (req, res) => {
    const b = getBiz(req.params[0]);
    if (!b || !b.active || SINGLE) return res.status(404).json({ error: 'Business not found' });
    res.type('application/manifest+json').json(manifestFor(b, '/b/' + b.slug));
  });
  app.use((req, res, next) => {
    if (req.method !== 'GET') return next();
    if (SINGLE) return res.type('html').send(page(getBiz(SINGLE)));
    const m = req.path.match(/^\/b\/([a-z0-9-]+)(\/.*)?$/);
    res.type('html').send(page(m ? getBiz(m[1]) : null));
  });
}

app.use((err, req, res, next) => {
  if (err && err.status && err.status < 500) return res.status(err.status).json({ error: err.message });
  console.error(err);
  res.status(500).json({ error: 'Server error' });
});

module.exports = app;
