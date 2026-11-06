# BookingDesk: multi-business appointment booking

A hosted booking platform. **Any business (salon, clinic, gym, studio...) can register itself** and gets its own booking page, owner dashboard and private data. Customers book online; the owner manages everything. The platform owner sees and controls all businesses from one panel.

The included demo business is **Blush & Bloom**, a beauty parlour (photos from Unsplash).

Stack: React (Vite) web app (installable as a phone app), Node/Express + SQLite API, JWT auth.

## How it is organised

| Address | What |
| --- | --- |
| `/` | Product home page: features, "Create your business", live demo |
| `/explore` | **Customers find businesses:** search by name or city, filter by type, "Near me" (nearest first), list and map |
| `/signup` | A business owner registers: name, type, web address, owner login |
| `/b/<business>` | That business: public page, customer app, owner app (owner logs in here) |
| `/platform` | Platform admin: list of all businesses, totals, suspend / activate |

Every business has its own users, services, staff, bookings, settings, offers and reviews. A login (token) works only inside the business it was created for. This is enforced on the server and covered by tests.

## Two ways to run the same code

| | **Platform mode** (default) | **Single-business mode** |
| --- | --- | --- |
| Setting | nothing | `SINGLE_BUSINESS=<slug>` (for example `blush-bloom`) |
| `/` | Product home page, sign-up, explore, platform admin | That one business: its landing page, customer app and owner login |
| Other businesses, sign-up, directory | available | switched off (404) |
| Use for | a platform where many businesses register | a ready product for one parlour / clinic / gym, under its own domain |

Both modes use one codebase, so a fix or feature reaches both. Each business picks its own **brand colour and heading font** in Settings (a whole palette is derived from one colour, and kept readable); the platform pages use a neutral colour. Phone-app icons and manifests follow the same colour.

## Features

**For a business owner**
- Self-service sign-up with starter services for the business type (beauty, clinic, fitness, other); everything is editable
- Home dashboard: today, month income, 14-day chart, popular services, income per team member, customer rating
- Share card with the booking link (copy / WhatsApp) and a get-started checklist
- Calendar view (one column per team member) and list view; click an appointment for details, status actions and a one-tap WhatsApp reminder
- Add appointments for walk-in / phone customers
- Services (add, edit, hide, delete, category, photo), team members (services they do, weekly days off)
- Customers (history, total spent, private notes, temporary password reset), offers (percentage coupons)
- Location: city, address and a **map pin** (find address on map, use current location, click or drag the pin); choose whether to appear in the public directory
- Settings: name, tagline, phone, WhatsApp, **what you call your team** (Stylist, Doctor, Trainer...), cancellation window
- Opening hours and holidays, monthly report, CSV download, notification bell

**For customers**
- **Find a business** at `/explore`: search by name or city, filter by type, sort by distance ("Near me"), see results on a map (OpenStreetMap, no API key)
- Public page with services, team, reviews, opening hours, directions and FAQ
- Sign up, pick a service, a team member (or "any") and a live free slot; coupon codes
- Confirmation with add-to-calendar (.ics) and WhatsApp share; reschedule, cancel, rate a visit
- Each business is installable as its own phone app (PWA) with its own name

**Rules enforced on the server**
- No double booking per team member (a service with nobody attached behaves as one shared resource)
- "Any" assigns the team member with the lightest day; no past times; closed days, holidays and days off have no slots
- Customers can only cancel or move their own bookings, up to the owner's cancellation window
- Services and team members with booking history are hidden instead of deleted
- Prices are stored per booking, so coupons and later price changes never rewrite old income
- Tenant isolation, login and sign-up rate limits, input validation, security headers

## Run locally

```bash
cd backend && npm install && npm run seed && npm start   # http://localhost:5001
cd frontend && npm install && npm run dev                # http://localhost:5174 (proxies /api)
```

`cd frontend && npm run build` makes the backend serve the website too (one server, one address).

Demo logins (password `123456`) at `/b/blush-bloom`: customer `9000000003`, owner `9000000001`. Platform admin at `/platform`: `9999999999` (development only). Tests: `cd backend && npm test`.

> Upgrading from the earlier single-business version: the database layout changed. Delete `backend/booking.db` and run `npm run seed` again.

## Settings (environment variables)

| Variable | Meaning |
| --- | --- |
| `JWT_SECRET` | **Required in production.** Long random string that signs logins |
| `PLATFORM_PHONE`, `PLATFORM_PASSWORD` | Login for the platform admin panel (`/platform`), created by `npm run seed` |
| `DB_FILE` | Where the SQLite database lives, for example `/var/data/booking.db` |
| `SINGLE_BUSINESS` | Optional. Slug of the one business to serve at `/` (see above). Create it first, for example with `npm run seed` or sign-up on a platform instance |
| `PORT` | Port to listen on (default 5001) |
| `AUTO_SEED=1` | Re-creates the demo business on every start. Use on free hosting that resets its disk |
| `TZ` | Time zone of your customers, for example `Asia/Kolkata`. **Set this on the server**, otherwise "today" and slot times follow the server clock (often UTC) |
| `NODE_ENV=production` | Turns off the development demo logins |

## Hosting

**Now (free, demo only): Render.** New > Blueprint > pick the repo (`render.yaml`). The free plan sleeps when idle (first load 30-60 s) and **its disk resets on restart, so registered businesses are lost**. Use it only to show the demo; `AUTO_SEED=1` brings the demo business back after each restart.

**Real customers: your own server (VPS) or a paid plan with a persistent disk.** Businesses and bookings are stored in one SQLite file, so the disk must survive restarts.

1. A small Linux VPS (1 GB RAM is enough to start) with Node 22 and a domain name pointing to it.
2. Get the code on the server, then:
   ```bash
   cd frontend && npm ci && npm run build
   cd ../backend && npm ci
   ```
3. Run it with a process manager, for example systemd or pm2, with:
   `NODE_ENV=production TZ=Asia/Kolkata JWT_SECRET=<long random> PLATFORM_PHONE=<yours> PLATFORM_PASSWORD=<strong> DB_FILE=/var/data/booking.db PORT=5001`
   then `npm run seed` once (creates the platform admin) and `node src/server.js`.
4. Put Caddy or Nginx in front for HTTPS (needed for the phone-app install). Caddy example: `yourdomain.com { reverse_proxy localhost:5001 }`.
5. **Back up `/var/data/booking.db` every day** (copy it somewhere else). That file is all your customers' data.

## Not included yet

Self-service password reset by SMS/email (the owner issues a temporary password), online payment (needs a payment provider account), automatic WhatsApp/SMS sending (needs a provider; reminders are one-tap links today), image upload (photos are chosen from a gallery or pasted as links), PostgreSQL (SQLite is fine for a small number of businesses), subscription billing for businesses, custom domain per business, Flutter app for this version.

## Notes on maps

Maps and address search use OpenStreetMap tiles and Nominatim, which are free for light use. For heavy traffic use a map provider with a key (MapTiler, Mapbox, Google) or host your own tiles.

## Credits

Photos from Unsplash (free licence): Look Studio, Kulor Salon, Rosa Rafael, Nina Mercado, Chelson Tamares.
