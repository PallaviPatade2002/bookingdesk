// Gallery, full-day services, quote enquiries and the new business types.
process.env.DB_FILE = ':memory:';
process.env.SIGNUP_LIMIT = '1000';
const test = require('node:test');
const assert = require('node:assert');
const app = require('../src/app');

let server, base;
test.before(() => new Promise((resolve) => { server = app.listen(0, () => { base = 'http://localhost:' + server.address().port; resolve(); }); }));
test.after(() => { server.closeAllConnections(); server.close(); });

const api = (slug) => async (method, path, body, token) => {
  const res = await fetch(base + '/api/b/' + slug + path, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const signup = async (body) => (await (await fetch(base + '/api/signup', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ owner_name: 'O', password: 'secret1', ...body }) })).json());

// next open (Mon-Sat) day that is at least `from` days away
const openDay = (from) => {
  for (let i = from; i < from + 14; i++) {
    const d = new Date();
    d.setDate(d.getDate() + i);
    if (d.getDay() !== 0) return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }
};
const sunday = () => {
  const d = new Date();
  d.setDate(d.getDate() + ((7 - d.getDay()) % 7 || 7) + 7);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

test('new business types start with the right team word, colour and kinds of service', async () => {
  const types = (await (await fetch(base + '/api/types')).json()).map((t) => t.id);
  for (const t of ['beauty', 'clinic', 'fitness', 'photographer', 'events', 'education', 'home', 'pet', 'professional', 'other']) assert.ok(types.includes(t), t);

  const photo = await signup({ business_name: 'Lens Studio', phone: '11', type: 'photographer' });
  const P = api(photo.slug);
  const ps = (await P('GET', '/settings')).body;
  assert.equal(ps.staff_label, 'Photographer');
  assert.equal(ps.font, 'serif');
  const pServices = (await P('GET', '/services')).body;
  assert.ok(pServices.some((s) => s.mode === 'day' && s.ask_venue === 1));

  const ev = await signup({ business_name: 'Party Decor', phone: '12', type: 'events' });
  const eServices = (await api(ev.slug)('GET', '/services')).body;
  assert.ok(eServices.filter((s) => s.mode === 'quote').length >= 3);
  assert.equal((await api(ev.slug)('GET', '/settings')).body.staff_label, 'Planner');

  for (const t of ['education', 'home', 'pet', 'professional']) {
    const b = await signup({ business_name: 'Biz ' + t, phone: '2' + t.length + t, type: t });
    assert.ok((await api(b.slug)('GET', '/services')).body.length >= 3, t);
    assert.match((await api(b.slug)('GET', '/settings')).body.brand, /^#[0-9a-f]{6}$/i);
  }
});

test('gallery: public to read, owner only to change, safe links only', async () => {
  const b = await signup({ business_name: 'Gallery Studio', phone: '13', type: 'photographer', sample: false });
  const G = api(b.slug);
  const cust = (await G('POST', '/auth/register', { name: 'C', phone: '99', password: 'abcdef' })).body.token;
  assert.equal((await G('POST', '/admin/gallery', { url: 'https://example.com/a.jpg' }, cust)).status, 403);
  assert.equal((await G('POST', '/admin/gallery', { url: 'javascript:alert(1)' }, b.token)).status, 400);
  assert.equal((await G('POST', '/admin/gallery', { url: '' }, b.token)).status, 400);
  const a = await G('POST', '/admin/gallery', { url: 'https://example.com/a.jpg', caption: 'Wedding' }, b.token);
  assert.equal(a.status, 201);
  await G('POST', '/admin/gallery', { url: '/photos/hair.jpg' }, b.token);
  const list = (await G('GET', '/gallery')).body;
  assert.equal(list.length, 2);
  assert.equal(list[0].caption, 'Wedding');
  await G('DELETE', `/admin/gallery/${a.body.id}`, null, b.token);
  assert.equal((await G('GET', '/gallery')).body.length, 1);
  // another business cannot delete it
  const other = await signup({ business_name: 'Other Gallery', phone: '14', type: 'photographer', sample: false });
  await api(other.slug)('DELETE', `/admin/gallery/${list[1].id}`, null, other.token);
  assert.equal((await G('GET', '/gallery')).body.length, 1);
});

test('full-day services: venue required, one booking per day, whole opening time', async () => {
  const b = await signup({ business_name: 'Day Studio', phone: '15', type: 'other', sample: false });
  const D = api(b.slug);
  const svc = (await D('POST', '/services', { name: 'Wedding Shoot', duration_min: 60, price: 20000, mode: 'day', ask_venue: true }, b.token)).body.id;
  const cust = (await D('POST', '/auth/register', { name: 'C', phone: '98', password: 'abcdef' })).body.token;
  const cust2 = (await D('POST', '/auth/register', { name: 'C2', phone: '97', password: 'abcdef' })).body.token;
  const day = openDay(3);

  // one slot per day: the opening time; the booking lasts until closing
  const slots = (await D('GET', `/slots?date=${day}&service_id=${svc}`)).body.slots;
  assert.deepEqual(slots, ['09:00']);
  assert.equal((await D('POST', '/bookings', { service_id: svc, date: day, time: '09:00' }, cust)).status, 400); // venue needed
  assert.equal((await D('POST', '/bookings', { service_id: svc, date: day, time: '09:00', venue: 'Hall 1', guests: 'many' }, cust)).status, 400);
  const ok = await D('POST', '/bookings', { service_id: svc, date: day, time: '09:00', venue: 'Rose Garden Hall, Pune', guests: 250 }, cust);
  assert.equal(ok.status, 201);
  const mine = (await D('GET', '/bookings/mine', null, cust)).body[0];
  assert.equal(mine.start, '09:00');
  assert.equal(mine.end, '18:00');
  assert.equal(mine.venue, 'Rose Garden Hall, Pune');
  assert.equal(mine.guests, 250);
  // the day is now taken
  assert.deepEqual((await D('GET', `/slots?date=${day}&service_id=${svc}`)).body.slots, []);
  assert.equal((await D('POST', '/bookings', { service_id: svc, date: day, time: '09:00', venue: 'Elsewhere' }, cust2)).status, 409);
  // cancelling frees it
  await D('PATCH', `/bookings/${ok.body.id}/cancel`, null, cust);
  assert.deepEqual((await D('GET', `/slots?date=${day}&service_id=${svc}`)).body.slots, ['09:00']);
  // owner sees the venue
  await D('POST', '/bookings', { service_id: svc, date: day, time: '09:00', venue: 'Fort Lawns' }, cust2);
  const all = (await D('GET', `/admin/bookings?date=${day}`, null, b.token)).body;
  assert.ok(all.some((x) => x.venue === 'Fort Lawns'));
});

test('quote enquiries: ask, quote, accept, and the limits', async () => {
  const b = await signup({ business_name: 'Decor Co', phone: '16', type: 'other', sample: false });
  const D = api(b.slug);
  const svc = (await D('POST', '/services', { name: 'Stage Decoration', duration_min: 480, price: 0, mode: 'quote', ask_venue: true }, b.token)).body.id;
  const cust = (await D('POST', '/auth/register', { name: 'Meera', phone: '96', password: 'abcdef' })).body.token;
  const day = openDay(5);

  // a quote service cannot be booked like a normal slot
  assert.deepEqual((await D('GET', `/slots?date=${day}&service_id=${svc}`)).body.slots, []);
  assert.equal((await D('POST', '/bookings', { service_id: svc, date: day, time: '09:00', venue: 'x' }, cust)).status, 409);

  // enquiry rules
  assert.equal((await D('POST', '/enquiries', { service_id: svc, date: '2020-01-01', venue: 'x' }, cust)).status, 400);
  assert.equal((await D('POST', '/enquiries', { service_id: svc, date: day }, cust)).status, 400); // venue needed
  const e = await D('POST', '/enquiries', { service_id: svc, date: day, venue: 'Lawn 4', guests: 300, details: 'Pink and gold theme' }, cust);
  assert.equal(e.status, 201);
  assert.equal((await D('GET', '/admin/enquiries', null, cust)).status, 403);
  const row = (await D('GET', '/admin/enquiries', null, b.token)).body[0];
  assert.equal(row.customer_name, 'Meera');
  assert.equal(row.guests, 300);
  assert.ok((await D('GET', '/notifications', null, b.token)).body.items.some((n) => n.text.includes('New enquiry')));

  // nothing to accept before a quote
  assert.equal((await D('POST', `/enquiries/${e.body.id}/accept`, null, cust)).status, 409);
  assert.equal((await D('PATCH', `/admin/enquiries/${e.body.id}`, { status: 'quoted' }, b.token)).status, 400); // price needed
  assert.equal((await D('PATCH', `/admin/enquiries/${e.body.id}`, { status: 'quoted', quote_price: 45000, reply: 'Includes flowers' }, b.token)).status, 200);
  const seen = (await D('GET', '/enquiries/mine', null, cust)).body[0];
  assert.equal(seen.status, 'quoted');
  assert.equal(seen.quote_price, 45000);
  assert.ok((await D('GET', '/notifications', null, cust)).body.items.some((n) => n.text.includes('45000')));

  // accepting the quote makes a full-day booking at that price
  const acc = await D('POST', `/enquiries/${e.body.id}/accept`, null, cust);
  assert.equal(acc.status, 201);
  const bk = (await D('GET', '/bookings/mine', null, cust)).body.find((x) => x.id === acc.body.booking_id);
  assert.equal(bk.price, 45000);
  assert.equal(bk.start, '09:00');
  assert.equal(bk.end, '18:00');
  assert.equal(bk.venue, 'Lawn 4');
  assert.equal((await D('POST', `/enquiries/${e.body.id}/accept`, null, cust)).status, 409); // only once
  assert.equal((await D('PATCH', `/admin/enquiries/${e.body.id}`, { status: 'declined' }, b.token)).status, 409);

  // the owner can also book an enquiry directly, but not on a closed day
  const e2 = (await D('POST', '/enquiries', { service_id: svc, date: sunday(), venue: 'Hall' }, cust)).body.id;
  assert.equal((await D('POST', `/admin/enquiries/${e2}/book`, { price: 30000 }, b.token)).status, 409);
  const e3 = (await D('POST', '/enquiries', { service_id: svc, date: openDay(8), venue: 'Hall' }, cust)).body.id;
  assert.equal((await D('POST', `/admin/enquiries/${e3}/book`, {}, b.token)).status, 400); // no price yet
  assert.equal((await D('POST', `/admin/enquiries/${e3}/book`, { price: 30000 }, b.token)).status, 201);
  assert.equal((await D('PATCH', `/admin/enquiries/${e2}`, { status: 'declined', reply: 'We are closed' }, b.token)).status, 200);
});
