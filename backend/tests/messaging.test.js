// Reminders, the message outbox and provider webhook, forgot-password codes, campaigns and the calendar feed.
process.env.DB_FILE = ':memory:';
process.env.SIGNUP_LIMIT = '1000';
const test = require('node:test');
const assert = require('node:assert');
const http = require('http');
const app = require('../src/app');
const db = require('../src/db');
const messaging = require('../src/messaging');

let server, base;
test.before(() => new Promise((resolve) => { server = app.listen(0, () => { base = 'http://localhost:' + server.address().port; resolve(); }); }));
test.after(() => { server.closeAllConnections(); server.close(); });

const SLUG = 'msg-salon';
const call = async (method, path, body, token) => {
  const url = path.startsWith('/api/signup') ? path : path.replace('/api/', '/api/b/' + SLUG + '/');
  const res = await fetch(base + url, { method, headers: { 'Content-Type': 'application/json', ...(token && { Authorization: 'Bearer ' + token }) }, body: body && JSON.stringify(body) });
  return { status: res.status, body: await res.json().catch(() => ({})) };
};
const outbox = () => db.prepare('SELECT * FROM messages ORDER BY id').all();
const MONDAY = '2099-03-02';

let adm, cust, custId, svcId, bookingId;

test('set up', async () => {
  adm = (await call('POST', '/api/signup', { business_name: 'Msg Salon', owner_name: 'Owner', phone: '1', password: 'secret1', type: 'beauty', sample: false })).body.token;
  await call('PUT', '/api/settings', { phone: '9876543210' }, adm);
  svcId = (await call('POST', '/api/services', { name: 'Facial', duration_min: 60, price: 800 }, adm)).body.id;
  const reg = await call('POST', '/api/auth/register', { name: 'Ria Shah', phone: '40', password: 'abcdef' });
  cust = reg.body.token;
  custId = reg.body.user.id;
  const b = await call('POST', '/api/bookings', { service_id: svcId, date: MONDAY, time: '10:00' }, cust);
  assert.equal(b.status, 201);
  bookingId = b.body.id;
});

test('automatic reminders: only inside the window, only once', () => {
  // 3 days before: outside the 24 hour window
  assert.equal(messaging.runReminders(new Date('2099-02-27T10:00:00')), 0);
  // 6 hours before: queued, recorded as "logged" because no provider is configured (test mode)
  assert.equal(messaging.runReminders(new Date('2099-03-02T04:00:00')), 1);
  const m = outbox().find((x) => x.kind === 'reminder');
  assert.equal(m.phone, '40');
  assert.equal(m.status, 'logged');
  assert.match(m.text, /Facial/);
  assert.match(m.text, /10:00 AM/);
  assert.match(m.text, /9876543210/);
  // running again never sends a second reminder for the same booking
  assert.equal(messaging.runReminders(new Date('2099-03-02T05:00:00')), 0);
  assert.equal(outbox().filter((x) => x.kind === 'reminder').length, 1);
});

test('reminders can be switched off, and cancelled bookings get none', async () => {
  const b2 = await call('POST', '/api/bookings', { service_id: svcId, date: '2099-03-03', time: '10:00' }, cust);
  await call('PUT', '/api/settings', { reminder_hours: '0' }, adm);
  assert.equal(messaging.runReminders(new Date('2099-03-03T04:00:00')), 0);
  await call('PUT', '/api/settings', { reminder_hours: '24' }, adm);
  await call('PATCH', `/api/bookings/${b2.body.id}/cancel`, null, cust);
  assert.equal(messaging.runReminders(new Date('2099-03-03T04:00:00')), 0);
});

test('messages are posted to a provider webhook and failures are recorded', async () => {
  const got = [];
  let answer = 200;
  const hook = http.createServer((req, res) => {
    let body = '';
    req.on('data', (d) => (body += d));
    req.on('end', () => { got.push({ auth: req.headers.authorization, body: JSON.parse(body) }); res.statusCode = answer; res.end('{}'); });
  });
  await new Promise((r) => hook.listen(0, r));
  process.env.MESSAGE_WEBHOOK_URL = 'http://localhost:' + hook.address().port + '/send';
  process.env.MESSAGE_WEBHOOK_TOKEN = 'tok123';
  const bid = db.prepare('SELECT id FROM businesses WHERE slug = ?').get(SLUG).id;

  const id1 = messaging.queue(bid, { userId: custId, phone: '40', text: 'hello one', kind: 'info' });
  await messaging.deliver(id1); // already delivered by queue(); a second call must change nothing
  await new Promise((r) => setTimeout(r, 150));
  assert.equal(db.prepare('SELECT status FROM messages WHERE id = ?').get(id1).status, 'sent');
  assert.equal(got.length, 1);
  assert.equal(got[0].auth, 'Bearer tok123');
  assert.deepEqual({ to: got[0].body.to, text: got[0].body.text, business: got[0].body.business }, { to: '40', text: 'hello one', business: SLUG });

  answer = 500;
  const id2 = messaging.queue(bid, { userId: custId, phone: '40', text: 'hello two' });
  await new Promise((r) => setTimeout(r, 150));
  const m2 = db.prepare('SELECT status, error FROM messages WHERE id = ?').get(id2);
  assert.equal(m2.status, 'failed');
  assert.match(m2.error, /500/);

  const box = (await call('GET', '/api/admin/messages', null, adm)).body;
  assert.equal(box.provider, true);
  assert.equal((await call('GET', '/api/admin/messages', null, cust)).status, 403);

  delete process.env.MESSAGE_WEBHOOK_URL;
  delete process.env.MESSAGE_WEBHOOK_TOKEN;
  hook.closeAllConnections();
  await new Promise((r) => hook.close(r));
});

test('forgot password with a one-time code', async () => {
  const phone = '40';
  // unknown number: same answer, no code leaks
  const none = await call('POST', '/api/auth/forgot', { phone: '999' });
  assert.equal(none.status, 200);
  assert.equal('dev_code' in none.body, false);

  const r = await call('POST', '/api/auth/forgot', { phone });
  assert.equal(r.status, 200);
  const code = r.body.dev_code; // only present outside production
  assert.match(code, /^\d{6}$/);
  // asking again straight away does not send a second code
  assert.equal('dev_code' in (await call('POST', '/api/auth/forgot', { phone })).body, false);
  // the code is in the outbox but hidden from the owner's screen
  assert.ok(outbox().some((m) => m.kind === 'otp' && m.text.includes(code)));
  const shown = (await call('GET', '/api/admin/messages', null, adm)).body.items.filter((m) => m.kind === 'otp');
  assert.ok(shown.length && shown.every((m) => !m.text.includes(code)));

  assert.equal((await call('POST', '/api/auth/reset', { phone, code: '000000', password: 'newpass1' })).status, 400);
  assert.equal((await call('POST', '/api/auth/reset', { phone, code, password: '123' })).status, 400);
  assert.equal((await call('POST', '/api/auth/reset', { phone, code, password: 'newpass1' })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { phone, password: 'newpass1' })).status, 200);
  assert.equal((await call('POST', '/api/auth/login', { phone, password: 'abcdef' })).status, 401);
  // a code works only once
  assert.equal((await call('POST', '/api/auth/reset', { phone, code, password: 'again123' })).status, 400);

  // five wrong guesses lock the code, even the right one
  db.prepare('UPDATE otps SET used = 1').run();
  const r2 = await call('POST', '/api/auth/forgot', { phone });
  for (let i = 0; i < 5; i++) await call('POST', '/api/auth/reset', { phone, code: '111111', password: 'newpass2' });
  assert.equal((await call('POST', '/api/auth/reset', { phone, code: r2.body.dev_code, password: 'newpass2' })).status, 400);
});

test('in production without a provider, codes are not pretended to be sent', async () => {
  const was = process.env.NODE_ENV;
  process.env.NODE_ENV = 'production';
  const r = await call('POST', '/api/auth/forgot', { phone: '40' });
  process.env.NODE_ENV = was;
  assert.equal(r.status, 503);
  assert.match(r.body.error, /not set up/);
});

test('campaigns: groups, opt-out, name placeholder', async () => {
  const mk = async (name, phone) => (await call('POST', '/api/auth/register', { name, phone, password: 'abcdef' })).body;
  const old = await mk('Old Customer', '61');
  const quiet = await mk('Quiet Customer', '62');
  const bday = await mk('Birthday Girl', '63');
  const bid = db.prepare('SELECT id FROM businesses WHERE slug = ?').get(SLUG).id;
  const svc = db.prepare('SELECT id FROM services WHERE business_id = ?').get(bid).id;
  // Old Customer visited long ago
  db.prepare("INSERT INTO bookings (business_id, user_id, service_id, date, start_min, end_min, status, price) VALUES (?,?,?,'2020-01-06',600,660,'completed',800)").run(bid, old.user.id, svc);
  // Quiet Customer asked not to get offers
  await call('PUT', '/api/auth/profile', { name: 'Quiet Customer', optout: true }, quiet.token);
  const month = String(new Date().getMonth() + 1).padStart(2, '0');
  assert.equal((await call('PUT', '/api/auth/profile', { name: 'Birthday Girl', birthday: `1995-${month}-15` }, bday.token)).status, 200);
  assert.equal((await call('PUT', '/api/auth/profile', { name: 'Birthday Girl', birthday: 'soon' }, bday.token)).status, 400);

  const prev = async (segment, days) => (await call('POST', '/api/admin/campaigns/preview', { segment, days }, adm)).body;
  assert.equal((await prev('inactive', 30)).count, 1);
  assert.deepEqual((await prev('inactive', 30)).sample, ['Old Customer']);
  assert.equal((await prev('birthday')).count, 1);
  const all = (await prev('all')).count;
  assert.ok(all >= 3 && !(await prev('all')).sample.includes('Quiet Customer'));
  assert.equal((await call('POST', '/api/admin/campaigns/preview', { segment: 'everyone' }, adm)).status, 400);
  assert.equal((await call('POST', '/api/admin/campaigns/send', { segment: 'inactive', text: 'hi' }, adm)).status, 400);
  assert.equal((await call('POST', '/api/admin/campaigns/send', { segment: 'inactive', days: 30, text: 'Hi {name}, come back for 15% off!' }, cust)).status, 403);

  const sent = await call('POST', '/api/admin/campaigns/send', { segment: 'inactive', days: 30, text: 'Hi {name}, come back for 15% off!' }, adm);
  assert.equal(sent.body.queued, 1);
  const m = outbox().filter((x) => x.kind === 'campaign');
  assert.equal(m.length, 1);
  assert.equal(m[0].text, 'Hi Old, come back for 15% off!');
  assert.equal(m[0].phone, '61');
});

test('calendar feed with a secret link', async () => {
  assert.equal((await call('POST', '/api/admin/calendar-link', {}, cust)).status, 403);
  const link = (await call('POST', '/api/admin/calendar-link', {}, adm)).body.path;
  assert.match(link, /calendar\.ics\?key=[0-9a-f]{32}/);
  // the secret never appears in the public settings
  assert.equal('ical_key' in (await call('GET', '/api/settings')).body, false);
  assert.equal((await call('POST', '/api/admin/calendar-link', {}, adm)).body.path, link); // stable until regenerated

  const res = await fetch(base + link);
  assert.equal(res.status, 200);
  assert.match(res.headers.get('content-type'), /text\/calendar/);
  const ics = await res.text();
  assert.match(ics, /BEGIN:VCALENDAR/);
  assert.match(ics, /SUMMARY:Facial - Ria Shah/);
  assert.match(ics, /DTSTART:20990302T100000/);
  assert.equal((await fetch(base + link.replace(/key=.*/, 'key=' + '0'.repeat(32)))).status, 404);
  assert.equal((await fetch(base + link.split('?')[0])).status, 404);

  const fresh = (await call('POST', '/api/admin/calendar-link', { regenerate: true }, adm)).body.path;
  assert.notEqual(fresh, link);
  assert.equal((await fetch(base + link)).status, 404); // the old link stops working
});
