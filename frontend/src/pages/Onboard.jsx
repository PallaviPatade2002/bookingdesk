import { useEffect, useState } from 'react'
import { gapi, setSession } from '../api'
import { PLATFORM_NAME } from '../config'
import LocationFields from '../LocationFields'

const slugify = (s) => s.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40)

// Business owner sign-up: creates the business, the owner login and starter content
export default function Onboard() {
  const [types, setTypes] = useState([])
  const [f, setF] = useState({ business_name: '', type: 'beauty', slug: '', owner_name: '', phone: '', password: '', sample: true, city: '', address: '', lat: '', lng: '', listed: true })
  const [slugTouched, setSlugTouched] = useState(false)
  const [avail, setAvail] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { gapi('GET', '/types').then(setTypes).catch(() => {}) }, [])
  const slug = slugTouched ? slugify(f.slug) : slugify(f.business_name)

  // live check that the web address is free
  useEffect(() => {
    if (slug.length < 3) { setAvail(null); return }
    const t = setTimeout(() => gapi('GET', '/slug-check?slug=' + encodeURIComponent(slug)).then((r) => setAvail(r.available)).catch(() => setAvail(null)), 300)
    return () => clearTimeout(t)
  }, [slug])

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      const r = await gapi('POST', '/signup', { ...f, slug })
      setSession({ token: r.token, user: r.user }, r.slug)
      window.location.href = '/b/' + r.slug
    } catch (x) {
      setErr(x.message)
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <section className="auth-hero">
        <a className="brand" href="/" style={{ color: '#fff' }}><div className="brand-mark" style={{ background: 'rgba(255,255,255,0.18)' }}>✿</div> {PLATFORM_NAME}</a>
        <div>
          <h1>Create your booking page</h1>
          <p>Free to start. Add your services, share your link and let customers book themselves.</p>
          <ul className="feature-list">
            <li><span>✓</span> Your own web address and private data</li>
            <li><span>✓</span> Calendar, dashboard and customer list</li>
            <li><span>✓</span> Starter services you can change any time</li>
          </ul>
        </div>
        <p className="small" style={{ margin: 0 }}>© {PLATFORM_NAME}</p>
      </section>

      <section className="auth-form">
        <form className="card auth-card stack" onSubmit={submit} style={{ maxWidth: 440 }}>
          <div>
            <h2>Register your business</h2>
            <p className="muted small" style={{ marginTop: 4 }}>This creates the owner account for your business.</p>
          </div>
          <div><label>Business name</label><input value={f.business_name} onChange={set('business_name')} placeholder="e.g. Glow Studio" required maxLength={60} /></div>
          <div>
            <label>Type of business</label>
            <select value={f.type} onChange={set('type')}>
              {types.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
            </select>
          </div>
          <div>
            <label>Your web address</label>
            <div className="slug-box"><span>{window.location.host}/b/</span><input value={slugTouched ? f.slug : slug} onChange={(e) => { setSlugTouched(true); setF({ ...f, slug: e.target.value }) }} maxLength={40} /></div>
            {slug.length >= 3 && avail !== null && (
              <p className="small" style={{ marginTop: 4, color: avail ? 'var(--ok)' : 'var(--bad)' }}>{avail ? 'Available' : 'Already taken, a number will be added'}</p>
            )}
          </div>
          <LocationFields value={f} onChange={(p) => setF((cur) => ({ ...cur, ...p }))} />
          <div><label>Your name</label><input value={f.owner_name} onChange={set('owner_name')} required maxLength={80} /></div>
          <div><label>Your phone number (your login)</label><input value={f.phone} onChange={set('phone')} inputMode="numeric" required maxLength={20} /></div>
          <div><label>Password</label><input type="password" value={f.password} onChange={set('password')} minLength={6} placeholder="Min 6 characters" required /></div>
          <label className="check" style={{ borderRadius: 12 }}><input type="checkbox" checked={f.sample} onChange={(e) => setF({ ...f, sample: e.target.checked })} /> Add starter services (you can edit them)</label>
          {err && <div className="error">{err}</div>}
          <button className="btn block" disabled={busy}>{busy ? 'Creating…' : 'Create my business'}</button>
          <p className="muted small">Already registered? Open your booking page and log in as owner.</p>
        </form>
      </section>
    </div>
  )
}
