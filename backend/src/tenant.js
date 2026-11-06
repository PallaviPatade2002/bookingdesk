const bcrypt = require('bcryptjs');
const db = require('./db');

const RESERVED = new Set(['api', 'b', 'platform', 'admin', 'www', 'app', 'assets', 'icons', 'photos', 'login', 'signup', 'static']);

const DEFAULT_SETTINGS = {
  name: '',
  tagline: 'Book your appointment online.',
  phone: '',
  whatsapp: '',
  address: '',
  cancel_hours: '2',
  staff_label: 'Staff',
  city: '',
  lat: '',
  lng: '',
  listed: '1', // show in the public directory
  brand: '', // hex colour; empty = the default for the business type
  font: '', // 'serif' | 'sans'; empty = the default for the business type
  gst_number: '',
  gst_percent: '0', // added on top of the bill; 0 = no tax lines
  upi_id: '', // shown as a QR code when collecting payment
  invoice_prefix: 'INV',
  invoice_footer: 'Thank you for your visit!',
  reminder_hours: '24', // automatic reminder this many hours before an appointment; 0 = off
  language: 'en', // language customers see first: en, mr or hi
};

// Look each type of business starts with (the owner can change colour and font in Settings)
const TYPE_THEME = {
  beauty: { brand: '#c9647a', font: 'serif' },
  clinic: { brand: '#0f766e', font: 'sans' },
  fitness: { brand: '#c2410c', font: 'sans' },
  other: { brand: '#4f46e5', font: 'sans' },
  photographer: { brand: '#374151', font: 'serif' },
  events: { brand: '#a21caf', font: 'serif' },
  education: { brand: '#1d4ed8', font: 'sans' },
  home: { brand: '#b45309', font: 'sans' },
  pet: { brand: '#0e7490', font: 'sans' },
  professional: { brand: '#334155', font: 'sans' },
};

// What each type of business starts with (the owner can change everything afterwards)
const TYPES = {
  beauty: {
    label: 'Beauty parlour / salon', staff_label: 'Stylist', tagline: 'Glow from the inside out.',
    services: [
      ['Haircut & Styling', 'Cut, blow-dry and styling for every occasion', 'Hair', '/photos/hair.jpg', 45, 300],
      ['Facial & Glow', 'Deep cleanse and glow treatment for your skin type', 'Skin', '/photos/facial.jpg', 45, 800],
      ['Manicure', 'Relaxing hand care with nail art', 'Nails', '/photos/nails.jpg', 40, 500],
      ['Bridal Makeup', 'Trial and wedding-day look, made around you', 'Bridal', '/photos/bridal.jpg', 180, 6000],
    ],
  },
  clinic: {
    label: 'Clinic / doctor', staff_label: 'Doctor', tagline: 'Caring for you and your family.',
    services: [
      ['General Consultation', 'Check-up and advice', 'Consultation', null, 20, 400],
      ['Follow-up Visit', 'Review of an earlier treatment', 'Consultation', null, 15, 200],
      ['Health Check Package', 'Basic tests with a doctor review', 'Checkup', null, 45, 1500],
    ],
  },
  fitness: {
    label: 'Gym / fitness / yoga', staff_label: 'Trainer', tagline: 'Stronger every day.',
    services: [
      ['Personal Training', 'One-to-one session with a trainer', 'Training', null, 60, 800],
      ['Yoga Class', 'Small-group guided class', 'Classes', null, 60, 300],
      ['Free Trial Session', 'Try us out, no commitment', 'Classes', null, 45, 0],
    ],
  },
  photographer: {
    label: 'Photographer / photo studio', staff_label: 'Photographer', tagline: 'Moments, beautifully captured.',
    services: [
      ['Portrait Session', 'Studio portrait with edited photos', 'Studio', null, 60, 2500],
      ['Baby / Maternity Shoot', 'Gentle, relaxed shoot with props', 'Studio', null, 90, 4000],
      ['Product Shoot', 'Clean product photos for your shop or brand', 'Commercial', null, 120, 6000],
      ['Pre-wedding Shoot', 'Full-day shoot at your chosen location', 'Wedding', null, 480, 25000, 'day', 1],
    ],
  },
  events: {
    label: 'Decoration / events', staff_label: 'Planner', tagline: 'Make your celebration unforgettable.',
    services: [
      ['Birthday Decoration', 'Theme decoration at your venue. Send an enquiry for a quote.', 'Decoration', null, 120, 0, 'quote', 1],
      ['Wedding Stage Decoration', 'Stage, entry and mandap decoration. Send an enquiry for a quote.', 'Wedding', null, 480, 0, 'quote', 1],
      ['Baby Shower / Naming Ceremony', 'Soft themes and balloon work. Send an enquiry for a quote.', 'Decoration', null, 180, 0, 'quote', 1],
      ['Balloon Decoration Package', 'Fixed-price balloon set-up for the whole day', 'Decoration', null, 480, 8000, 'day', 1],
    ],
  },
  education: {
    label: 'Tuition / classes', staff_label: 'Teacher', tagline: 'Learn with confidence.',
    services: [
      ['Free Trial Class', 'Meet the teacher and see how classes work', 'Classes', null, 45, 0],
      ['Group Class', 'Small-batch class', 'Classes', null, 60, 500],
      ['One-to-one Session', 'Personal attention on your topics', 'Classes', null, 60, 900],
      ['Doubt-solving Session', 'Quick help before an exam', 'Classes', null, 30, 300],
    ],
  },
  home: {
    label: 'Home & auto services', staff_label: 'Technician', tagline: 'Reliable service at your doorstep.',
    services: [
      ['Home Visit & Inspection', 'We visit, check and give an estimate', 'Home', null, 60, 300, 'slot', 1],
      ['AC Service', 'Cleaning and gas check', 'Home', null, 90, 800, 'slot', 1],
      ['Car Wash & Detailing', 'Exterior and interior cleaning', 'Auto', null, 90, 700],
      ['Bike Service', 'General service and checks', 'Auto', null, 60, 500],
    ],
  },
  pet: {
    label: 'Pet grooming / vet', staff_label: 'Groomer', tagline: 'Happy, healthy pets.',
    services: [
      ['Bath & Brush', 'Shampoo, dry and brush', 'Grooming', null, 60, 800],
      ['Full Grooming', 'Bath, haircut, nails and ears', 'Grooming', null, 90, 1500],
      ['Vet Check-up', 'General health check', 'Health', null, 30, 500],
    ],
  },
  professional: {
    label: 'Lawyer / consultant / CA', staff_label: 'Advisor', tagline: 'Clear advice, on time.',
    services: [
      ['Initial Consultation', 'Understand your situation', 'Consultation', null, 30, 1000],
      ['Detailed Consultation', 'In-depth discussion and plan', 'Consultation', null, 60, 2500],
      ['Document Review', 'Review and written feedback', 'Consultation', null, 45, 1500],
    ],
  },
  other: {
    label: 'Other service business', staff_label: 'Staff', tagline: 'Book your appointment online.',
    services: [
      ['Consultation', 'Talk to us about what you need', 'General', null, 30, 500],
      ['Standard Service', 'Our most popular service', 'General', null, 60, 1000],
    ],
  },
};

const slugify = (s) =>
  String(s || '')
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

const slugTaken = (slug) => RESERVED.has(slug) || !!db.prepare('SELECT 1 FROM businesses WHERE slug = ?').get(slug);

function uniqueSlug(wanted) {
  let base = slugify(wanted) || 'business';
  if (base.length < 3) base += '-biz';
  let slug = base;
  for (let i = 2; slugTaken(slug); i++) slug = `${base}-${i}`;
  return slug;
}

// Creates a business with its owner login, default opening hours, settings and optional starter services.
function createBusiness({ name, slug, type = 'other', ownerName, phone, password, sample = true, extra = {} }) {
  const t = TYPES[type] || TYPES.other;
  const bid = Number(db.prepare('INSERT INTO businesses (slug, name, type) VALUES (?,?,?)').run(slug, name, TYPES[type] ? type : 'other').lastInsertRowid);
  const owner = Number(
    db.prepare("INSERT INTO users (business_id, name, phone, password_hash, role) VALUES (?,?,?,?, 'admin')").run(bid, ownerName, phone, bcrypt.hashSync(password, 10)).lastInsertRowid
  );
  const hours = db.prepare('INSERT INTO business_hours (business_id, dow, open_min, close_min) VALUES (?,?,?,?)');
  for (let d = 0; d < 7; d++) d === 0 ? hours.run(bid, d, null, null) : hours.run(bid, d, 9 * 60, 18 * 60);
  const set = db.prepare('INSERT INTO settings (business_id, key, value) VALUES (?,?,?)');
  const values = { ...DEFAULT_SETTINGS, name, tagline: t.tagline, staff_label: t.staff_label, ...extra };
  for (const [k, v] of Object.entries(values)) set.run(bid, k, v);
  if (sample) {
    const ins = db.prepare('INSERT INTO services (business_id, name, description, category, image_url, duration_min, price, mode, ask_venue) VALUES (?,?,?,?,?,?,?,?,?)');
    t.services.forEach((s) => ins.run(bid, s[0], s[1], s[2], s[3], s[4], s[5], s[6] || 'slot', s[7] || 0));
  }
  return { id: bid, ownerId: owner, slug };
}

module.exports = { createBusiness, uniqueSlug, slugify, slugTaken, TYPES, TYPE_THEME, DEFAULT_SETTINGS };
