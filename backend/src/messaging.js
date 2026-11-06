// Messages: an outbox for reminders, offers and one-time codes.
//
// Every message is saved first. If MESSAGE_WEBHOOK_URL is set, it is posted there as JSON
// ({ to, text, kind, business, id }) so any WhatsApp / SMS provider can be connected. Without it the
// message is only recorded as "logged", which is the test mode: you can see exactly what would be sent.
const crypto = require('crypto');
const db = require('./db');

const one = (sql, ...p) => db.prepare(sql).get(...p);
const all = (sql, ...p) => db.prepare(sql).all(...p);
const run = (sql, ...p) => db.prepare(sql).run(...p);

const toTime = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
const time12 = (m) => `${Math.floor(m / 60) % 12 || 12}:${String(m % 60).padStart(2, '0')} ${m < 720 ? 'AM' : 'PM'}`;
const iso = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const setting = (bid, key, def = '') => one('SELECT value FROM settings WHERE business_id = ? AND key = ?', bid, key)?.value ?? def;
const hasProvider = () => !!process.env.MESSAGE_WEBHOOK_URL;

async function deliver(id) {
  // claim the message first so it can never be handed to the provider twice
  if (!run("UPDATE messages SET status = 'sending' WHERE id = ? AND status = 'queued'", id).changes) return;
  const m = one('SELECT m.*, b.slug FROM messages m JOIN businesses b ON b.id = m.business_id WHERE m.id = ?', id);
  if (!hasProvider()) {
    run("UPDATE messages SET status = 'logged', sent_at = datetime('now','localtime') WHERE id = ?", id);
    return;
  }
  try {
    const res = await fetch(process.env.MESSAGE_WEBHOOK_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...(process.env.MESSAGE_WEBHOOK_TOKEN && { Authorization: 'Bearer ' + process.env.MESSAGE_WEBHOOK_TOKEN }) },
      body: JSON.stringify({ to: m.phone, text: m.text, kind: m.kind, business: m.slug, id: m.id }),
      signal: AbortSignal.timeout(8000),
    });
    if (!res.ok) throw new Error('Provider answered ' + res.status);
    run("UPDATE messages SET status = 'sent', sent_at = datetime('now','localtime') WHERE id = ?", id);
  } catch (e) {
    run("UPDATE messages SET status = 'failed', error = ? WHERE id = ?", String(e.message).slice(0, 200), id);
  }
}

// returns the new message id, or null when a reminder for that booking already exists
function queue(bid, { userId = null, phone, text, kind = 'info', bookingId = null }) {
  let id;
  try {
    id = Number(run('INSERT INTO messages (business_id, user_id, phone, text, kind, booking_id) VALUES (?,?,?,?,?,?)', bid, userId, phone, text, kind, bookingId).lastInsertRowid);
  } catch (e) {
    if (/UNIQUE/i.test(e.message)) return null;
    throw e;
  }
  deliver(id).catch(() => {});
  return id;
}

// Queue a reminder for every upcoming booking that starts within the business's reminder window.
function runReminders(now = new Date()) {
  let queued = 0;
  const today = iso(now);
  const limit = iso(new Date(now.getTime() + 4 * 86400000));
  for (const b of all('SELECT id, name, slug FROM businesses WHERE active = 1')) {
    const hours = Number(setting(b.id, 'reminder_hours', '24')) || 0;
    if (!hours) continue;
    const rows = all(
      `SELECT k.id, k.user_id, k.date, k.start_min, s.name AS service, st.name AS staff, u.phone
       FROM bookings k JOIN services s ON s.id = k.service_id JOIN users u ON u.id = k.user_id LEFT JOIN staff st ON st.id = k.staff_id
       WHERE k.business_id = ? AND k.status = 'booked' AND k.date >= ? AND k.date <= ?`, b.id, today, limit
    );
    for (const k of rows) {
      const startsAt = new Date(k.date + 'T' + toTime(k.start_min) + ':00').getTime();
      if (startsAt <= now.getTime() || startsAt - now.getTime() > hours * 3600000) continue;
      const phone = setting(b.id, 'phone');
      const text = `Reminder: your ${k.service}${k.staff ? ' with ' + k.staff : ''} at ${b.name} is on ${k.date} at ${time12(k.start_min)}.${phone ? ' To change it, call ' + phone + '.' : ''}`;
      if (queue(b.id, { userId: k.user_id, phone: k.phone, text, kind: 'reminder', bookingId: k.id }) !== null) {
        run('INSERT INTO notifications (user_id, text) VALUES (?,?)', k.user_id, text);
        queued++;
      }
    }
  }
  return queued;
}

function startScheduler() {
  const t = setInterval(() => { try { runReminders(); } catch (e) { console.error('reminders:', e.message); } }, 60000);
  t.unref();
  return t;
}

const sha = (code, userId) => crypto.createHash('sha256').update(`${code}:${userId}`).digest('hex');
const escIcs = (s) => String(s ?? '').replace(/\\/g, '\\\\').replace(/[,;]/g, (m) => '\\' + m).replace(/\r?\n/g, '\\n');

function mount(biz, c) {
  const { requireAuth, str, bad, httpError: fail, bcrypt, authLimit, isDate, todayStr } = c;

  // ---------- outbox ----------
  biz.get('/admin/messages', requireAuth('admin'), (req, res) => {
    const rows = all(
      `SELECT m.id, m.phone, m.text, m.kind, m.status, m.error, m.created_at, u.name AS customer
       FROM messages m LEFT JOIN users u ON u.id = m.user_id WHERE m.business_id = ? ORDER BY m.id DESC LIMIT 100`, req.biz.id
    );
    res.json({ provider: hasProvider(), items: rows.map((r) => (r.kind === 'otp' ? { ...r, text: 'One-time code (hidden)' } : r)) });
  });

  // ---------- marketing campaigns ----------
  const SEGMENTS = ['all', 'inactive', 'new', 'birthday', 'top'];
  function audience(B, segment, days) {
    const rows = all(
      `SELECT u.id, u.name, u.phone, u.birthday,
         (SELECT MAX(b.date) FROM bookings b WHERE b.user_id = u.id AND b.status IN ('booked','completed')) AS last_visit,
         (SELECT COUNT(*) FROM bookings b WHERE b.user_id = u.id AND b.status = 'completed') AS visits,
         (SELECT COALESCE(SUM(COALESCE(b.price, s.price)), 0) FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.user_id = u.id AND b.status = 'completed') AS spent
       FROM users u WHERE u.business_id = ? AND u.role = 'customer' AND u.optout = 0`, B
    );
    const today = new Date();
    if (segment === 'inactive') {
      const cut = new Date(today.getTime() - days * 86400000);
      return rows.filter((r) => r.visits > 0 && r.last_visit && r.last_visit < iso(cut));
    }
    if (segment === 'new') return rows.filter((r) => r.visits === 0);
    if (segment === 'birthday') return rows.filter((r) => r.birthday && Number(r.birthday.slice(5, 7)) === today.getMonth() + 1);
    if (segment === 'top') return rows.filter((r) => r.spent > 0).sort((a, b) => b.spent - a.spent).slice(0, 10);
    return rows;
  }
  const segArgs = (body) => {
    const segment = SEGMENTS.includes(body.segment) ? body.segment : null;
    if (!segment) throw fail(400, 'Choose who to message');
    const days = Math.min(365, Math.max(7, Math.round(Number(body.days) || 30)));
    return { segment, days };
  };
  biz.post('/admin/campaigns/preview', requireAuth('admin'), (req, res) => {
    const { segment, days } = segArgs(req.body || {});
    const list = audience(req.biz.id, segment, days);
    res.json({ count: list.length, sample: list.slice(0, 5).map((r) => r.name) });
  });
  biz.post('/admin/campaigns/send', requireAuth('admin'), (req, res) => {
    const { segment, days } = segArgs(req.body || {});
    const text = str(req.body.text, 500);
    if (text.length < 5) return bad(res, 'Write the message first');
    const list = audience(req.biz.id, segment, days);
    if (!list.length) return res.status(409).json({ error: 'No customers match this group' });
    if (list.length > 500) return res.status(409).json({ error: 'More than 500 customers. Choose a smaller group.' });
    for (const r of list) queue(req.biz.id, { userId: r.id, phone: r.phone, text: text.split('{name}').join(r.name.split(' ')[0]), kind: 'campaign' });
    res.json({ queued: list.length, provider: hasProvider() });
  });

  // ---------- forgot password with a one-time code ----------
  const findUser = (B, phone) => one("SELECT id, name, phone FROM users WHERE business_id = ? AND phone = ? AND role IN ('customer','staff','admin')", B, str(phone, 20));

  biz.post('/auth/forgot', authLimit, (req, res) => {
    const B = req.biz.id;
    // without a message provider a code cannot reach the person, so be honest instead of pretending
    if (process.env.NODE_ENV === 'production' && !hasProvider()) {
      return res.status(503).json({ error: 'Text messages are not set up for this site. Please ask the business to reset your password.' });
    }
    const u = findUser(B, req.body?.phone);
    const reply = { ok: true, message: 'If this number is registered, a code has been sent.' };
    if (!u) return res.json(reply);
    const recent = one('SELECT 1 FROM otps WHERE user_id = ? AND used = 0 AND expires_at > ?', u.id, Date.now() + 9 * 60000);
    if (recent) return res.json(reply); // a code was sent less than a minute ago
    run('UPDATE otps SET used = 1 WHERE user_id = ?', u.id);
    const code = String(crypto.randomInt(100000, 1000000));
    run('INSERT INTO otps (business_id, user_id, code_hash, expires_at) VALUES (?,?,?,?)', B, u.id, sha(code, u.id), Date.now() + 10 * 60000);
    queue(B, { userId: u.id, phone: u.phone, text: `Your ${req.biz.name} verification code is ${code}. It is valid for 10 minutes. Do not share it.`, kind: 'otp' });
    res.json(process.env.NODE_ENV === 'production' ? reply : { ...reply, dev_code: code }); // dev_code only outside production
  });

  biz.post('/auth/reset', authLimit, (req, res) => {
    const B = req.biz.id;
    const { password } = req.body || {};
    if (typeof password !== 'string' || password.length < 6) return bad(res, 'New password must be at least 6 characters');
    const u = findUser(B, req.body?.phone);
    const fail400 = () => res.status(400).json({ error: 'Wrong or expired code' });
    if (!u) return fail400();
    const o = one('SELECT * FROM otps WHERE user_id = ? AND used = 0 AND expires_at > ? ORDER BY id DESC', u.id, Date.now());
    if (!o || o.attempts >= 5) return fail400();
    run('UPDATE otps SET attempts = attempts + 1 WHERE id = ?', o.id);
    const given = Buffer.from(sha(String(req.body.code || '').trim(), u.id));
    const real = Buffer.from(o.code_hash);
    if (given.length !== real.length || !crypto.timingSafeEqual(given, real)) return fail400();
    run('UPDATE otps SET used = 1 WHERE id = ?', o.id);
    run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(password, 10), u.id);
    res.json({ ok: true });
  });

  // ---------- calendar feed (Google / Apple / Outlook can subscribe to this link) ----------
  const calKey = (B) => one("SELECT value FROM settings WHERE business_id = ? AND key = 'ical_key'", B)?.value || null;
  biz.post('/admin/calendar-link', requireAuth('admin'), (req, res) => {
    const B = req.biz.id;
    let key = calKey(B);
    if (!key || req.body?.regenerate) {
      key = crypto.randomBytes(16).toString('hex');
      run("INSERT INTO settings (business_id, key, value) VALUES (?, 'ical_key', ?) ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value", B, key);
    }
    res.json({ path: `/api/b/${req.biz.slug}/calendar.ics?key=${key}` });
  });
  biz.get('/calendar.ics', (req, res) => {
    const real = calKey(req.biz.id);
    const given = String(req.query.key || '');
    if (!real || given.length !== real.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(real))) return res.status(404).json({ error: 'Not found' });
    const from = iso(new Date(Date.now() - 30 * 86400000));
    const rows = all(
      `SELECT k.id, k.date, k.start_min, k.end_min, k.note, k.venue, s.name AS service, u.name AS customer, u.phone, st.name AS staff
       FROM bookings k JOIN services s ON s.id = k.service_id JOIN users u ON u.id = k.user_id LEFT JOIN staff st ON st.id = k.staff_id
       WHERE k.business_id = ? AND k.status != 'cancelled' AND k.date >= ? ORDER BY k.date, k.start_min LIMIT 800`, req.biz.id, from
    );
    const ts = new Date().toISOString().replace(/[-:]/g, '').slice(0, 15) + 'Z';
    const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', `PRODID:-//${escIcs(req.biz.name)}//Bookings//EN`, `X-WR-CALNAME:${escIcs(req.biz.name)} appointments`];
    for (const r of rows) {
      const d = r.date.replace(/-/g, '');
      const t = (m) => toTime(m).replace(':', '') + '00';
      lines.push(
        'BEGIN:VEVENT', `UID:booking-${r.id}@${req.biz.slug}`, `DTSTAMP:${ts}`, `DTSTART:${d}T${t(r.start_min)}`, `DTEND:${d}T${t(r.end_min)}`,
        `SUMMARY:${escIcs(`${r.service} - ${r.customer}${r.staff ? ' (' + r.staff + ')' : ''}`)}`,
        `DESCRIPTION:${escIcs(`${r.customer} ${r.phone}${r.note ? '\n' + r.note : ''}`)}`, ...(r.venue ? [`LOCATION:${escIcs(r.venue)}`] : []), 'END:VEVENT'
      );
    }
    lines.push('END:VCALENDAR');
    res.type('text/calendar; charset=utf-8').send(lines.join('\r\n'));
  });
  void isDate; void todayStr;
}

module.exports = { mount, queue, deliver, runReminders, startScheduler, hasProvider };
