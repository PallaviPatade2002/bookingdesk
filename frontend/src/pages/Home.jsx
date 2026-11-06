import { useEffect, useState } from 'react'
import { gapi } from '../api'
import { DEMO_SLUG, PLATFORM_NAME } from '../config'

const FEATURES = [
  ['Online booking, 24/7', 'Customers pick a service, a person and a free slot. No phone calls, no double bookings.'],
  ['Calendars for your team', 'Each stylist, doctor or trainer has their own calendar, working days and services.'],
  ['Owner dashboard', 'Today at a glance, income, popular services, customer list and CSV export.'],
  ['Reminders and offers', 'One-tap WhatsApp reminders, discount coupons and customer reviews.'],
  ['Works like an app', 'Customers can install it on their phone from the browser. No app store needed.'],
  ['Your own web address', 'Every business gets its own booking page and its own private data.'],
]

export default function Home() {
  const [types, setTypes] = useState([])
    useEffect(() => { gapi('GET', '/types').then(setTypes).catch(() => {}) }, [])

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <div className="brand"><div className="brand-mark">✿</div> {PLATFORM_NAME}</div>
          <div className="row">
            <a className="btn ghost sm" href="/explore">Find a business</a>
            <a className="btn ghost sm" href={'/b/' + DEMO_SLUG}>Live demo</a>
            <a className="btn sm" href="/signup">Create your business</a>
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-wrap lp-hero-in">
          <div>
            <span className="lp-tag">For salons, clinics, studios and more</span>
            <h1>Online booking for your business, ready in minutes.</h1>
            <p className="lp-lead">Give customers a page where they book themselves. You get a calendar, a dashboard and a customer list. No technical knowledge needed.</p>
            <div className="row wrap">
              <a className="btn" href="/signup">Create your business</a>
              <a className="btn ghost" href={'/b/' + DEMO_SLUG}>See a live demo</a>
            </div>
            <form className="home-find" action="/explore" method="get">
              <label htmlFor="addr" className="muted small">Looking to book? Search salons, clinics and gyms near you</label>
              <div className="coupon-row">
                <input id="addr" name="q" placeholder="Business name or city" />
                <button className="btn ghost sm">Search</button>
              </div>
            </form>
          </div>
          <div className="lp-arch">
            <div className="lp-float lp-float-a"><span className="dot" /> New booking</div>
            <div className="lp-float lp-float-b"><small>Confirmed</small><b>Facial &amp; Glow</b><small>Sat 10:00 AM with Anjali</small></div>
          </div>
        </div>
      </section>

      <section className="lp-sec alt">
        <div className="lp-wrap">
          <div className="lp-head"><span className="lp-tag">Everything included</span><h2>What your business gets</h2></div>
          <div className="lp-grid">
            {FEATURES.map(([t, d]) => (
              <div key={t} className="lp-review"><h3>{t}</h3><p className="muted">{d}</p></div>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-head"><span className="lp-tag">Simple setup</span><h2>Live in three steps</h2></div>
          <div className="lp-steps">
            <div><div className="lp-num">1</div><h3>Create your business</h3><p>Pick your type of business. We add starter services you can change.</p></div>
            <div><div className="lp-num">2</div><h3>Set up your page</h3><p>Add services, prices, team members and opening hours from your dashboard.</p></div>
            <div><div className="lp-num">3</div><h3>Share your link</h3><p>Send your booking link on WhatsApp or Instagram. Bookings arrive in your calendar.</p></div>
          </div>
        </div>
      </section>

      {types.length > 0 && (
        <section className="lp-sec alt">
          <div className="lp-wrap">
            <div className="lp-head"><span className="lp-tag">Built for</span><h2>Works for many kinds of business</h2></div>
            <div className="chips" style={{ justifyContent: 'center' }}>
              {types.map((t) => <span key={t.id} className="chip">{t.label}</span>)}
            </div>
          </div>
        </section>
      )}

      <section className="lp-cta">
        <div className="lp-wrap">
          <h2>Start taking bookings today</h2>
          <p>Create your business page in about two minutes.</p>
          <a className="btn" href="/signup">Create your business</a>
        </div>
      </section>

      <footer className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <div className="brand">{PLATFORM_NAME}</div>
          <p className="muted small">© {PLATFORM_NAME} · <a href="/platform">Platform admin</a></p>
        </div>
      </footer>
    </div>
  )
}
