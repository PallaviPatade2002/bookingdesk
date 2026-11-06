const bcrypt = require('bcryptjs');
const db = require('./db');
const tenant = require('./tenant');

const DEMO_SLUG = 'blush-bloom';
const isProd = process.env.NODE_ENV === 'production';

// ---- platform admin (the person who runs the hosted app) ----
// In production set PLATFORM_PHONE and PLATFORM_PASSWORD. In development a demo login is created.
const platformPhone = process.env.PLATFORM_PHONE || (isProd ? null : '9999999999');
const platformPassword = process.env.PLATFORM_PASSWORD || (isProd ? null : '123456');
if (platformPhone && platformPassword && !db.prepare("SELECT 1 FROM users WHERE role = 'platform' AND phone = ?").get(platformPhone)) {
  db.prepare("INSERT INTO users (business_id, name, phone, password_hash, role) VALUES (NULL, 'Platform Admin', ?, ?, 'platform')").run(
    platformPhone, bcrypt.hashSync(platformPassword, 10)
  );
}

// ---- demo business: a beauty parlour with services, stylists, bookings, reviews and offers ----
if (!db.prepare('SELECT 1 FROM businesses WHERE slug = ?').get(DEMO_SLUG)) {
  const made = tenant.createBusiness({
    name: 'Blush & Bloom', slug: DEMO_SLUG, type: 'beauty', ownerName: 'Owner', phone: '9000000001', password: '123456', sample: false,
    extra: { city: 'Pune', address: 'FC Road, Pune', lat: '18.5196', lng: '73.8412' },
  });
  const B = made.id;
  const addUser = (name, phone) =>
    Number(db.prepare('INSERT INTO users (business_id, name, phone, password_hash) VALUES (?,?,?,?)').run(B, name, phone, bcrypt.hashSync('123456', 10)).lastInsertRowid);
  addUser('Demo Customer', '9000000003');

  const SERVICES = [
    ['Haircut & Styling', 'Cut, blow-dry and styling for every occasion', 'Hair', '/photos/hair.jpg', 45, 300],
    ['Hair Colour', 'Full colour with wash and finish', 'Hair', '/photos/hair.jpg', 90, 1500],
    ['Hair Spa', 'Deep conditioning spa for smooth, shiny hair', 'Hair', '/photos/hair.jpg', 60, 900],
    ['Facial & Glow', 'Deep cleanse and glow treatment for your skin type', 'Skin', '/photos/facial.jpg', 45, 800],
    ['Bridal Makeup', 'Trial and wedding-day look, made around you', 'Bridal', '/photos/bridal.jpg', 180, 6000],
    ['Manicure', 'Relaxing hand care with nail art', 'Nails', '/photos/nails.jpg', 40, 500],
    ['Pedicure', 'Foot care, scrub and polish', 'Nails', '/photos/nails.jpg', 45, 600],
  ];
  const insS = db.prepare('INSERT INTO services (business_id, name, description, category, image_url, duration_min, price) VALUES (?,?,?,?,?,?,?)');
  SERVICES.forEach((s) => insS.run(B, ...s));

  const sid = (name) => db.prepare('SELECT id FROM services WHERE business_id = ? AND name = ?').get(B, name)?.id;
  const addStaff = db.prepare('INSERT INTO staff (business_id, name, title, days_off) VALUES (?,?,?,?)');
  const link = db.prepare('INSERT OR IGNORE INTO staff_services (staff_id, service_id) VALUES (?,?)');
  [
    ['Priya', 'Senior Hair Stylist', '3', ['Haircut & Styling', 'Hair Colour', 'Hair Spa']],
    ['Anjali', 'Skin & Bridal Specialist', '2', ['Facial & Glow', 'Bridal Makeup']],
    ['Neha', 'Nail Artist', '', ['Manicure', 'Pedicure']],
    ['Riya', 'Stylist', '4', ['Haircut & Styling', 'Hair Spa', 'Facial & Glow']],
  ].forEach(([name, title, off, svcs]) => {
    const id = Number(addStaff.run(B, name, title, off).lastInsertRowid);
    svcs.forEach((n) => sid(n) && link.run(id, sid(n)));
  });

  const insC = db.prepare('INSERT INTO coupons (business_id, code, percent) VALUES (?,?,?)');
  insC.run(B, 'WELCOME10', 10);
  insC.run(B, 'BRIDE15', 15);

  // demo history so the owner dashboard and calendar look alive
  let seed = 7;
  const rnd = (n) => ((seed = (seed * 1103515245 + 12345) % 2147483648), seed % n);
  ['Aarti', 'Sneha', 'Pooja', 'Kavya', 'Megha', 'Isha', 'Divya', 'Rhea'].forEach((n, i) => addUser(n + ' K.', '9100000' + String(100 + i)));
  const customers = db.prepare("SELECT id FROM users WHERE business_id = ? AND role = 'customer'").all(B).map((u) => u.id);
  const services = db.prepare('SELECT * FROM services WHERE business_id = ?').all(B);
  const insB = db.prepare('INSERT INTO bookings (business_id, user_id, service_id, staff_id, date, start_min, end_min, status) VALUES (?,?,?,?,?,?,?,?)');
  const busy = {};
  const iso = (d) => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  for (let off = -13; off <= 3; off++) {
    const d = new Date();
    d.setDate(d.getDate() + off);
    if (d.getDay() === 0) continue; // closed on Sunday
    const date = iso(d);
    const count = 2 + rnd(4);
    for (let k = 0; k < count; k++) {
      const svc = services[rnd(services.length)];
      const staff = db
        .prepare('SELECT st.id, st.days_off FROM staff st JOIN staff_services ss ON ss.staff_id = st.id WHERE ss.service_id = ? AND st.active = 1')
        .all(svc.id)
        .filter((st) => !st.days_off.split(',').includes(String(d.getDay())));
      if (!staff.length) continue;
      const st = staff[rnd(staff.length)];
      for (let t = 0; t < 20; t++) {
        const start = 9 * 60 + rnd(34) * 15;
        const end = start + svc.duration_min;
        const list = (busy[st.id + date] ||= []);
        if (end > 18 * 60 || list.some((b) => start < b[1] && end > b[0])) continue;
        list.push([start, end]);
        const r = rnd(10);
        const status = off >= 0 ? 'booked' : r < 7 ? 'completed' : r < 8 ? 'no_show' : 'cancelled';
        insB.run(B, customers[rnd(customers.length)], svc.id, st.id, date, start, end, status);
        break;
      }
    }
  }

  const texts = [
    [5, 'Lovely service, Priya did exactly what I asked for. Booking online was so easy.'],
    [5, 'Very hygienic and relaxing. My skin feels great.'],
    [4, 'Great nails and a friendly team. Slightly late start but worth it.'],
    [5, 'Booked my bridal trial here and the result was beautiful.'],
    [5, 'Quick slots, no waiting. Will come back!'],
  ];
  const done = db.prepare("SELECT id, user_id, service_id, staff_id FROM bookings WHERE business_id = ? AND status = 'completed' ORDER BY date").all(B);
  const insR = db.prepare('INSERT INTO reviews (business_id, booking_id, user_id, service_id, staff_id, rating, comment) VALUES (?,?,?,?,?,?,?)');
  done.slice(0, texts.length).forEach((b, i) => insR.run(B, b.id, b.user_id, b.service_id, b.staff_id, texts[i][0], texts[i][1]));

  const hm = (m) => String(Math.floor(m / 60)).padStart(2, '0') + ':' + String(m % 60).padStart(2, '0');
  db.prepare(
    "SELECT b.date, b.start_min, u.name, s.name AS svc FROM bookings b JOIN users u ON u.id = b.user_id JOIN services s ON s.id = b.service_id WHERE b.business_id = ? AND b.status = 'booked' ORDER BY b.date, b.start_min LIMIT 3"
  ).all(B).forEach((r) => db.prepare('INSERT INTO notifications (user_id, text) VALUES (?,?)').run(made.ownerId, 'New booking: ' + r.name + ' · ' + r.svc + ' · ' + r.date + ' ' + hm(r.start_min)));
}

// ---- billing, packages, team logins and gallery for the demo parlour ----
{
  const row = db.prepare('SELECT id FROM businesses WHERE slug = ?').get(DEMO_SLUG);
  const B = row && row.id;
  if (B && !db.prepare('SELECT 1 FROM products WHERE business_id = ?').get(B)) {
    const round2 = (n) => Math.round(n * 100) / 100;
    const set = (k, v) => db.prepare('INSERT INTO settings (business_id, key, value) VALUES (?,?,?) ON CONFLICT(business_id, key) DO UPDATE SET value = excluded.value').run(B, k, v);
    set('upi_id', 'blushbloom@upi');
    set('gst_percent', '18');
    set('invoice_prefix', 'BB');
    set('phone', '+91 90000 00000');
    set('whatsapp', '919000000000');

    const insP = db.prepare('INSERT INTO products (business_id, name, price, stock) VALUES (?,?,?,?)');
    insP.run(B, 'Argan Hair Serum', 650, 8);
    insP.run(B, 'Keratin Shampoo', 450, 12);
    insP.run(B, 'Gel Nail Polish', 250, 3); // low stock on purpose

    const facial = db.prepare("SELECT id FROM services WHERE business_id = ? AND name = 'Facial & Glow'").get(B);
    const insPk = db.prepare('INSERT INTO packages (business_id, name, description, price, sessions, service_id, valid_days) VALUES (?,?,?,?,?,?,?)');
    const pk = Number(insPk.run(B, 'Facial x5', 'Five Facial & Glow sessions at a lower price', 3500, 5, facial && facial.id, 180).lastInsertRowid);
    insPk.run(B, 'Pre-wedding Glow Pack', 'Four sessions of any treatment before the big day', 9000, 4, null, 120);

    db.prepare("UPDATE staff SET commission_pct = CASE name WHEN 'Priya' THEN 20 WHEN 'Anjali' THEN 25 ELSE 15 END WHERE business_id = ?").run(B);
    const priya = db.prepare("SELECT id FROM staff WHERE business_id = ? AND name = 'Priya'").get(B);
    if (priya) {
      const uid = Number(db.prepare("INSERT INTO users (business_id, name, phone, password_hash, role) VALUES (?,?,?,?, 'staff')").run(B, 'Priya', '9000000021', bcrypt.hashSync('123456', 10)).lastInsertRowid);
      db.prepare('UPDATE staff SET user_id = ? WHERE id = ?').run(uid, priya.id);
    }

    // a bill for every completed visit: most are paid in full, some customers still owe half
    const done = db.prepare(
      "SELECT b.id, b.user_id, b.staff_id, b.service_id, b.date, s.name, COALESCE(b.price, s.price) AS price FROM bookings b JOIN services s ON s.id = b.service_id WHERE b.business_id = ? AND b.status = 'completed' ORDER BY b.date, b.start_min"
    ).all(B);
    const insI = db.prepare("INSERT INTO invoices (business_id, number, booking_id, user_id, subtotal, discount, tax, tax_percent, tip, total, created_at) VALUES (?,?,?,?,?,0,?,18,0,?,?)");
    const insIt = db.prepare("INSERT INTO invoice_items (invoice_id, kind, ref_id, name, qty, price, staff_id) VALUES (?,'service',?,?,1,?,?)");
    const insPay = db.prepare('INSERT INTO payments (business_id, invoice_id, amount, method, created_at) VALUES (?,?,?,?,?)');
    done.forEach((b, i) => {
      const tax = round2((b.price * 18) / 100);
      const total = round2(b.price + tax);
      const at = b.date + ' 12:00:00';
      const id = Number(insI.run(B, i + 1, b.id, b.user_id, b.price, tax, total, at).lastInsertRowid);
      insIt.run(id, b.service_id, b.name, b.price, b.staff_id);
      const mode = i % 4;
      insPay.run(B, id, mode === 3 ? round2(total / 2) : total, ['cash', 'upi', 'card', 'upi'][mode], at);
    });

    const demo = db.prepare("SELECT id FROM users WHERE business_id = ? AND phone = '9000000003'").get(B);
    if (demo) {
      const exp = new Date();
      exp.setDate(exp.getDate() + 150);
      const day = exp.getFullYear() + '-' + String(exp.getMonth() + 1).padStart(2, '0') + '-' + String(exp.getDate()).padStart(2, '0');
      db.prepare('INSERT INTO customer_packages (business_id, user_id, package_id, name, service_id, sessions_left, expires) VALUES (?,?,?,?,?,?,?)').run(B, demo.id, pk, 'Facial x5', facial && facial.id, 3, day);
    }

    // birthdays this month and one customer who opted out of offers
    const month = String(new Date().getMonth() + 1).padStart(2, '0');
    const cs = db.prepare("SELECT id FROM users WHERE business_id = ? AND role = 'customer' AND phone LIKE '91000%' ORDER BY id").all(B);
    if (cs[0]) db.prepare('UPDATE users SET birthday = ? WHERE id = ?').run('1994-' + month + '-12', cs[0].id);
    if (cs[1]) db.prepare('UPDATE users SET birthday = ? WHERE id = ?').run('1998-' + month + '-24', cs[1].id);
    if (cs[7]) db.prepare('UPDATE users SET optout = 1 WHERE id = ?').run(cs[7].id);

    const g = db.prepare('INSERT INTO gallery (business_id, url, caption) VALUES (?,?,?)');
    [['/photos/hair.jpg', 'Styling'], ['/photos/facial.jpg', 'Facials'], ['/photos/bridal.jpg', 'Bridal'], ['/photos/nails.jpg', 'Nail art']].forEach((x) => g.run(B, ...x));

    require('./messaging').runReminders(); // reminders for anything starting in the next day
  }
}

// extra demo businesses (different cities and types) so searching and the map have something to show
for (const demo of [
  { slug: 'fit-zone-gym', name: 'Fit Zone Gym', type: 'fitness', phone: '9000000011', extra: { city: 'Pune', address: 'Koregaon Park, Pune', lat: '18.5362', lng: '73.8940' } },
  { slug: 'dr-mehta-clinic', name: 'Dr. Mehta Clinic', type: 'clinic', phone: '9000000012', extra: { city: 'Mumbai', address: 'Andheri West, Mumbai', lat: '19.1363', lng: '72.8277' } },
  { slug: 'glow-up-salon', name: 'Glow Up Salon', type: 'beauty', phone: '9000000013', extra: { city: 'Mumbai', address: 'Bandra West, Mumbai', lat: '19.0596', lng: '72.8295' } },
  { slug: 'lens-studio', name: 'Lens Studio', type: 'photographer', phone: '9000000014', extra: { city: 'Pune', address: 'Baner, Pune', lat: '18.559', lng: '73.7868' } },
  { slug: 'party-decor', name: 'Party Decor', type: 'events', phone: '9000000015', extra: { city: 'Pune', address: 'Aundh, Pune', lat: '18.558', lng: '73.8077' } },
]) {
  if (!db.prepare('SELECT 1 FROM businesses WHERE slug = ?').get(demo.slug)) {
    const made = tenant.createBusiness({ ...demo, ownerName: 'Demo Owner', password: '123456', sample: true });
    if (demo.type === 'photographer' || demo.type === 'events') {
      const g = db.prepare('INSERT INTO gallery (business_id, url, caption) VALUES (?,?,?)');
      [['/photos/bridal.jpg', 'Bridal'], ['/photos/hero.jpg', 'Portraits'], ['/photos/nails.jpg', 'Details']].forEach((x) => g.run(made.id, ...x));
    }
    if (demo.type === 'events') {
      // a customer with an enquiry that already has a quote, so the whole flow can be tried
      const cust = Number(db.prepare('INSERT INTO users (business_id, name, phone, password_hash) VALUES (?,?,?,?)').run(made.id, 'Demo Customer', '9000000003', bcrypt.hashSync('123456', 10)).lastInsertRowid);
      const svc = db.prepare("SELECT id FROM services WHERE business_id = ? AND mode = 'quote' ORDER BY id LIMIT 1").get(made.id);
      const d = new Date();
      d.setDate(d.getDate() + 20);
      const day = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
      db.prepare("INSERT INTO enquiries (business_id, user_id, service_id, date, details, venue, guests, status, quote_price, reply) VALUES (?,?,?,?,?,?,?,'quoted',?,?)")
        .run(made.id, cust, svc.id, day, 'Pink and gold theme, 1st birthday', 'Rose Garden Lawns, Aundh', 80, 18000, 'Includes balloons, backdrop and flowers');
    }
  }
}

console.log('Seeded. Demo business: /b/' + DEMO_SLUG + ' (owner 9000000001, customer 9000000003, password 123456)' + (platformPhone ? '; platform admin ' + platformPhone : ''));
