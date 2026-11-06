// Billing, packages, products, khata (what customers owe), commission and the staff portal.
process.env.DB_FILE = ':memory:';
process.env.SIGNUP_LIMIT = '1000';
const test = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');

let server, base;
test.before(() => new Promise((resolve) => { server = app.listen(0, () => { base = 'http://localhost:' + server.address().port; resolve(); }); }));
test.after(() => { server.closeAllConnections(); server.close(); });

const SLUG = 'money-salon';
const call = async (method, path, body, token) => {
  const url = /^\/api\/(signup)/.test(path) ? path : path.replace('/api/', '/api/b/' + SLUG + '/');
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const dayOf = (offset) => { const d = new Date(); d.setDate(d.getDate() + offset); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; };

let adm, cust, custId, svcId, staffId, bookingId, bookingDate;

test('set up a business, a service, a team member and a booking', async () => {
  const su = await call('POST', '/api/signup', { business_name: 'Money Salon', owner_name: 'Owner', phone: '1', password: 'secret1', type: 'beauty', sample: false });
  assert.equal(su.status, 201);
  adm = su.body.token;
  // billing settings are validated
  assert.equal((await call('PUT', '/api/settings', { gst_percent: '99' }, adm)).status, 400);
  assert.equal((await call('PUT', '/api/settings', { upi_id: 'not a upi' }, adm)).status, 400);
  assert.equal((await call('PUT', '/api/settings', { reminder_hours: '100' }, adm)).status, 400);
  assert.equal((await call('PUT', '/api/settings', { invoice_prefix: 'bad prefix!' }, adm)).status, 400);
  const s = (await call('PUT', '/api/settings', { gst_percent: '18', upi_id: 'salon@upi', invoice_prefix: 'MS' }, adm)).body;
  assert.equal(s.gst_percent, '18');
  assert.equal(s.upi_id, 'salon@upi');

  svcId = (await call('POST', '/api/services', { name: 'Cut', duration_min: 30, price: 500 }, adm)).body.id;
  staffId = (await call('POST', '/api/admin/staff', { name: 'Ana', service_ids: [svcId], commission_pct: 20 }, adm)).body.id;
  assert.equal((await call('POST', '/api/admin/staff', { name: 'Bad', commission_pct: 150 }, adm)).status, 400);

  const reg = await call('POST', '/api/auth/register', { name: 'Ria Shah', phone: '40', password: 'abcdef' });
  cust = reg.body.token;
  custId = reg.body.user.id;
  // find an open day with free slots
  for (let i = 2; i < 10 && !bookingId; i++) {
    const d = dayOf(i);
    const slots = (await call('GET', `/api/slots?date=${d}&service_id=${svcId}`)).body.slots;
    if (slots.length) {
      const b = await call('POST', '/api/bookings', { service_id: svcId, date: d, time: slots[0] }, cust);
      assert.equal(b.status, 201);
      bookingId = b.body.id;
      bookingDate = d;
    }
  }
  assert.ok(bookingId);
});

test('products: validation, stock and soft delete', async () => {
  assert.equal((await call('POST', '/api/admin/products', { name: 'Shampoo', price: -1, stock: 1 }, adm)).status, 400);
  assert.equal((await call('POST', '/api/admin/products', { name: 'Shampoo', price: 300, stock: 1.5 }, adm)).status, 400);
  const p = await call('POST', '/api/admin/products', { name: 'Shampoo', price: 300, stock: 5 }, adm);
  assert.equal(p.status, 201);
  assert.equal((await call('GET', '/api/admin/products', null, cust)).status, 403);
  assert.equal((await call('PUT', `/api/admin/products/${p.body.id}`, { stock: 6 }, adm)).status, 200);
  assert.equal((await call('GET', '/api/admin/products', null, adm)).body[0].stock, 6);
  test.productId = p.body.id;
});

test('checkout a booking: tax, discount, tip, part payment, and the customer owes the rest', async () => {
  // not allowed for customers; unknown items and overpaying are refused
  assert.equal((await call('POST', '/api/admin/checkout', { booking_id: bookingId }, cust)).status, 403);
  assert.equal((await call('POST', '/api/admin/checkout', { booking_id: bookingId, discount: 9999 }, adm)).status, 400);
  assert.equal((await call('POST', '/api/admin/checkout', { booking_id: bookingId, payments: [{ method: 'cash', amount: 99999 }] }, adm)).status, 400);
  assert.equal((await call('POST', '/api/admin/checkout', { booking_id: bookingId, payments: [{ method: 'bitcoin', amount: 5 }] }, adm)).status, 400);

  // 500 - 50 discount = 450, +18% GST = 81, +20 tip = 551; 300 paid, 251 due
  const r = await call('POST', '/api/admin/checkout', { booking_id: bookingId, discount: 50, tip: 20, payments: [{ method: 'cash', amount: 300 }] }, adm);
  assert.equal(r.status, 201);
  assert.equal(r.body.total, 551);
  assert.equal(r.body.paid, 300);
  assert.equal(r.body.due, 251);
  assert.equal(r.body.label, 'MS-0001');
  test.invoiceId = r.body.id;

  // the booking is completed and keeps the real (discounted) price; a second bill is refused
  const bk = (await call('GET', '/api/bookings/mine', null, cust)).body.find((b) => b.id === bookingId);
  assert.equal(bk.status, 'completed');
  assert.equal(bk.price, 450);
  assert.equal((await call('POST', '/api/admin/checkout', { booking_id: bookingId }, adm)).status, 409);
  // the failed attempts above left nothing behind
  assert.equal((await call('GET', '/api/admin/invoices', null, adm)).body.length, 1);

  const detail = (await call('GET', `/api/invoices/${r.body.id}`, null, adm)).body;
  assert.equal(detail.tax, 81);
  assert.equal(detail.items[0].staff_name, 'Ana');
  assert.equal(detail.business.upi_id, 'salon@upi');
  assert.equal((await call('GET', `/api/invoices/${r.body.id}`, null, cust)).status, 200); // the customer can see their own bill
  const other = (await call('POST', '/api/auth/register', { name: 'Other', phone: '41', password: 'abcdef' })).body.token;
  assert.equal((await call('GET', `/api/invoices/${r.body.id}`, null, other)).status, 404);
});

test('khata: what a customer owes, receipts, and refusing too much', async () => {
  const list = (await call('GET', '/api/admin/customers', null, adm)).body;
  assert.equal(list.find((x) => x.id === custId).due, 251);
  assert.equal((await call('GET', '/api/me/wallet', null, cust)).body.due, 251);
  assert.equal((await call('GET', '/api/admin/invoices?status=due', null, adm)).body.length, 1);

  assert.equal((await call('POST', `/api/admin/customers/${custId}/payments`, { amount: 1000, method: 'cash' }, adm)).status, 400);
  assert.equal((await call('POST', `/api/admin/customers/${custId}/payments`, { amount: 100, method: 'cash' }, adm)).body.due_left, 151);
  assert.equal((await call('POST', `/api/admin/invoices/${test.invoiceId}/payments`, { amount: 151, method: 'upi' }, adm)).body.due_left, 0);
  assert.equal((await call('POST', `/api/admin/customers/${custId}/payments`, { amount: 10, method: 'cash' }, adm)).status, 409); // nothing due
  assert.equal((await call('GET', '/api/me/wallet', null, cust)).body.due, 0);
});

test('walk-in sale with a product, and a failed sale rolls back stock', async () => {
  const sale = await call('POST', '/api/admin/checkout', {
    customer: { name: 'Walk In', phone: '777' }, items: [{ kind: 'product', ref_id: test.productId, qty: 2 }],
    payments: [{ method: 'upi', amount: 708 }], // 600 + 18% = 708
  }, adm);
  assert.equal(sale.status, 201);
  assert.equal(sale.body.total, 708);
  assert.equal(sale.body.due, 0);
  assert.equal((await call('GET', '/api/admin/products', null, adm)).body[0].stock, 4);

  // one good line and one line asking for more than is in stock: everything is undone
  const bad = await call('POST', '/api/admin/checkout', {
    customer: { name: 'Walk In', phone: '777' },
    items: [{ kind: 'product', ref_id: test.productId, qty: 1 }, { kind: 'product', ref_id: test.productId, qty: 50 }],
  }, adm);
  assert.equal(bad.status, 409);
  assert.equal((await call('GET', '/api/admin/products', null, adm)).body[0].stock, 4);
  assert.equal((await call('GET', '/api/admin/invoices', null, adm)).body.length, 2);

  // a product that was sold is hidden, not deleted
  assert.equal((await call('DELETE', `/api/admin/products/${test.productId}`, null, adm)).body.hidden, true);
});

test('packages: sell sessions, use them at checkout, and the limits', async () => {
  const pkg = await call('POST', '/api/admin/packages', { name: 'Cut x2', price: 800, sessions: 2, service_id: svcId, valid_days: 90 }, adm);
  assert.equal(pkg.status, 201);
  assert.equal((await call('POST', '/api/admin/packages', { name: 'Zero', price: 100, sessions: 0 }, adm)).status, 400);
  assert.equal((await call('POST', `/api/admin/packages/${pkg.body.id}/sell`, { user_id: custId, payments: [{ method: 'cash', amount: 944 }] }, adm)).status, 201); // 800 + 18%

  const wallet = (await call('GET', '/api/me/wallet', null, cust)).body;
  assert.equal(wallet.packages.length, 1);
  assert.equal(wallet.packages[0].sessions_left, 2);
  const cpId = wallet.packages[0].id;

  // using a session pays for the service and its GST
  const use = await call('POST', '/api/admin/checkout', { user_id: custId, items: [{ kind: 'service', ref_id: svcId, price: 500, staff_id: staffId, customer_package_id: cpId }] }, adm);
  assert.equal(use.status, 201);
  assert.equal(use.body.total, 590);
  assert.equal(use.body.due, 0);
  assert.equal((await call('GET', '/api/me/wallet', null, cust)).body.packages[0].sessions_left, 1);

  // wrong customer, wrong service, and no sessions left are all refused
  const other = (await call('POST', '/api/admin/checkout', { customer: { name: 'Walk In', phone: '777' }, items: [{ kind: 'service', ref_id: svcId, price: 500, customer_package_id: cpId }] }, adm));
  assert.equal(other.status, 404);
  const svc2 = (await call('POST', '/api/services', { name: 'Colour', duration_min: 60, price: 1500 }, adm)).body.id;
  assert.equal((await call('POST', '/api/admin/checkout', { user_id: custId, items: [{ kind: 'service', ref_id: svc2, price: 1500, customer_package_id: cpId }] }, adm)).status, 409);
  assert.equal((await call('POST', '/api/admin/checkout', { user_id: custId, items: [{ kind: 'service', ref_id: svcId, price: 500, customer_package_id: cpId }] }, adm)).status, 201);
  assert.equal((await call('POST', '/api/admin/checkout', { user_id: custId, items: [{ kind: 'service', ref_id: svcId, price: 500, customer_package_id: cpId }] }, adm)).status, 409);
  // a package that was sold is hidden, not deleted
  assert.equal((await call('DELETE', `/api/admin/packages/${pkg.body.id}`, null, adm)).body.hidden, true);
});

test('money report and commission', async () => {
  const month = dayOf(0).slice(0, 7);
  const r = (await call('GET', '/api/admin/money?month=' + month, null, adm)).body;
  assert.equal(r.invoices, 5);
  // Ana earned: booking line 450 (after discount) + one package visit at 500 that named her (the other visit named nobody) = 950 at 20%
  const ana = r.commission.find((x) => x.name === 'Ana');
  assert.equal(ana.base, 950);
  assert.equal(ana.commission, 190);
  assert.equal(ana.pct, 20);
  assert.equal(r.due_total, 0);
  assert.ok(r.collected.some((x) => x.method === 'package'));
  assert.equal((await call('GET', '/api/admin/money', null, cust)).status, 403);
});

test('team login and the staff portal', async () => {
  // public team list never shows pay or logins; the owner's list does
  const pub = (await call('GET', '/api/staff')).body[0];
  assert.equal('commission_pct' in pub, false);
  assert.equal('login_phone' in pub, false);
  assert.equal((await call('GET', '/api/admin/staff', null, adm)).body[0].commission_pct, 20);

  assert.equal((await call('POST', `/api/admin/staff/${staffId}/login`, { phone: '40', password: 'staffpw1' }, adm)).status, 409); // used by a customer
  assert.equal((await call('POST', `/api/admin/staff/${staffId}/login`, { phone: '5551', password: '123' }, adm)).status, 400);
  assert.equal((await call('POST', `/api/admin/staff/${staffId}/login`, { phone: '5551', password: 'staffpw1' }, adm)).status, 200);
  assert.equal((await call('GET', '/api/admin/staff', null, adm)).body[0].login_phone, '5551');

  const login = await call('POST', '/api/auth/login', { phone: '5551', password: 'staffpw1' });
  assert.equal(login.body.user.role, 'staff');
  const st = login.body.token;
  assert.equal((await call('GET', '/api/staff/me', null, st)).body.name, 'Ana');
  const day = (await call('GET', `/api/staff/bookings?date=${bookingDate}`, null, st)).body;
  assert.ok(day.some((b) => b.id === bookingId && b.customer_name === 'Ria Shah'));
  const earn = (await call('GET', '/api/staff/earnings', null, st)).body;
  assert.equal(earn.commission, 190);
  assert.equal(earn.lines.length, 2);

  // a team member cannot reach owner or customer areas, and owners/customers cannot use the portal
  assert.equal((await call('GET', '/api/admin/invoices', null, st)).status, 403);
  assert.equal((await call('GET', '/api/admin/customers', null, st)).status, 403);
  assert.equal((await call('POST', '/api/bookings', { service_id: svcId, date: dayOf(3), time: '10:00' }, st)).status, 403);
  assert.equal((await call('GET', '/api/staff/me', null, cust)).status, 403);
  assert.equal((await call('GET', '/api/staff/me', null, adm)).status, 403);
  // not listed as a customer
  assert.ok(!(await call('GET', '/api/admin/customers', null, adm)).body.some((x) => x.phone === '5551'));

  // staff can finish their own booking
  const nb = await call('POST', '/api/bookings', { service_id: svcId, date: dayOf(5), time: (await call('GET', `/api/slots?date=${dayOf(5)}&service_id=${svcId}`)).body.slots[0] || '10:00' }, cust);
  if (nb.status === 201) {
    assert.equal((await call('PATCH', `/api/staff/bookings/${nb.body.id}`, { status: 'completed' }, st)).status, 200);
    assert.equal((await call('PATCH', `/api/staff/bookings/${nb.body.id}`, { status: 'completed' }, st)).status, 409);
  }
  // removing the login
  assert.equal((await call('DELETE', `/api/admin/staff/${staffId}/login`, null, adm)).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { phone: '5551', password: 'staffpw1' })).status, 401);
});
