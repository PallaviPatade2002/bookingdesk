// Billing: products, packages, checkout (invoices + payments), customer account (khata) and money reports.
module.exports = (biz, c) => {
  const { db, one, all, run, str, requireAuth, tx, httpError: fail, todayStr, notify, bcrypt, crypto, toTime } = c;

  const round2 = (n) => Math.round(n * 100) / 100;
  const METHODS = ['cash', 'upi', 'card'];
  const setting = (bid, key, def = '') => one('SELECT value FROM settings WHERE business_id = ? AND key = ?', bid, key)?.value ?? def;
  const label = (bid, number) => {
    const p = setting(bid, 'invoice_prefix', 'INV');
    return (p ? p + '-' : '') + String(number).padStart(4, '0');
  };
  const num = (v, name, min = 0, max = 10000000) => {
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) throw fail(400, `${name} is not valid`);
    return n;
  };
  const int = (v, name, min, max) => {
    const n = num(v, name, min, max);
    if (!Number.isInteger(n)) throw fail(400, `${name} must be a whole number`);
    return n;
  };

  // ---------------- products ----------------
  const productFields = (b, cur = {}) => {
    const n = { ...cur, ...b };
    const name = str(n.name, 80);
    if (!name) throw fail(400, 'Product name is required');
    return { name, price: num(n.price, 'Price'), stock: int(n.stock ?? 0, 'Stock', 0, 1000000), active: n.active === undefined ? 1 : n.active ? 1 : 0 };
  };
  biz.get('/admin/products', requireAuth('admin'), (req, res) => {
    res.json(all('SELECT * FROM products WHERE business_id = ? ORDER BY active DESC, name', req.biz.id));
  });
  biz.post('/admin/products', requireAuth('admin'), (req, res) => {
    const v = productFields(req.body || {});
    const r = run('INSERT INTO products (business_id, name, price, stock, active) VALUES (?,?,?,?,?)', req.biz.id, v.name, v.price, v.stock, v.active);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });
  biz.put('/admin/products/:id', requireAuth('admin'), (req, res) => {
    const cur = one('SELECT * FROM products WHERE id = ? AND business_id = ?', req.params.id, req.biz.id);
    if (!cur) return res.status(404).json({ error: 'Product not found' });
    const v = productFields(req.body || {}, cur);
    run('UPDATE products SET name=?, price=?, stock=?, active=? WHERE id=?', v.name, v.price, v.stock, v.active, cur.id);
    res.json({ ok: true });
  });
  biz.delete('/admin/products/:id', requireAuth('admin'), (req, res) => {
    const cur = one('SELECT id FROM products WHERE id = ? AND business_id = ?', req.params.id, req.biz.id);
    if (!cur) return res.status(404).json({ error: 'Product not found' });
    if (one("SELECT 1 FROM invoice_items WHERE kind = 'product' AND ref_id = ?", cur.id)) {
      run('UPDATE products SET active = 0 WHERE id = ?', cur.id);
      return res.json({ ok: true, hidden: true });
    }
    run('DELETE FROM products WHERE id = ?', cur.id);
    res.json({ ok: true, deleted: true });
  });

  // ---------------- packages ----------------
  const packageFields = (bid, b, cur = {}) => {
    const n = { ...cur, ...b };
    const name = str(n.name, 80);
    if (!name) throw fail(400, 'Package name is required');
    let service_id = n.service_id ? Number(n.service_id) : null;
    if (service_id && !one('SELECT 1 FROM services WHERE id = ? AND business_id = ?', service_id, bid)) throw fail(400, 'Service not found');
    return {
      name, description: str(n.description, 300) || null, price: num(n.price, 'Price'), sessions: int(n.sessions, 'Sessions', 1, 200),
      service_id, valid_days: int(n.valid_days ?? 365, 'Validity', 1, 1825), active: n.active === undefined ? 1 : n.active ? 1 : 0,
    };
  };
  biz.get('/packages', (req, res) => {
    res.json(all('SELECT id, name, description, price, sessions, service_id, valid_days FROM packages WHERE business_id = ? AND active = 1 ORDER BY price', req.biz.id));
  });
  biz.get('/admin/packages', requireAuth('admin'), (req, res) => {
    res.json(
      all(
        `SELECT p.*, (SELECT COUNT(*) FROM customer_packages cp WHERE cp.package_id = p.id) AS sold
         FROM packages p WHERE p.business_id = ? ORDER BY p.active DESC, p.name`, req.biz.id
      )
    );
  });
  biz.post('/admin/packages', requireAuth('admin'), (req, res) => {
    const v = packageFields(req.biz.id, req.body || {});
    const r = run('INSERT INTO packages (business_id, name, description, price, sessions, service_id, valid_days, active) VALUES (?,?,?,?,?,?,?,?)',
      req.biz.id, v.name, v.description, v.price, v.sessions, v.service_id, v.valid_days, v.active);
    res.status(201).json({ id: Number(r.lastInsertRowid) });
  });
  biz.put('/admin/packages/:id', requireAuth('admin'), (req, res) => {
    const cur = one('SELECT * FROM packages WHERE id = ? AND business_id = ?', req.params.id, req.biz.id);
    if (!cur) return res.status(404).json({ error: 'Package not found' });
    const v = packageFields(req.biz.id, req.body || {}, cur);
    run('UPDATE packages SET name=?, description=?, price=?, sessions=?, service_id=?, valid_days=?, active=? WHERE id=?',
      v.name, v.description, v.price, v.sessions, v.service_id, v.valid_days, v.active, cur.id);
    res.json({ ok: true });
  });
  biz.delete('/admin/packages/:id', requireAuth('admin'), (req, res) => {
    const cur = one('SELECT id FROM packages WHERE id = ? AND business_id = ?', req.params.id, req.biz.id);
    if (!cur) return res.status(404).json({ error: 'Package not found' });
    if (one('SELECT 1 FROM customer_packages WHERE package_id = ?', cur.id)) {
      run('UPDATE packages SET active = 0 WHERE id = ?', cur.id);
      return res.json({ ok: true, hidden: true });
    }
    run('DELETE FROM packages WHERE id = ?', cur.id);
    res.json({ ok: true, deleted: true });
  });

  // ---------------- customers ----------------
  function customerIdFrom(bid, body) {
    if (body.user_id) {
      if (!one("SELECT 1 FROM users WHERE id = ? AND business_id = ? AND role = 'customer'", body.user_id, bid)) throw fail(404, 'Customer not found');
      return Number(body.user_id);
    }
    const name = str(body.customer?.name, 80);
    const phone = str(body.customer?.phone, 20);
    if (!name || !phone) throw fail(400, 'Choose a customer, or enter a name and phone number');
    const u = one('SELECT id, role FROM users WHERE business_id = ? AND phone = ?', bid, phone);
    if (u) {
      if (u.role !== 'customer') throw fail(409, 'That phone number belongs to a team member');
      return u.id;
    }
    const pw = bcrypt.hashSync(crypto.randomBytes(12).toString('hex'), 10);
    return Number(run('INSERT INTO users (business_id, name, phone, password_hash) VALUES (?,?,?,?)', bid, name, phone, pw).lastInsertRowid);
  }

  const invoiceRows = (bid, userId) =>
    all(
      `SELECT i.id, i.number, i.total, i.created_at,
         COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid
       FROM invoices i WHERE i.business_id = ? AND i.user_id = ? ORDER BY i.id`, bid, userId
    ).map((r) => ({ ...r, paid: round2(r.paid), due: round2(r.total - r.paid), label: label(bid, r.number) }));
  const dueOf = (bid, userId) => round2(invoiceRows(bid, userId).reduce((s, r) => s + Math.max(0, r.due), 0));

  // ---------------- invoice creation ----------------
  // rows are already checked; payments are cash/upi/card amounts; packagePay is the value covered by package sessions
  function writeInvoice({ B, userId, bookingId, rows, discount, tip, payments, packagePay }) {
    const subtotal = round2(rows.reduce((s, r) => s + r.price * r.qty, 0));
    if (discount > subtotal) throw fail(400, 'Discount is more than the bill');
    const pct = Number(setting(B, 'gst_percent', '0')) || 0;
    const tax = round2(((subtotal - discount) * pct) / 100);
    const total = round2(subtotal - discount + tax + tip);
    // a package session pays for its service including the GST on it
    const cover = round2(Math.min(packagePay * (1 + pct / 100), total));
    const paid = round2(payments.reduce((s, p) => s + p.amount, 0) + cover);
    if (paid > total + 0.009) throw fail(400, 'Payment is more than the bill');
    const number = one('SELECT COALESCE(MAX(number), 0) + 1 AS n FROM invoices WHERE business_id = ?', B).n;
    const id = Number(
      db
        .prepare("INSERT INTO invoices (business_id, number, booking_id, user_id, subtotal, discount, tax, tax_percent, tip, total, created_at) VALUES (?,?,?,?,?,?,?,?,?,?, datetime('now','localtime'))")
        .run(B, number, bookingId, userId, subtotal, discount, tax, pct, tip, total).lastInsertRowid
    );
    const insItem = db.prepare('INSERT INTO invoice_items (invoice_id, kind, ref_id, name, qty, price, staff_id) VALUES (?,?,?,?,?,?,?)');
    rows.forEach((r) => insItem.run(id, r.kind, r.ref_id, r.name, r.qty, r.price, r.staff_id));
    const insPay = db.prepare("INSERT INTO payments (business_id, invoice_id, amount, method, created_at) VALUES (?,?,?,?, datetime('now','localtime'))");
    payments.forEach((p) => insPay.run(B, id, p.amount, p.method));
    if (cover > 0) insPay.run(B, id, cover, 'package');
    return { id, number, label: label(B, number), subtotal, discount, tax, tip, total, paid, due: round2(total - paid) };
  }

  function readPayments(list) {
    if (!Array.isArray(list)) return [];
    if (list.length > 6) throw fail(400, 'Too many payments');
    return list
      .filter((p) => p && Number(p.amount) > 0)
      .map((p) => {
        if (!METHODS.includes(p.method)) throw fail(400, 'Payment method must be cash, upi or card');
        return { method: p.method, amount: round2(num(p.amount, 'Payment amount', 0.01)) };
      });
  }

  biz.post('/admin/checkout', requireAuth('admin'), (req, res) => {
    const B = req.biz.id;
    const body = req.body || {};
    const result = tx(() => {
      let booking = null;
      let userId;
      if (body.booking_id) {
        booking = one('SELECT b.*, s.price AS service_price FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.id = ? AND b.business_id = ?', body.booking_id, B);
        if (!booking) throw fail(404, 'Booking not found');
        if (booking.status === 'cancelled' || booking.status === 'no_show') throw fail(409, 'This booking was cancelled');
        if (one('SELECT 1 FROM invoices WHERE booking_id = ?', booking.id)) throw fail(409, 'This booking already has a bill');
        userId = booking.user_id;
      } else {
        userId = customerIdFrom(B, body);
      }

      let items = Array.isArray(body.items) ? body.items : [];
      if (!items.length && booking) items = [{ kind: 'service', ref_id: booking.service_id, price: booking.price ?? booking.service_price, qty: 1, staff_id: booking.staff_id }];
      if (!items.length) throw fail(400, 'Add at least one item');
      if (items.length > 30) throw fail(400, 'Too many items');

      let packageValue = 0;
      const rows = items.map((it) => {
        const kind = ['service', 'product', 'custom'].includes(it.kind) ? it.kind : 'custom';
        const qty = int(it.qty ?? 1, 'Quantity', 1, 100);
        let name = str(it.name, 80);
        let ref_id = null;
        let price = it.price;
        let staff_id = it.staff_id ? Number(it.staff_id) : booking && kind === 'service' ? booking.staff_id : null;
        if (staff_id && !one('SELECT 1 FROM staff WHERE id = ? AND business_id = ?', staff_id, B)) throw fail(400, 'Team member not found');
        if (kind === 'service' && it.ref_id) {
          const s = one('SELECT * FROM services WHERE id = ? AND business_id = ?', it.ref_id, B);
          if (!s) throw fail(400, 'Service not found');
          ref_id = s.id;
          name = name || s.name;
          price = price ?? s.price;
        }
        if (kind === 'product') {
          const p = one('SELECT * FROM products WHERE id = ? AND business_id = ?', it.ref_id, B);
          if (!p) throw fail(400, 'Product not found');
          if (p.stock < qty) throw fail(409, `Only ${p.stock} of ${p.name} in stock`);
          run('UPDATE products SET stock = stock - ? WHERE id = ?', qty, p.id);
          ref_id = p.id;
          name = name || p.name;
          price = price ?? p.price;
        }
        if (!name) throw fail(400, 'Every item needs a name');
        price = round2(num(price, 'Price'));
        if (it.customer_package_id) {
          if (kind !== 'service' || qty !== 1) throw fail(400, 'A package session covers one service');
          const cp = one('SELECT * FROM customer_packages WHERE id = ? AND business_id = ? AND user_id = ?', it.customer_package_id, B, userId);
          if (!cp) throw fail(404, 'Package not found for this customer');
          if (cp.sessions_left < 1) throw fail(409, 'No sessions left in that package');
          if (cp.expires < todayStr()) throw fail(409, 'That package has expired');
          if (cp.service_id && cp.service_id !== ref_id) throw fail(409, 'That package is for a different service');
          run('UPDATE customer_packages SET sessions_left = sessions_left - 1 WHERE id = ?', cp.id);
          packageValue += price;
        }
        return { kind, ref_id, name, qty, price, staff_id };
      });

      const subtotal = rows.reduce((s, r) => s + r.price * r.qty, 0);
      const discount = round2(num(body.discount ?? 0, 'Discount', 0, subtotal));
      const tip = round2(num(body.tip ?? 0, 'Tip'));
      const inv = writeInvoice({ B, userId, bookingId: booking?.id ?? null, rows, discount, tip, payments: readPayments(body.payments), packagePay: packageValue });

      if (booking) {
        // keep booking income in line with what was really charged for the services
        const serviceNet = rows.filter((r) => r.kind === 'service').reduce((s, r) => s + r.price * r.qty, 0);
        const net = subtotal > 0 ? round2(serviceNet * (1 - discount / subtotal)) : 0;
        run("UPDATE bookings SET price = ?, status = CASE WHEN status = 'booked' THEN 'completed' ELSE status END WHERE id = ?", net, booking.id);
        if (booking.status === 'booked') {
          const sn = one('SELECT name FROM services WHERE id = ?', booking.service_id)?.name || 'visit';
          notify(userId, 'Thanks for visiting! Tell us how your ' + sn + ' went: open My bookings and rate your visit.');
        }
      }
      return inv;
    });
    res.status(201).json(result);
  });

  // sell a package to a customer (creates a bill and the customer's sessions)
  biz.post('/admin/packages/:id/sell', requireAuth('admin'), (req, res) => {
    const B = req.biz.id;
    const body = req.body || {};
    const result = tx(() => {
      const pkg = one('SELECT * FROM packages WHERE id = ? AND business_id = ? AND active = 1', req.params.id, B);
      if (!pkg) throw fail(404, 'Package not found');
      const userId = customerIdFrom(B, body);
      const rows = [{ kind: 'package', ref_id: pkg.id, name: pkg.name, qty: 1, price: pkg.price, staff_id: null }];
      const discount = round2(num(body.discount ?? 0, 'Discount', 0, pkg.price));
      const inv = writeInvoice({ B, userId, bookingId: null, rows, discount, tip: 0, payments: readPayments(body.payments), packagePay: 0 });
      const exp = new Date();
      exp.setDate(exp.getDate() + pkg.valid_days);
      const expires = `${exp.getFullYear()}-${String(exp.getMonth() + 1).padStart(2, '0')}-${String(exp.getDate()).padStart(2, '0')}`;
      run('INSERT INTO customer_packages (business_id, user_id, package_id, name, service_id, sessions_left, expires) VALUES (?,?,?,?,?,?,?)',
        B, userId, pkg.id, pkg.name, pkg.service_id, pkg.sessions, expires);
      return { ...inv, expires, sessions: pkg.sessions };
    });
    res.status(201).json(result);
  });

  // ---------------- payments against what a customer owes ----------------
  function receive(B, userId, amount, method, onlyInvoice) {
    if (!METHODS.includes(method)) throw fail(400, 'Payment method must be cash, upi or card');
    amount = round2(num(amount, 'Amount', 0.01));
    let open = invoiceRows(B, userId).filter((r) => r.due > 0.009);
    if (onlyInvoice) open = open.filter((r) => r.id === onlyInvoice);
    const owed = round2(open.reduce((s, r) => s + r.due, 0));
    if (owed <= 0) throw fail(409, 'Nothing is due');
    if (amount > owed + 0.009) throw fail(400, `More than the ${owed} that is due`);
    let left = amount;
    const ins = db.prepare("INSERT INTO payments (business_id, invoice_id, amount, method, created_at) VALUES (?,?,?,?, datetime('now','localtime'))");
    for (const r of open) {
      if (left <= 0.009) break;
      const part = round2(Math.min(left, r.due));
      ins.run(B, r.id, part, method);
      left = round2(left - part);
    }
    return { received: amount, due_left: round2(owed - amount) };
  }
  biz.post('/admin/customers/:id/payments', requireAuth('admin'), (req, res) => {
    const B = req.biz.id;
    if (!one("SELECT 1 FROM users WHERE id = ? AND business_id = ? AND role = 'customer'", req.params.id, B)) return res.status(404).json({ error: 'Customer not found' });
    res.json(tx(() => receive(B, Number(req.params.id), req.body?.amount, req.body?.method)));
  });
  biz.post('/admin/invoices/:id/payments', requireAuth('admin'), (req, res) => {
    const B = req.biz.id;
    const inv = one('SELECT id, user_id FROM invoices WHERE id = ? AND business_id = ?', req.params.id, B);
    if (!inv) return res.status(404).json({ error: 'Bill not found' });
    res.json(tx(() => receive(B, inv.user_id, req.body?.amount, req.body?.method, inv.id)));
  });

  // ---------------- reading bills ----------------
  function invoiceDetail(B, id) {
    const inv = one('SELECT * FROM invoices WHERE id = ? AND business_id = ?', id, B);
    if (!inv) return null;
    const items = all('SELECT ii.*, st.name AS staff_name FROM invoice_items ii LEFT JOIN staff st ON st.id = ii.staff_id WHERE ii.invoice_id = ? ORDER BY ii.id', inv.id);
    const payments = all('SELECT amount, method, created_at FROM payments WHERE invoice_id = ? ORDER BY id', inv.id);
    const paid = round2(payments.reduce((s, p) => s + p.amount, 0));
    const customer = one('SELECT id, name, phone FROM users WHERE id = ?', inv.user_id);
    const s = Object.fromEntries(all('SELECT key, value FROM settings WHERE business_id = ?', B).map((r) => [r.key, r.value]));
    const bz = one('SELECT name FROM businesses WHERE id = ?', B);
    return {
      ...inv, label: label(B, inv.number), items, payments, paid, due: round2(inv.total - paid), customer,
      business: { name: bz.name, address: s.address || '', city: s.city || '', phone: s.phone || '', gst_number: s.gst_number || '', upi_id: s.upi_id || '', footer: s.invoice_footer || '' },
    };
  }
  biz.get('/invoices/:id', requireAuth(), (req, res) => {
    const d = invoiceDetail(req.biz.id, req.params.id);
    if (!d) return res.status(404).json({ error: 'Bill not found' });
    if (req.user.role !== 'admin' && d.user_id !== req.user.id) return res.status(404).json({ error: 'Bill not found' });
    res.json(d);
  });

  biz.get('/admin/invoices', requireAuth('admin'), (req, res) => {
    const B = req.biz.id;
    const q = str(req.query.q, 40).toLowerCase();
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : null;
    const to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
    let rows = all(
      `SELECT i.id, i.number, i.total, i.tax, i.tip, i.created_at, u.name AS customer_name, u.phone AS customer_phone,
         COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.invoice_id = i.id), 0) AS paid
       FROM invoices i JOIN users u ON u.id = i.user_id
       WHERE i.business_id = ? ${from ? 'AND SUBSTR(i.created_at,1,10) >= ?' : ''} ${to ? 'AND SUBSTR(i.created_at,1,10) <= ?' : ''}
       ORDER BY i.id DESC LIMIT 500`,
      ...[B, ...(from ? [from] : []), ...(to ? [to] : [])]
    ).map((r) => ({ ...r, paid: round2(r.paid), due: round2(r.total - r.paid), label: label(B, r.number) }));
    if (q) rows = rows.filter((r) => (r.label + r.customer_name + r.customer_phone).toLowerCase().includes(q));
    if (req.query.status === 'due') rows = rows.filter((r) => r.due > 0.009);
    res.json(rows);
  });

  // one customer's account: what they owe, their bills and their package sessions
  const activePackages = (bid, userId) =>
    all("SELECT id, name, service_id, sessions_left, expires FROM customer_packages WHERE business_id = ? AND user_id = ? AND sessions_left > 0 AND expires >= ? ORDER BY expires", bid, userId, todayStr());
  biz.get('/admin/customers/:id/account', requireAuth('admin'), (req, res) => {
    const B = req.biz.id;
    if (!one("SELECT 1 FROM users WHERE id = ? AND business_id = ? AND role = 'customer'", req.params.id, B)) return res.status(404).json({ error: 'Customer not found' });
    const inv = invoiceRows(B, Number(req.params.id));
    res.json({ due: round2(inv.reduce((s, r) => s + Math.max(0, r.due), 0)), invoices: inv.slice(-20).reverse(), packages: activePackages(B, Number(req.params.id)) });
  });
  biz.get('/me/wallet', requireAuth('customer'), (req, res) => {
    const B = req.biz.id;
    const inv = invoiceRows(B, req.user.id);
    res.json({ due: round2(inv.reduce((s, r) => s + Math.max(0, r.due), 0)), invoices: inv.slice(-20).reverse(), packages: activePackages(B, req.user.id) });
  });

  // ---------------- commission and the month's money ----------------
  // Commission = percent of what each team member's service lines earned, after the bill's discount.
  function commission(B, month, onlyStaffId) {
    const items = all(
      `SELECT ii.invoice_id, ii.name, ii.qty, ii.price, ii.staff_id, i.subtotal, i.discount, SUBSTR(i.created_at,1,10) AS day,
              st.name AS staff_name, st.commission_pct, u.name AS customer
       FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id JOIN staff st ON st.id = ii.staff_id JOIN users u ON u.id = i.user_id
       WHERE i.business_id = ? AND ii.kind = 'service' AND SUBSTR(i.created_at,1,7) = ? ${onlyStaffId ? 'AND ii.staff_id = ?' : ''}
       ORDER BY i.id`,
      ...[B, month, ...(onlyStaffId ? [onlyStaffId] : [])]
    );
    const byStaff = new Map();
    const lines = items.map((r) => {
      const net = round2(r.price * r.qty * (r.subtotal > 0 ? 1 - r.discount / r.subtotal : 1));
      const comm = round2((net * r.commission_pct) / 100);
      const s = byStaff.get(r.staff_id) || { staff_id: r.staff_id, name: r.staff_name, pct: r.commission_pct, services: 0, base: 0, commission: 0 };
      s.services += r.qty;
      s.base = round2(s.base + net);
      s.commission = round2(s.commission + comm);
      byStaff.set(r.staff_id, s);
      return { date: r.day, service: r.name, customer: r.customer, amount: net, commission: comm };
    });
    return { staff: [...byStaff.values()].sort((a, b) => b.commission - a.commission), lines };
  }
  c.money = { commission, round2 };

  biz.get('/admin/money', requireAuth('admin'), (req, res) => {
    const B = req.biz.id;
    const month = /^\d{4}-\d{2}$/.test(req.query.month || '') ? req.query.month : todayStr().slice(0, 7);
    const inv = one(
      "SELECT COUNT(*) AS count, COALESCE(SUM(total),0) AS sales, COALESCE(SUM(tax),0) AS tax, COALESCE(SUM(tip),0) AS tips, COALESCE(SUM(discount),0) AS discounts FROM invoices WHERE business_id = ? AND SUBSTR(created_at,1,7) = ?",
      B, month
    );
    const collected = all("SELECT method, COALESCE(SUM(amount),0) AS amount FROM payments WHERE business_id = ? AND SUBSTR(created_at,1,7) = ? GROUP BY method", B, month);
    const outstanding = one(
      `SELECT COALESCE(SUM(i.total),0) - COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.business_id = ?),0) AS due FROM invoices i WHERE i.business_id = ?`, B, B
    ).due;
    const products = all(
      `SELECT ii.name, SUM(ii.qty) AS qty, SUM(ii.qty * ii.price) AS amount FROM invoice_items ii JOIN invoices i ON i.id = ii.invoice_id
       WHERE i.business_id = ? AND ii.kind = 'product' AND SUBSTR(i.created_at,1,7) = ? GROUP BY ii.name ORDER BY qty DESC LIMIT 5`, B, month
    );
    const cash = collected.filter((r) => r.method !== 'package').reduce((s, r) => s + r.amount, 0);
    res.json({
      month, invoices: inv.count, sales: round2(inv.sales), tax: round2(inv.tax), tips: round2(inv.tips), discounts: round2(inv.discounts),
      collected: collected.map((r) => ({ method: r.method, amount: round2(r.amount) })), received: round2(cash),
      due_total: round2(outstanding), commission: commission(B, month).staff, products,
      low_stock: all('SELECT id, name, stock FROM products WHERE business_id = ? AND active = 1 AND stock <= 3 ORDER BY stock, name LIMIT 10', B),
    });
  });
  void toTime;
};
