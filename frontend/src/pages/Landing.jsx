import { useEffect, useState } from 'react'
import { SINGLE, api } from '../api'
import { TYPE_TAG } from '../config'
import { Avatar, BrandName, DAYS, Stars, dur, money, serviceImage, time12, useLabel, useSettings } from '../ui'
import { LangSwitcher, useT } from '../i18n'

const STEPS = [
  ['1', 'Choose a service', 'Browse everything we offer with clear prices.'],
  ['2', 'Pick your {team} and time', 'See live free slots. No calls, no waiting for a reply.'],
  ['3', 'Show up', 'Pay after your service. Cancel or move it any time from your phone.'],
]

export default function Landing({ onLogin, onSignup }) {
  const t = useT()
  const { settings } = useSettings()
  const L = useLabel()
  const [services, setServices] = useState([])
  const [staff, setStaff] = useState([])
  const [reviews, setReviews] = useState(null)
  const [hours, setHours] = useState([])
  const [gallery, setGallery] = useState([])
  const [packages, setPackages] = useState([])
  useEffect(() => {
    api('GET', '/services').then(setServices).catch(() => {})
    api('GET', '/staff').then(setStaff).catch(() => {})
    api('GET', '/reviews').then(setReviews).catch(() => {})
    api('GET', '/hours').then(setHours).catch(() => {})
    api('GET', '/gallery').then(setGallery).catch(() => {})
    api('GET', '/packages').then(setPackages).catch(() => {})
  }, [])

  const wa = (settings.whatsapp || '').replace(/\D/g, '')
  const go = (id) => () => document.getElementById(id)?.scrollIntoView({ behavior: 'smooth' })
  const today = hours.find((h) => h.dow === new Date().getDay())
  const openToday = !today ? t('Slots open today') : today.open ? t('Open today · {from} – {to}', { from: time12(today.open), to: time12(today.close) }) : t('Closed today')
  const cancelH = Number(settings.cancel_hours) || 0
  const faqs = [
    [t('How do I book?'), t('Create a free account, choose a service, pick your {who} and a free time slot. Your appointment is confirmed instantly.', { who: L.lower })],
    [t('Can I cancel or reschedule?'), cancelH ? t('Yes, from My bookings, up to {n} hours before your appointment. After that, please call us.', { n: cancelH }) : t('Yes, any time before your appointment from My bookings.')],
    [t('How do I pay?'), t('You pay after your service. Apply a coupon code while booking if you have one.')],
    [t('Can I choose my {who}?', { who: L.lower }), t('Yes. Pick one you like, or choose "Any {who}" and we will assign the first available one.', { who: L.lower })],
    [t('Do you take walk-ins?'), t('Walk-ins are welcome when a {who} is free, but booking online guarantees your slot.', { who: L.lower })],
  ]
  const cheapest = services.length ? Math.min(...services.map((s) => s.price)) : null

  return (
    <div className="lp">
      <header className="lp-nav">
        <div className="lp-wrap lp-nav-in">
          <div className="brand"><div className="brand-mark">✿</div> <BrandName /></div>
          <nav className="lp-links">
            <button onClick={go('lp-services')}>{t('Treatments')}</button>
            {staff.length > 0 && <button onClick={go('lp-team')}>{t(L.many)}</button>}
            <button onClick={go('lp-how')}>{t('How it works')}</button>
            <button onClick={go('lp-contact')}>{t('Contact')}</button>
          </nav>
          <div className="row">
            <LangSwitcher />
            <button className="btn ghost sm" onClick={onLogin}>{t('Login')}</button>
            <button className="btn sm" onClick={onSignup}>{t('Book now')}</button>
          </div>
        </div>
      </header>

      <section className="lp-hero">
        <div className="lp-wrap lp-hero-in">
          <div>
            <span className="lp-tag">{t(TYPE_TAG[settings.type] || 'Book online · Quick · Easy')}</span>
            <h1>{settings.tagline || 'Look and feel your best.'}</h1>
            <p className="lp-lead">{t('Book online in under a minute. Pick your {who}, see live free slots and get a confirmed appointment instantly.', { who: L.lower })}</p>
            <div className="row wrap">
              <button className="btn" onClick={onSignup}>{t('Book an appointment')}</button>
              <button className="btn ghost" onClick={go('lp-services')}>{t('See treatments')}</button>
            </div>
            <div className="lp-trust">
              <div><b>{t('Live slots')}</b><span>{t('No double bookings')}</span></div>
              <div><b>{t('Your {who}', { who: L.lower })}</b><span>{t('Or first available')}</span></div>
              {cheapest != null && <div><b>{t('From {price}', { price: money(cheapest) })}</b><span>{t('Simple pricing')}</span></div>}
            </div>
          </div>
          <div className="lp-arch" style={settings.type === 'beauty' ? { backgroundImage: 'url(/photos/hero.jpg)' } : undefined}>
            <div className="lp-float lp-float-a"><span className="dot" style={today && !today.open ? { background: '#b8a3a3' } : undefined} /> {openToday}</div>
            {services[0] && <div className="lp-float lp-float-b"><small>{t('Popular')}</small><b>{services[0].name}</b><small>From {money(services[0].price)} · {dur(services[0].duration_min)}</small></div>}
          </div>
        </div>
      </section>

      <section id="lp-services" className="lp-sec alt">
        <div className="lp-wrap">
          <div className="lp-head"><span className="lp-tag">{t('What we offer')}</span><h2>{t('Book in seconds')}</h2></div>
          <div className="lp-grid">
            {services.map((s) => (
              <button key={s.id} className="lp-card" onClick={onSignup}>
                <div className="lp-pic" style={serviceImage(s) ? { backgroundImage: `url(${serviceImage(s)})` } : undefined} />
                <div className="lp-body">
                  <span className="badge">{s.category}</span>
                  <h3>{s.name}</h3>
                  <p>{s.description}</p>
                  <div className="row between"><b className="price">{s.mode === 'quote' && !s.price ? t('Quote on request') : money(s.price)}</b><span className="muted small">{s.mode === 'day' ? t('Full day') : s.mode === 'quote' ? t('Send enquiry') : dur(s.duration_min)}</span></div>
                </div>
              </button>
            ))}
          </div>
        </div>
      </section>

      {gallery.length > 0 && (
        <section id="lp-gallery" className="lp-sec">
          <div className="lp-wrap">
            <div className="lp-head"><span className="lp-tag">{t('Our work')}</span><h2>{t('See what we do')}</h2></div>
            <div className="gallery-grid">
              {gallery.map((g) => (
                <figure key={g.id} className="g-item">
                  <img src={g.url} alt={g.caption || 'Our work'} loading="lazy" />
                  {g.caption && <figcaption>{g.caption}</figcaption>}
                </figure>
              ))}
            </div>
          </div>
        </section>
      )}

      {packages.length > 0 && (
        <section id="lp-packages" className="lp-sec alt">
          <div className="lp-wrap">
            <div className="lp-head"><span className="lp-tag">{t('Save more')}</span><h2>{t('Packages')}</h2></div>
            <div className="lp-grid">
              {packages.map((p) => (
                <div key={p.id} className="lp-review">
                  <h3>{p.name}</h3>
                  <p className="muted">{p.description}</p>
                  <div className="row between"><b className="price">{money(p.price)}</b><span className="muted small">{p.sessions} sessions · {p.valid_days} days</span></div>
                  <span className="muted small">{t('Ask for it when you visit.')}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section id="lp-how" className="lp-sec">
        <div className="lp-wrap">
          <div className="lp-head"><span className="lp-tag">{t('Simple process')}</span><h2>{t('Booked in three steps')}</h2></div>
          <div className="lp-steps">
            {STEPS.map(([n, title, desc]) => (
              <div key={n}><div className="lp-num">{n}</div><h3>{t(title, { team: L.lower })}</h3><p>{t(desc)}</p></div>
            ))}
          </div>
        </div>
      </section>

      {staff.length > 0 && (
        <section id="lp-team" className="lp-sec alt">
          <div className="lp-wrap">
            <div className="lp-head"><span className="lp-tag">{t('Our team')}</span><h2>{t('Meet your {who}', { who: L.lowerMany })}</h2></div>
            <div className="lp-team">
              {staff.map((s) => (
                <div key={s.id} className="lp-person">
                  <Avatar name={s.name} src={s.photo_url} size={72} />
                  <b>{s.name}</b>
                  <span className="muted small">{s.title}</span>
                </div>
              ))}
            </div>
          </div>
        </section>
      )}

      {reviews && reviews.count > 0 && (
        <section className="lp-sec">
          <div className="lp-wrap">
            <div className="lp-head">
              <span className="lp-tag">{t('Happy customers')}</span>
              <h2>{t('Loved by our clients')}</h2>
              <p className="muted" style={{ marginTop: 8 }}><Stars value={reviews.average} size={18} /> <b>{reviews.average}</b> {t('from {n} reviews', { n: reviews.count })}</p>
            </div>
            <div className="lp-reviews">
              {reviews.items.slice(0, 3).map((r, i) => (
                <div key={i} className="lp-review"><Stars value={r.rating} size={16} /><p>“{r.comment}”</p><span className="muted small">{r.customer} · {r.service_name}</span></div>
              ))}
            </div>
          </div>
        </section>
      )}

      <section className="lp-sec alt">
        <div className="lp-wrap" style={{ maxWidth: 760 }}>
          <div className="lp-head"><span className="lp-tag">{t('Good to know')}</span><h2>{t('Questions, answered')}</h2></div>
          <div className="faq">
            {faqs.map(([q, a]) => (
              <details key={q}><summary>{q}</summary><p>{a}</p></details>
            ))}
          </div>
        </div>
      </section>

      <section className="lp-cta">
        <div className="lp-wrap">
          <h2>{t('Ready for your glow-up?')}</h2>
          <p>{t('Create a free account and book your first appointment today.')}</p>
          <button className="btn" onClick={onSignup}>{t('Book now')}</button>
        </div>
      </section>

      <footer id="lp-contact" className="lp-foot">
        <div className="lp-wrap lp-foot-in">
          <div>
            <div className="brand"><div className="brand-mark">✿</div> <BrandName /></div>
            {settings.address && <p>{settings.address}</p>}
            {settings.address && <p><a href={'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(settings.address)} target="_blank" rel="noreferrer">{t('Get directions')}</a></p>}
          </div>
          {hours.length > 0 && (
            <div>
              <b>{t('Opening hours')}</b>
              {[1, 2, 3, 4, 5, 6, 0].map((d) => {
                const h = hours.find((x) => x.dow === d)
                return <p key={d} className="small" style={{ marginTop: 4 }}>{DAYS[d].slice(0, 3)}: {h?.open ? `${time12(h.open)} – ${time12(h.close)}` : 'Closed'}</p>
              })}
            </div>
          )}
          <div>
            {settings.phone && <p>{t('Call:')} <a href={'tel:' + settings.phone}>{settings.phone}</a></p>}
            {wa && <p>{t('WhatsApp:')} <a href={'https://wa.me/' + wa} target="_blank" rel="noreferrer">{t('Chat with us')}</a></p>}
            <p className="muted small">© {settings.name}</p>
            {!SINGLE && <p className="muted small"><a href="/signup">{t('Create your own booking page')}</a></p>}
          </div>
        </div>
      </footer>
    </div>
  )
}
