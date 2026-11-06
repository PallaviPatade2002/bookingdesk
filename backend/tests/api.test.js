process.env.DB_FILE = ':memory:';
process.env.SIGNUP_LIMIT = '1000';
const test = require('node:test');
const assert = require('node:assert');
const bcrypt = require('bcryptjs');
const app = require('../src/app');
const db = require('../src/db');

let server, base;
const SLUG = 'test-salon';
// business-level routes live under /api/b/<slug>/...; signup/platform/slug-check are global
const biz = (p) => (/^\/api\/(signup|platform|slug-check|types)/.test(p) ? p : p.replace('/api/', '/api/b/' + SLUG + '/'));
test.before(
  () =>
    new Promise((resolve) => {
      server = app.listen(0, () => {
        base = 'http://localhost:' + server.address().port;
        resolve();
      });
    })
);
test.after(() => server.close());

const call = async (method, path, body, token) => {
  const res = await fetch(base + biz(path), {
    method,
    headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) },
    body: body && JSON.stringify(body),
  });
  return { status: res.status, body: await res.json() };
};

// a Monday far in the future (business is open Mon-Sat by default)
const MONDAY = '2099-01-05';
const SUNDAY = '2099-01-04';

test('booking flow, double-booking and admin controls', async () => {
  const su = await call('POST', '/api/signup', { business_name: 'Test Salon', owner_name: 'Owner', phone: '1', password: 'secret1', type: 'beauty', sample: false });
  assert.equal(su.status, 201);
  assert.equal(su.body.slug, SLUG);
  const adm = (await call('POST', '/api/auth/login', { phone: '1', password: 'secret1' })).body.token;

  const svc = await call('POST', '/api/services', { name: 'Haircut', duration_min: 30, price: 200 }, adm);
  assert.equal(svc.status, 201);
  const sid = svc.body.id;

  const a = (await call('POST', '/api/auth/register', { name: 'A', phone: '2', password: 'abcdef' })).body.token;
  const b = (await call('POST', '/api/auth/register', { name: 'B', phone: '3', password: 'abcdef' })).body.token;

  // customers cannot manage services
  assert.equal((await call('POST', '/api/services', { name: 'x', duration_min: 10, price: 1 }, a)).status, 403);

  const slots = (await call('GET', `/api/slots?date=${MONDAY}&service_id=${sid}`)).body.slots;
  assert.equal(slots[0], '09:00');
  assert.equal(slots.at(-1), '17:30');

  const first = await call('POST', '/api/bookings', { service_id: sid, date: MONDAY, time: '10:00' }, a);
  assert.equal(first.status, 201);

  // same slot and overlapping slots are refused, adjacent ones are fine
  assert.equal((await call('POST', '/api/bookings', { service_id: sid, date: MONDAY, time: '10:00' }, b)).status, 409);
  assert.equal((await call('POST', '/api/bookings', { service_id: sid, date: MONDAY, time: '10:15' }, b)).status, 409);
  assert.equal((await call('POST', '/api/bookings', { service_id: sid, date: MONDAY, time: '10:30' }, b)).status, 201);

  // cancelling frees the slot
  assert.equal((await call('PATCH', `/api/bookings/${first.body.id}/cancel`, null, a)).status, 200);
  assert.equal((await call('POST', '/api/bookings', { service_id: sid, date: MONDAY, time: '10:00' }, b)).status, 201);

  // a customer cannot cancel someone else's booking
  const mine = (await call('GET', '/api/bookings/mine', null, b)).body;
  assert.equal(mine.length, 2);
  assert.equal((await call('PATCH', `/api/bookings/${mine[0].id}/cancel`, null, a)).status, 404);

  // closed day has no slots; past dates are refused
  assert.deepEqual((await call('GET', `/api/slots?date=${SUNDAY}&service_id=${sid}`)).body.slots, []);
  assert.equal((await call('POST', '/api/bookings', { service_id: sid, date: '2020-01-06', time: '10:00' }, a)).status, 409);

  // admin sees bookings and can complete one; report counts income
  const all = (await call('GET', `/api/admin/bookings?date=${MONDAY}`, null, adm)).body;
  assert.equal(all.filter((x) => x.status === 'booked').length, 2);
  const active = all.find((x) => x.status === 'booked');
  assert.equal((await call('PATCH', `/api/admin/bookings/${active.id}`, { status: 'completed' }, adm)).status, 200);
  const rep = (await call('GET', '/api/admin/report?month=2099-01', null, adm)).body;
  assert.equal(rep.completed, 1);
  assert.equal(rep.income, 200);
  assert.equal(rep.cancelled, 1);

  // holiday empties the day
  await call('POST', '/api/admin/holidays', { date: MONDAY, reason: 'Festival' }, adm);
  assert.deepEqual((await call('GET', `/api/slots?date=${MONDAY}&service_id=${sid}`)).body.slots, []);
});

const login = async (phone, password) => (await call('POST', '/api/auth/login', { phone, password })).body.token;
const WEDNESDAY = '2099-01-07';
const TUESDAY = '2099-01-06';

test('owner manages services and settings', async () => {
  const adm = await login('1', 'secret1');
  const cust = (await call('POST', '/api/auth/register', { name: 'C', phone: '20', password: 'abcdef' })).body.token;

  const made = await call('POST', '/api/services', { name: 'Threading', category: 'Skin', duration_min: 15, price: 50, image_url: '/photos/facial.jpg' }, adm);
  assert.equal(made.status, 201);
  const id = made.body.id;

  // validation: bad image link and bad numbers are refused
  assert.equal((await call('PUT', `/api/services/${id}`, { image_url: 'javascript:alert(1)' }, adm)).status, 400);
  assert.equal((await call('PUT', `/api/services/${id}`, { price: -5 }, adm)).status, 400);

  // edit keeps the other fields
  assert.equal((await call('PUT', `/api/services/${id}`, { price: 70, category: 'Brows' }, adm)).status, 200);
  const row = (await call('GET', '/api/services/all', null, adm)).body.find((s) => s.id === id);
  assert.equal(row.price, 70);
  assert.equal(row.name, 'Threading');
  assert.equal(row.category, 'Brows');

  // no bookings -> deleted; with bookings -> hidden
  assert.equal((await call('DELETE', `/api/services/${id}`, null, adm)).body.deleted, true);
  const used = (await call('POST', '/api/services', { name: 'Wax', duration_min: 30, price: 100 }, adm)).body.id;
  await call('POST', '/api/bookings', { service_id: used, date: TUESDAY, time: '16:00' }, cust);
  assert.equal((await call('DELETE', `/api/services/${used}`, null, adm)).body.hidden, true);
  assert.equal((await call('GET', '/api/services')).body.some((s) => s.id === used), false);

  // settings: public read, admin-only write
  assert.equal((await call('GET', '/api/settings')).body.name, 'Test Salon');
  assert.equal((await call('PUT', '/api/settings', { name: 'X' }, cust)).status, 403);
  assert.equal((await call('PUT', '/api/settings', { name: '' }, adm)).status, 400);
  assert.equal((await call('PUT', '/api/settings', { name: 'Rose Salon', phone: '999' }, adm)).body.name, 'Rose Salon');
});

test('stylist-wise slots, any-stylist assignment and days off', async () => {
  const adm = await login('1', 'secret1');
  const a = await login('2', 'abcdef');
  const b = await login('3', 'abcdef');
  const sid = (await call('POST', '/api/services', { name: 'Facial', duration_min: 60, price: 800 }, adm)).body.id;

  const s1 = (await call('POST', '/api/admin/staff', { name: 'Anu', service_ids: [sid] }, adm)).body.id;
  const s2 = (await call('POST', '/api/admin/staff', { name: 'Bina', service_ids: [sid], days_off: [3] }, adm)).body.id;
  assert.equal((await call('POST', '/api/admin/staff', { name: '' }, adm)).status, 400);
  assert.equal((await call('POST', '/api/admin/staff', { name: 'Z', days_off: [9] }, adm)).status, 400);
  assert.equal((await call('GET', `/api/staff?service_id=${sid}`)).body.length, 2);

  // Anu is booked at 10:00 -> a second customer with "any stylist" gets Bina
  const first = await call('POST', '/api/bookings', { service_id: sid, date: TUESDAY, time: '10:00', staff_id: s1 }, a);
  assert.equal(first.body.staff_id, s1);
  assert.equal((await call('POST', '/api/bookings', { service_id: sid, date: TUESDAY, time: '10:00', staff_id: s1 }, b)).status, 409);
  const any = await call('POST', '/api/bookings', { service_id: sid, date: TUESDAY, time: '10:00' }, b);
  assert.equal(any.status, 201);
  assert.equal(any.body.staff_id, s2);

  // both busy now, so 10:00 is gone for everyone, but 11:00 is free
  const slots = (await call('GET', `/api/slots?date=${TUESDAY}&service_id=${sid}`)).body.slots;
  assert.equal(slots.includes('10:00'), false);
  assert.equal(slots.includes('11:00'), true);

  // Bina is off on Wednesday: only Anu's slots exist, and asking for Bina gives none
  assert.equal((await call('GET', `/api/slots?date=${WEDNESDAY}&service_id=${sid}&staff_id=${s2}`)).body.slots.length, 0)
  assert.equal((await call('GET', `/api/slots?date=${WEDNESDAY}&service_id=${sid}&staff_id=${s1}`)).body.slots.length > 0, true);

  // customers see the stylist name on their booking
  const mine = (await call('GET', '/api/bookings/mine', null, b)).body.find((x) => x.id === any.body.id);
  assert.equal(mine.staff_name, 'Bina');

  // stylist with bookings is hidden, not deleted
  assert.equal((await call('DELETE', `/api/admin/staff/${s2}`, null, adm)).body.hidden, true);
  assert.equal((await call('GET', `/api/staff?service_id=${sid}`)).body.length, 1);
});

test('profile and password', async () => {
  const t = await login('2', 'abcdef');
  assert.equal((await call('PUT', '/api/auth/profile', { name: 'Asha' }, t)).status, 200);
  assert.equal((await call('GET', '/api/auth/me', null, t)).body.name, 'Asha');
  assert.equal((await call('PUT', '/api/auth/password', { current: 'wrong1', next: 'newpass1' }, t)).status, 401);
  assert.equal((await call('PUT', '/api/auth/password', { current: 'abcdef', next: '123' }, t)).status, 400);
  assert.equal((await call('PUT', '/api/auth/password', { current: 'abcdef', next: 'newpass1' }, t)).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { phone: '2', password: 'abcdef' })).status, 401);
  assert.equal((await call('POST', '/api/auth/login', { phone: '2', password: 'newpass1' })).status, 200);
});

test('dashboard is admin-only and shapes the stats', async () => {
  const adm = await login('1', 'secret1');
  const cust = await login('3', 'abcdef');
  assert.equal((await call('GET', '/api/admin/dashboard', null, cust)).status, 403);
  const d = (await call('GET', '/api/admin/dashboard', null, adm)).body;
  assert.equal(d.daily.length, 14);
  assert.equal(typeof d.month.income, 'number');
  assert.ok(Array.isArray(d.topServices) && Array.isArray(d.byStaff));
});

test('reschedule, coupons, reviews, walk-in booking and customers', async () => {
  const adm = await login('1', 'secret1');
  const cust = (await call('POST', '/api/auth/register', { name: 'Ria Shah', phone: '40', password: 'abcdef' })).body.token;
  const sid = (await call('POST', '/api/services', { name: 'Cleanup', duration_min: 30, price: 1000 }, adm)).body.id;
  const D1 = '2099-02-02'; // Monday
  const D2 = '2099-02-03';

  // coupon: owner creates, customer applies at booking, price is stored with the booking
  assert.equal((await call('POST', '/api/admin/coupons', { code: 'save20', percent: 20 }, adm)).status, 201);
  assert.equal((await call('POST', '/api/admin/coupons', { code: 'SAVE20', percent: 20 }, adm)).status, 409);
  assert.equal((await call('GET', '/api/coupons/check?code=nope', null, cust)).status, 404);
  assert.equal((await call('GET', '/api/coupons/check?code=save20', null, cust)).body.percent, 20);
  assert.equal((await call('POST', '/api/bookings', { service_id: sid, date: D1, time: '10:00', coupon: 'nope' }, cust)).status, 400);
  const bk = await call('POST', '/api/bookings', { service_id: sid, date: D1, time: '10:00', coupon: 'save20' }, cust);
  assert.equal(bk.status, 201);
  assert.equal(bk.body.price, 800);
  // income uses the discounted price
  await call('PATCH', `/api/admin/bookings/${bk.body.id}`, { status: 'completed' }, adm);
  assert.equal((await call('GET', '/api/admin/report?month=2099-02', null, adm)).body.income, 800);

  // reschedule: own slot is free while moving, other day works, taken slot is refused
  const other = await call('POST', '/api/admin/bookings', { name: 'Walk In', phone: '41', service_id: sid, date: D2, time: '11:00' }, adm);
  assert.equal(other.status, 201);
  const mine2 = await call('POST', '/api/bookings', { service_id: sid, date: D1, time: '12:00' }, cust);
  assert.equal((await call('PATCH', `/api/bookings/${mine2.body.id}/reschedule`, { date: D2, time: '11:00' }, cust)).status, 409);
  assert.equal((await call('PATCH', `/api/bookings/${mine2.body.id}/reschedule`, { date: D1, time: '12:15' }, cust)).status, 200);
  assert.equal((await call('PATCH', `/api/bookings/${mine2.body.id}/reschedule`, { date: D2, time: '14:00' }, cust)).status, 200);
  assert.equal((await call('PATCH', `/api/bookings/${bk.body.id}/reschedule`, { date: D2, time: '14:00' }, cust)).status, 409); // completed

  // reviews: only after completion, once, 1-5
  assert.equal((await call('POST', `/api/bookings/${mine2.body.id}/review`, { rating: 5 }, cust)).status, 409);
  assert.equal((await call('POST', `/api/bookings/${bk.body.id}/review`, { rating: 9 }, cust)).status, 400);
  assert.equal((await call('POST', `/api/bookings/${bk.body.id}/review`, { rating: 5, comment: 'Lovely' }, cust)).status, 201);
  assert.equal((await call('POST', `/api/bookings/${bk.body.id}/review`, { rating: 4 }, cust)).status, 409);
  const rev = (await call('GET', '/api/reviews')).body;
  assert.equal(rev.count, 1);
  assert.equal(rev.items[0].customer, 'Ria');

  // customers list, notes and temporary password
  const list = (await call('GET', '/api/admin/customers', null, adm)).body;
  const ria = list.find((c) => c.phone === '40');
  assert.equal(ria.visits, 1);
  assert.equal(ria.spent, 800);
  assert.equal((await call('PUT', `/api/admin/customers/${ria.id}`, { notes: 'Allergic to latex' }, adm)).status, 200);
  const temp = (await call('POST', `/api/admin/customers/${ria.id}/reset-password`, null, adm)).body.temp_password;
  assert.equal((await call('POST', '/api/auth/login', { phone: '40', password: temp })).status, 200);
  assert.equal((await call('GET', '/api/admin/customers', null, cust)).status, 403);
});

test('cancellation window, notifications, public hours and CSV export', async () => {
  const adm = await login('1', 'secret1');
  const cust = (await call('POST', '/api/auth/register', { name: 'Neel Rao', phone: '60', password: 'abcdef' })).body.token;
  const sid = (await call('POST', '/api/services', { name: 'Polish', duration_min: 15, price: 100 }, adm)).body.id;

  // a booking on the next open day is inside a 72h window, so the customer cannot cancel or move it
  let near = null;
  for (let i = 1; i <= 4 && !near; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const slots = (await call('GET', `/api/slots?date=${iso}&service_id=${sid}`)).body.slots;
    if (slots.length) near = { date: iso, time: slots[0] };
  }
  assert.ok(near, 'expected an open day within 4 days');
  const nb = await call('POST', '/api/bookings', { service_id: sid, date: near.date, time: near.time }, cust);
  assert.equal(nb.status, 201);
  assert.equal((await call('PUT', '/api/settings', { cancel_hours: '99' }, adm)).status, 400);
  await call('PUT', '/api/settings', { cancel_hours: '72' }, adm);
  assert.equal((await call('PATCH', `/api/bookings/${nb.body.id}/cancel`, null, cust)).status, 409);
  assert.equal((await call('PATCH', `/api/bookings/${nb.body.id}/reschedule`, { date: near.date, time: near.time }, cust)).status, 409);
  await call('PUT', '/api/settings', { cancel_hours: '0' }, adm);
  assert.equal((await call('PATCH', `/api/bookings/${nb.body.id}/cancel`, null, cust)).status, 200);

  // owner is notified about customer actions, customer about owner actions
  const ownerNotes = (await call('GET', '/api/notifications', null, adm)).body;
  assert.ok(ownerNotes.unread > 0);
  assert.ok(ownerNotes.items.some((n) => n.text.includes('Neel Rao') && n.text.includes('cancelled')));
  await call('POST', '/api/notifications/read-all', null, adm);
  assert.equal((await call('GET', '/api/notifications', null, adm)).body.unread, 0);

  const D = '2099-03-02';
  const bk = await call('POST', '/api/bookings', { service_id: sid, date: D, time: '10:00' }, cust);
  await call('PATCH', `/api/admin/bookings/${bk.body.id}`, { status: 'completed' }, adm);
  const mine = (await call('GET', '/api/notifications', null, cust)).body;
  assert.ok(mine.items.some((n) => n.text.includes('rate your visit')));
  assert.equal((await call('GET', '/api/notifications')).status, 401);

  // public hours and CSV export (admin only, formula-safe)
  const hours = (await call('GET', '/api/hours')).body;
  assert.equal(hours.length, 7);
  assert.equal(hours[0].open, null);
  const res = await fetch(base + biz('/api/admin/export?month=2099-03'), { headers: { Authorization: 'Bearer ' + adm } });
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/csv/);
  const csv = await res.text();
  assert.match(csv, /^Date,Time,Customer/);
  assert.match(csv, /"2099-03-02","10:00","Neel Rao","60","Polish"/);
  assert.equal((await fetch(base + biz('/api/admin/export'), { headers: { Authorization: 'Bearer ' + cust } })).status, 403);
});

test('businesses are isolated from each other', async () => {
  const admA = await login('1', 'secret1');
  const svcA = (await call('POST', '/api/services', { name: 'Only In A', duration_min: 30, price: 100 }, admA)).body.id;

  // second business: same owner phone is fine because logins are per business
  const two = await (await fetch(base + '/api/signup', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ business_name: 'Other Salon', owner_name: 'Other Owner', phone: '1', password: 'secret2', type: 'clinic' }),
  })).json();
  assert.equal(two.slug, 'other-salon');
  const B = (method, path, body, token) => fetch(base + '/api/b/other-salon' + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) }, body: body && JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  // starter services belong to B only; A's service is invisible there
  const bServices = (await B('GET', '/services')).body;
  assert.ok(bServices.length >= 3 && bServices.every((s) => s.name !== 'Only In A'));
  assert.equal((await B('GET', '/settings')).body.staff_label, 'Doctor');
  assert.equal((await call('GET', '/api/settings')).body.staff_label, 'Stylist');

  // a token from A does nothing in B, and B's owner is not A's owner
  assert.equal((await B('GET', '/admin/customers', null, admA)).status, 401);
  assert.equal((await B('POST', '/auth/login', { phone: '1', password: 'secret1' })).status, 401);
  const admB = two.token;
  assert.equal((await B('GET', '/admin/customers', null, admB)).status, 200);
  assert.equal((await call('GET', '/api/admin/customers', null, admB)).status, 401);

  // the same customer phone can register in both businesses separately
  assert.equal((await call('POST', '/api/auth/register', { name: 'Same Phone', phone: '777', password: 'abcdef' })).status, 201);
  const custB = await B('POST', '/auth/register', { name: 'Same Phone', phone: '777', password: 'abcdef' });
  assert.equal(custB.status, 201);

  // B's customer cannot book A's service, and cannot read A's bookings
  assert.equal((await B('POST', '/bookings', { service_id: svcA, date: '2099-04-06', time: '10:00' }, custB.body.token)).status, 404);
  assert.equal((await B('GET', '/slots?date=2099-04-06&service_id=' + svcA)).status, 404);
  // B's owner cannot edit or delete A's service
  assert.equal((await B('PUT', '/services/' + svcA, { price: 1 }, admB)).status, 404);
  assert.equal((await B('DELETE', '/services/' + svcA, null, admB)).status, 404);

  // unknown business and unknown API routes answer with JSON errors
  assert.equal((await fetch(base + '/api/b/nope/settings')).status, 404);
  assert.equal((await fetch(base + '/api/nothing-here')).status, 404);
});

test('business sign-up validation and web addresses', async () => {
  const post = (body) => fetch(base + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const ok = { business_name: 'Glow Gym', owner_name: 'Raj', phone: '5', password: 'abcdef', type: 'fitness' };
  assert.equal((await post({ ...ok, password: '123' })).status, 400);
  assert.equal((await post({ ...ok, business_name: 'X' })).status, 400);
  assert.equal((await post({ ...ok, slug: 'api' })).status, 409); // reserved word
  assert.equal((await post({ ...ok, slug: 'ab' })).status, 400);
  const first = await post(ok);
  assert.equal(first.status, 201);
  assert.equal((await first.json()).slug, 'glow-gym');
  assert.equal((await post({ ...ok, slug: 'glow-gym' })).status, 409);
  const second = await (await post(ok)).json(); // same name -> automatic unique address
  assert.equal(second.slug, 'glow-gym-2');
  const chk = await (await fetch(base + '/api/slug-check?slug=Glow%20Gym')).json();
  assert.deepEqual(chk, { slug: 'glow-gym', available: false });
  assert.equal((await (await fetch(base + '/api/slug-check?slug=fresh-name')).json()).available, true);
  assert.ok((await (await fetch(base + '/api/types')).json()).length >= 4);
});

test('platform admin lists and suspends businesses', async () => {
  db.prepare("INSERT INTO users (business_id, name, phone, password_hash, role) VALUES (NULL, 'Platform', '9', ?, 'platform')").run(bcrypt.hashSync('platpass', 4));
  const P = (method, path, body, token) => fetch(base + path, {
    method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) }, body: body && JSON.stringify(body),
  }).then(async (r) => ({ status: r.status, body: await r.json() }));

  assert.equal((await P('POST', '/api/platform/login', { phone: '9', password: 'nope' })).status, 401);
  const tok = (await P('POST', '/api/platform/login', { phone: '9', password: 'platpass' })).body.token;
  const list = (await P('GET', '/api/platform/businesses', null, tok)).body;
  const test = list.find((b) => b.slug === SLUG);
  assert.ok(test && test.owner_phone === '1' && test.bookings > 0);

  // business owners and customers cannot use platform routes; platform token cannot act inside a business
  const owner = await login('1', 'secret1');
  assert.equal((await P('GET', '/api/platform/businesses', null, owner)).status, 401);
  assert.equal((await P('GET', '/api/platform/businesses')).status, 401);
  assert.equal((await fetch(base + '/api/b/' + SLUG + '/admin/customers', { headers: { Authorization: 'Bearer ' + tok } })).status, 401);

  // suspending a business turns its whole API off; turning it back on restores it
  assert.equal((await P('PUT', '/api/platform/businesses/' + test.id, { active: false }, tok)).status, 200);
  assert.equal((await call('GET', '/api/settings')).status, 403);
  assert.equal((await P('PUT', '/api/platform/businesses/' + test.id, { active: true }, tok)).status, 200);
  assert.equal((await call('GET', '/api/settings')).status, 200);
});

test('public directory: search, city, distance, listing and suspension', async () => {
  const post = (body) => fetch(base + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
  const dir = async (qs = '') => (await (await fetch(base + '/api/directory' + qs)).json());

  // invalid map pin is refused at sign-up
  assert.equal((await post({ business_name: 'Bad Pin', owner_name: 'X', phone: '31', password: 'abcdef', lat: 123, lng: 10 })).status, 400);

  const near = await (await post({ business_name: 'Near Nails', owner_name: 'N', phone: '32', password: 'abcdef', type: 'beauty', city: 'Pune', lat: 18.52, lng: 73.85 })).json();
  const far = await (await post({ business_name: 'Far Clinic', owner_name: 'F', phone: '33', password: 'abcdef', type: 'clinic', city: 'Mumbai', lat: 19.07, lng: 72.87 })).json();
  const hidden = await (await post({ business_name: 'Hidden Gym', owner_name: 'H', phone: '34', password: 'abcdef', type: 'fitness', city: 'Pune', lat: 18.5, lng: 73.8, listed: false })).json();

  let all = await dir();
  assert.ok(all.some((b) => b.slug === near.slug) && all.some((b) => b.slug === far.slug));
  assert.ok(!all.some((b) => b.slug === hidden.slug), 'unlisted business must not appear');
  assert.ok(all.every((b) => !('listed' in b)));

  // text search matches name and city; type filter works
  assert.deepEqual((await dir('?q=mumbai')).map((b) => b.slug), [far.slug]);
  assert.ok((await dir('?q=near%20nails')).some((b) => b.slug === near.slug));
  assert.ok((await dir('?type=clinic')).every((b) => b.type === 'clinic'));

  // "near me" from Pune: Near Nails comes before Far Clinic and distances are shown
  const sorted = await dir('?lat=18.5204&lng=73.8567');
  const iNear = sorted.findIndex((b) => b.slug === near.slug);
  const iFar = sorted.findIndex((b) => b.slug === far.slug);
  assert.ok(iNear >= 0 && iNear < iFar);
  assert.ok(sorted[iNear].distance_km < 5);
  assert.ok(sorted[iFar].distance_km > 100);

  // owner can move the pin and hide the business from the directory
  const tok = near.token;
  const put = (body) => fetch(base + '/api/b/' + near.slug + '/settings', { method: 'PUT', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + tok }, body: JSON.stringify(body) });
  assert.equal((await put({ lat: '999' })).status, 400);
  assert.equal((await put({ lat: '18.6', lng: '73.9', city: 'Pimpri' })).status, 200);
  assert.ok((await dir('?q=pimpri')).some((b) => b.slug === near.slug));
  assert.equal((await put({ listed: '0' })).status, 200);
  assert.ok(!(await dir()).some((b) => b.slug === near.slug));
  await put({ listed: '1' });

  // a suspended business disappears from the directory
  db.prepare("UPDATE businesses SET active = 0 WHERE slug = ?").run(far.slug);
  assert.ok(!(await dir()).some((b) => b.slug === far.slug));
});

test('brand colour and font: defaults per type, validation, icons', async () => {
  const adm = await login('1', 'secret1');
  const s = (await call('GET', '/api/settings')).body;
  assert.equal(s.brand, '#c9647a'); // beauty default
  assert.equal(s.font, 'serif');
  const clinic = await (await fetch(base + '/api/b/other-salon/settings')).json();
  assert.equal(clinic.brand, '#0f766e'); // clinic default
  assert.equal(clinic.font, 'sans');

  assert.equal((await call('PUT', '/api/settings', { brand: 'red' }, adm)).status, 400);
  assert.equal((await call('PUT', '/api/settings', { brand: '#12345' }, adm)).status, 400);
  assert.equal((await call('PUT', '/api/settings', { font: 'comic' }, adm)).status, 400);
  const saved = (await call('PUT', '/api/settings', { brand: '#2563EB', font: 'sans' }, adm)).body;
  assert.equal(saved.brand, '#2563EB');
  assert.equal(saved.font, 'sans');
  // empty goes back to the type default
  assert.equal((await call('PUT', '/api/settings', { brand: '', font: '' }, adm)).body.brand, '#c9647a');

  // the page and phone-app manifest follow the business colour; icons are real PNGs
  const html = await (await fetch(base + '/b/' + SLUG)).text();
  if (html.includes('<title>')) {
    assert.match(html, /Rose Salon: Book an appointment/);
    assert.match(html, /name="theme-color" content="#c9647a"/);
    const man = await (await fetch(base + '/b/' + SLUG + '/manifest.webmanifest')).json();
    assert.equal(man.start_url, '/b/' + SLUG);
    assert.equal(man.theme_color, '#c9647a');
  }
  const png = await fetch(base + '/icon/192.png?c=0f766e');
  assert.equal(png.status, 200);
  assert.equal(png.headers.get('content-type'), 'image/png');
  const bytes = Buffer.from(await png.arrayBuffer());
  assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
});
