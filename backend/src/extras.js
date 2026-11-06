// Gallery, enquiries (quotes) and the staff portal.
const { queue } = require('./messaging');

module.exports = (biz, c) => {
  const { db, one, all, run, str, bad, okImage, isDate, todayStr, toTime, dow, requireAuth, bcrypt, crypto, notify, notifyAdmins, userName, view, tx, httpError: fail } = c;
  const round2 = (n) => Math.round(n * 100) / 100;

  // ---------------- gallery (the business's own work) ----------------
  biz.get('/gallery', (req, res) => {
    res.json(all('SELECT id, url, caption FROM gallery WHERE business_id = ? ORDER BY sort, id LIMIT 60', req.biz.id));
  });
  biz.post('/admin/gallery', requireAuth('admin'), (req, res) => {
    const url = String(req.body?.url || '').trim();
    if (!url || !okImage(url)) return bad(res, 'Add an image link (https://...) or a /photos/... path');
    if (one('SELECT COUNT(*) c FROM gallery WHERE business_id = ?', req.biz.id).c >= 60) return res.status(409).json({ error: 'The gallery is full (60 photos)' });
    const r = run('INSERT INTO gallery (business_id, url, caption) VALUES (?,?,?)', req.biz.id, url, str(req.body?.caption, 100) || null);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });
  biz.delete('/admin/gallery/:id', requireAuth('admin'), (req, res) => {
    run('DELETE FROM gallery WHERE id = ? AND business_id = ?', req.params.id, req.biz.id);
    res.json({ ok: true });
  });

  // ---------------- enquiries: services priced by quote ----------------
  const enquiryRows = (where, ...params) =>
    all(
      `SELECT e.*, s.name AS service_name, u.name AS customer_name, u.phone AS customer_phone
       FROM enquiries e JOIN services s ON s.id = e.service_id JOIN users u ON u.id = e.user_id ${where} ORDER BY e.id DESC LIMIT 200`, ...params
    );

  biz.post('/enquiries', requireAuth('customer'), (req, res) => {
    const B = req.biz.id;
    const { service_id, date } = req.body || {};
    const svc = one("SELECT * FROM services WHERE id = ? AND business_id = ? AND active = 1 AND mode = 'quote'", service_id, B);
    if (!svc) return res.status(404).json({ error: 'Service not found' });
    if (!isDate(date) || date < todayStr()) return bad(res, 'Choose a date that is today or later');
    const guests = req.body.guests ? Math.round(Number(req.body.guests)) : null;
    if (guests !== null && !(guests >= 1 && guests <= 100000)) return bad(res, 'Guests must be a number');
    const venue = str(req.body.venue, 200);
    if (svc.ask_venue && !venue) return bad(res, 'Please enter the address or venue');
    const r = run('INSERT INTO enquiries (business_id, user_id, service_id, date, details, venue, guests) VALUES (?,?,?,?,?,?,?)',
      B, req.user.id, svc.id, date, str(req.body.details, 500) || null, venue || null, guests);
    notifyAdmins(B, 'New enquiry: ' + userName(req.user.id) + ' · ' + svc.name + ' · ' + date);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });
  biz.get('/enquiries/mine', requireAuth('customer'), (req, res) => {
    res.json(enquiryRows('WHERE e.business_id = ? AND e.user_id = ?', req.biz.id, req.user.id));
  });
  biz.get('/admin/enquiries', requireAuth('admin'), (req, res) => {
    res.json(enquiryRows('WHERE e.business_id = ?', req.biz.id));
  });

  // the booking made when a quote is agreed: the whole day, at the quoted price
  function bookEnquiry(B, e, staffId, price) {
    const h = one('SELECT open_min, close_min FROM business_hours WHERE business_id = ? AND dow = ?', B, dow(e.date));
    if (!h || h.open_min == null) throw fail(409, 'The business is closed on that date. Ask for another date.');
    if (one('SELECT 1 FROM holidays WHERE business_id = ? AND date = ?', B, e.date)) throw fail(409, 'That date is a holiday. Ask for another date.');
    if (staffId) {
      if (!one('SELECT 1 FROM staff WHERE id = ? AND business_id = ?', staffId, B)) throw fail(400, 'Team member not found');
      if (one("SELECT 1 FROM bookings WHERE staff_id = ? AND date = ? AND status != 'cancelled'", staffId, e.date)) throw fail(409, 'That team member is busy on that date');
    }
    const id = Number(
      run('INSERT INTO bookings (business_id, user_id, service_id, staff_id, date, start_min, end_min, note, venue, guests, price) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        B, e.user_id, e.service_id, staffId || null, e.date, h.open_min, h.close_min, e.details, e.venue, e.guests, price).lastInsertRowid
    );
    run("UPDATE enquiries SET status = 'confirmed', booking_id = ? WHERE id = ?", id, e.id);
    return id;
  }

  biz.patch('/admin/enquiries/:id', requireAuth('admin'), (req, res) => {
    const B = req.biz.id;
    const e = one('SELECT e.*, s.name AS service_name FROM enquiries e JOIN services s ON s.id = e.service_id WHERE e.id = ? AND e.business_id = ?', req.params.id, B);
    if (!e) return res.status(404).json({ error: 'Enquiry not found' });
    if (e.status === 'confirmed') return res.status(409).json({ error: 'This enquiry is already booked' });
    const status = req.body?.status;
    if (!['quoted', 'declined'].includes(status)) return bad(res, 'Status must be quoted or declined');
    let price = null;
    if (status === 'quoted') {
      price = Number(req.body.quote_price);
      if (!Number.isFinite(price) || price < 0) return bad(res, 'Enter the quoted price');
    }
    const reply = str(req.body.reply, 300) || null;
    run('UPDATE enquiries SET status = ?, quote_price = ?, reply = ? WHERE id = ?', status, price, reply, e.id);
    const text = status === 'quoted'
      ? `Your enquiry for ${e.service_name} on ${e.date} has a quote of Rs ${price}.${reply ? ' ' + reply : ''} Open My bookings to accept it.`
      : `Sorry, we cannot take your enquiry for ${e.service_name} on ${e.date}.${reply ? ' ' + reply : ''}`;
    notify(e.user_id, text);
    const u = one('SELECT phone FROM users WHERE id = ?', e.user_id);
    queue(B, { userId: e.user_id, phone: u.phone, text, kind: 'enquiry' });
    res.json({ ok: true });
  });

  biz.post('/admin/enquiries/:id/book', requireAuth('admin'), (req, res) => {
    const B = req.biz.id;
    const e = one('SELECT * FROM enquiries WHERE id = ? AND business_id = ?', req.params.id, B);
    if (!e) return res.status(404).json({ error: 'Enquiry not found' });
    if (e.status === 'confirmed') return res.status(409).json({ error: 'This enquiry is already booked' });
    const price = req.body?.price !== undefined ? Number(req.body.price) : e.quote_price;
    if (!Number.isFinite(price) || price < 0) return bad(res, 'Enter the price first');
    const id = tx(() => bookEnquiry(B, e, req.body?.staff_id ? Number(req.body.staff_id) : null, price));
    notify(e.user_id, 'Your booking is confirmed for ' + e.date + '.');
    res.status(201).json({ booking_id: id });
  });

  biz.post('/enquiries/:id/accept', requireAuth('customer'), (req, res) => {
    const B = req.biz.id;
    const e = one('SELECT e.*, s.name AS service_name FROM enquiries e JOIN services s ON s.id = e.service_id WHERE e.id = ? AND e.business_id = ? AND e.user_id = ?', req.params.id, B, req.user.id);
    if (!e) return res.status(404).json({ error: 'Enquiry not found' });
    if (e.status !== 'quoted') return res.status(409).json({ error: 'There is no quote to accept' });
    if (e.date < todayStr()) return res.status(409).json({ error: 'That date has passed. Please send a new enquiry.' });
    const id = tx(() => bookEnquiry(B, e, null, e.quote_price));
    notifyAdmins(B, userName(req.user.id) + ' accepted the quote for ' + e.service_name + ' on ' + e.date);
    res.status(201).json({ booking_id: id });
  });

  // ---------------- team logins ----------------
  biz.post('/admin/staff/:id/login', requireAuth('admin'), (req, res) => {
    const B = req.biz.id;
    const st = one('SELECT * FROM staff WHERE id = ? AND business_id = ?', req.params.id, B);
    if (!st) return res.status(404).json({ error: 'Not found' });
    const phone = str(req.body?.phone, 20);
    const { password } = req.body || {};
    if (!phone) return bad(res, 'Phone number is required');
    const clash = one('SELECT id FROM users WHERE business_id = ? AND phone = ?', B, phone);
    if (clash && clash.id !== st.user_id) return res.status(409).json({ error: 'That phone number is already used by someone else' });
    if (st.user_id) {
      run('UPDATE users SET phone = ?, name = ? WHERE id = ?', phone, st.name, st.user_id);
      if (password) {
        if (typeof password !== 'string' || password.length < 6) return bad(res, 'Password must be at least 6 characters');
        run('UPDATE users SET password_hash = ? WHERE id = ?', bcrypt.hashSync(password, 10), st.user_id);
      }
    } else {
      if (typeof password !== 'string' || password.length < 6) return bad(res, 'Password must be at least 6 characters');
      const uid = Number(run("INSERT INTO users (business_id, name, phone, password_hash, role) VALUES (?,?,?,?, 'staff')", B, st.name, phone, bcrypt.hashSync(password, 10)).lastInsertRowid);
      run('UPDATE staff SET user_id = ? WHERE id = ?', uid, st.id);
    }
    res.json({ ok: true });
  });
  biz.delete('/admin/staff/:id/login', requireAuth('admin'), (req, res) => {
    const st = one('SELECT * FROM staff WHERE id = ? AND business_id = ?', req.params.id, req.biz.id);
    if (!st) return res.status(404).json({ error: 'Not found' });
    if (st.user_id) run("DELETE FROM users WHERE id = ? AND role = 'staff'", st.user_id);
    run('UPDATE staff SET user_id = NULL WHERE id = ?', st.id);
    res.json({ ok: true });
  });

  // ---------------- staff portal: a team member sees only their own work ----------------
  const mine = (req) => {
    const st = one('SELECT * FROM staff WHERE user_id = ? AND business_id = ?', req.user.id, req.biz.id);
    if (!st) throw fail(404, 'Your team profile was not found');
    return st;
  };
  biz.get('/staff/me', requireAuth('staff'), (req, res) => {
    const st = mine(req);
    const today = one("SELECT COUNT(*) c FROM bookings WHERE staff_id = ? AND date = ? AND status != 'cancelled'", st.id, todayStr()).c;
    res.json({ id: st.id, name: st.name, title: st.title, commission_pct: st.commission_pct, today });
  });
  biz.get('/staff/bookings', requireAuth('staff'), (req, res) => {
    const st = mine(req);
    const date = isDate(req.query.date) ? req.query.date : todayStr();
    const rows = all(
      `SELECT b.*, s.name AS service_name, u.name AS customer_name, u.phone AS customer_phone
       FROM bookings b JOIN services s ON s.id = b.service_id JOIN users u ON u.id = b.user_id
       WHERE b.staff_id = ? AND b.date = ? ORDER BY b.start_min`, st.id, date
    );
    res.json(rows.map(view));
  });
  biz.patch('/staff/bookings/:id', requireAuth('staff'), (req, res) => {
    const st = mine(req);
    const status = req.body?.status;
    if (!['completed', 'no_show'].includes(status)) return bad(res, 'Status must be completed or no_show');
    const b = one('SELECT b.*, s.name AS service_name FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.id = ? AND b.staff_id = ?', req.params.id, st.id);
    if (!b) return res.status(404).json({ error: 'Booking not found' });
    if (b.status !== 'booked') return res.status(409).json({ error: 'This booking is already ' + b.status });
    run('UPDATE bookings SET status = ? WHERE id = ?', status, b.id);
    if (status === 'completed') notify(b.user_id, 'Thanks for visiting! Tell us how your ' + b.service_name + ' went: open My bookings and rate your visit.');
    res.json({ ok: true });
  });
  biz.get('/staff/earnings', requireAuth('staff'), (req, res) => {
    const st = mine(req);
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayStr().slice(0, 7);
    const r = c.money.commission(req.biz.id, month, st.id);
    const s = r.staff[0] || { services: 0, base: 0, commission: 0 };
    res.json({ month, pct: st.commission_pct, services: s.services, base: s.base, commission: s.commission, lines: r.lines });
  });

  void db; void toTime; void crypto; void round2;
};
