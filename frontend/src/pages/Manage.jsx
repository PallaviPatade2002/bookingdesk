import { useCallback, useEffect, useRef, useState } from 'react'
import { api, bizUrl } from '../api'
import LocationFields from '../LocationFields'
import { PRESETS } from '../config'
import { applyTheme } from '../theme'
import { Avatar, DAYS, ImagePicker, Modal, dur, money, serviceImage, useLabel, useSettings } from '../ui'

const CATEGORIES = ['Hair', 'Skin', 'Bridal', 'Nails', 'Other']
const EMPTY_SVC = { name: '', description: '', category: 'Hair', duration_min: 30, price: '', image_url: '', mode: 'slot', ask_venue: false }
const MODE_HELP = {
  slot: 'Customers pick a day and a time. The booking lasts as long as the duration above.',
  day: 'Customers pick a day. The booking takes the whole opening time of that day, so only one booking per day.',
  quote: 'Price depends on the job. Customers send an enquiry; you reply with a quote and they accept it.',
}

export function Services({ toast, embedded }) {
  const [rows, setRows] = useState([])
  const [f, setF] = useState(EMPTY_SVC)
  const [editing, setEditing] = useState(null)
  const load = useCallback(() => api('GET', '/services/all').then(setRows), [])
  useEffect(() => { load() }, [load])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const cats = [...new Set([...CATEGORIES, ...rows.map((r) => r.category)])]

  const reset = () => { setF(EMPTY_SVC); setEditing(null) }
  const edit = (s) => {
    setEditing(s.id)
    setF({ name: s.name, description: s.description || '', category: s.category, duration_min: s.duration_min, price: s.price, image_url: s.image_url || '', mode: s.mode || 'slot', ask_venue: !!s.ask_venue })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const save = async (e) => {
    e.preventDefault()
    const body = { ...f, duration_min: Number(f.duration_min), price: Number(f.price) }
    try {
      editing ? await api('PUT', '/services/' + editing, body) : await api('POST', '/services', body)
      toast(editing ? 'Service updated' : 'Service added')
      reset()
      load()
    } catch (x) {
      toast(x.message)
    }
  }
  const toggle = async (s) => {
    await api('PUT', '/services/' + s.id, { active: !s.active })
    load()
  }
  const remove = async (s) => {
    if (!window.confirm(`Delete "${s.name}"? Services with past bookings are hidden instead.`)) return
    try {
      const r = await api('DELETE', '/services/' + s.id)
      toast(r.hidden ? 'Has bookings, so it was hidden instead' : 'Service deleted')
      if (editing === s.id) reset()
      load()
    } catch (x) {
      toast(x.message)
    }
  }

  return (
    <>
      {!embedded && <div className="page-head"><h1>Services</h1><p className="muted">What customers can book. Add, edit, hide or remove treatments.</p></div>}
      <form className="card form-card" onSubmit={save}>
        <h2 style={{ marginBottom: 14 }}>{editing ? 'Edit service' : 'Add a service'}</h2>
        <div className="form-grid">
          <div><label>Name</label><input value={f.name} onChange={set('name')} required maxLength={80} /></div>
          <div>
            <label>Category</label>
            <input list="cats" value={f.category} onChange={set('category')} maxLength={40} />
            <datalist id="cats">{cats.map((c) => <option key={c} value={c} />)}</datalist>
          </div>
          <div className="full"><label>Description</label><input value={f.description} onChange={set('description')} maxLength={300} /></div>
          <div><label>Duration (minutes)</label><input type="number" min="5" max="720" step="5" value={f.duration_min} onChange={set('duration_min')} required /></div>
          <div><label>Price (₹)</label><input type="number" min="0" value={f.price} onChange={set('price')} required /></div>
          <div className="full"><label>Photo</label><ImagePicker value={f.image_url} onChange={(v) => setF({ ...f, image_url: v })} /></div>
          <div className="full">
            <label>How is it booked?</label>
            <div className="chips">
              {[['slot', 'Time slot'], ['day', 'Full day'], ['quote', 'Quote request']].map(([k, t]) => (
                <button type="button" key={k} className={'chip' + (f.mode === k ? ' on' : '')} onClick={() => setF({ ...f, mode: k })}>{t}</button>
              ))}
            </div>
            <p className="muted small" style={{ marginTop: 6 }}>{MODE_HELP[f.mode]}</p>
            <label className="check" style={{ marginTop: 10, borderRadius: 12 }}>
              <input type="checkbox" checked={!!f.ask_venue} onChange={(e) => setF({ ...f, ask_venue: e.target.checked })} /> Ask the customer for the venue or address (and number of guests)
            </label>
          </div>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn">{editing ? 'Save changes' : 'Add service'}</button>
          {editing && <button type="button" className="btn ghost" onClick={reset}>Cancel</button>}
        </div>
      </form>

      <div className="svc-list">
        {rows.length === 0 && <div className="card empty">No services yet. Add your first one above.</div>}
        {rows.map((s) => (
          <div key={s.id} className="card svc-item">
            <div className="thumb" style={serviceImage(s) ? { backgroundImage: `url(${serviceImage(s)})` } : undefined} />
            <div className="main">
              <b>{s.name}</b> <span className="badge">{s.category}</span>
              <div className="muted small">{s.description}</div>
              <div className="small" style={{ marginTop: 2 }}>{s.mode === 'day' ? 'Full day' : s.mode === 'quote' ? 'Quote on request' : dur(s.duration_min)} · <b>{s.mode === 'quote' && !s.price ? 'Quote' : money(s.price)}</b>{s.ask_venue ? ' · asks for venue' : ''}</div>
            </div>
            <span className={'badge ' + (s.active ? 'completed' : 'cancelled')}>{s.active ? 'Visible' : 'Hidden'}</span>
            <div className="row wrap">
              <button className="btn ghost sm" onClick={() => edit(s)}>Edit</button>
              <button className="btn ghost sm" onClick={() => toggle(s)}>{s.active ? 'Hide' : 'Show'}</button>
              <button className="btn danger sm" onClick={() => remove(s)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

const EMPTY_STAFF = { name: '', title: '', photo_url: '', days_off: [], service_ids: [], commission_pct: '' }

// a team member's own login: they see only their appointments and earnings
function StaffLogin({ s, L, onClose, onDone, toast }) {
  const [phone, setPhone] = useState(s.login_phone || '')
  const [password, setPassword] = useState('')
  const save = async (e) => {
    e.preventDefault()
    try {
      await api('POST', `/admin/staff/${s.id}/login`, { phone, password })
      toast('Login saved')
      onDone()
    } catch (x) { toast(x.message) }
  }
  const remove = async () => {
    await api('DELETE', `/admin/staff/${s.id}/login`)
    toast('Login removed')
    onDone()
  }
  return (
    <Modal title={`${s.name}'s login`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <p className="muted small">{s.name} logs in at <b>{bizUrl()}</b> with this phone number and password, and sees only their own appointments and earnings.</p>
        <div><label>Phone number</label><input value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="numeric" required maxLength={20} /></div>
        <div><label>{s.login_phone ? 'New password (leave empty to keep)' : 'Password'}</label><input type="password" value={password} onChange={(e) => setPassword(e.target.value)} minLength={6} required={!s.login_phone} placeholder="Min 6 characters" /></div>
        <div className="row wrap"><button className="btn">Save login</button>{s.login_phone && <button type="button" className="btn danger" onClick={remove}>Remove login</button>}</div>
        <p className="muted small">Tip: this is the {L.lower}'s own account. Do not use a customer's phone number.</p>
      </form>
    </Modal>
  )
}

export function Staff({ toast }) {
  const L = useLabel()
  const [rows, setRows] = useState([])
  const [services, setServices] = useState([])
  const [f, setF] = useState(EMPTY_STAFF)
  const [editing, setEditing] = useState(null)
  const [loginFor, setLoginFor] = useState(null)
  const load = useCallback(() => {
    api('GET', '/admin/staff').then(setRows)
    api('GET', '/services/all').then(setServices)
  }, [])
  useEffect(() => { load() }, [load])

  const toggleIn = (k, v) => setF({ ...f, [k]: f[k].includes(v) ? f[k].filter((x) => x !== v) : [...f[k], v] })
  const reset = () => { setF(EMPTY_STAFF); setEditing(null) }
  const edit = (s) => {
    setEditing(s.id)
    setF({ name: s.name, title: s.title || '', photo_url: s.photo_url || '', days_off: s.days_off, service_ids: s.service_ids, commission_pct: s.commission_pct || '' })
    window.scrollTo({ top: 0, behavior: 'smooth' })
  }
  const save = async (e) => {
    e.preventDefault()
    try {
      const body = { ...f, commission_pct: Number(f.commission_pct) || 0 }
      editing ? await api('PUT', '/admin/staff/' + editing, body) : await api('POST', '/admin/staff', body)
      toast(editing ? `${L.one} updated` : `${L.one} added`)
      reset()
      load()
    } catch (x) {
      toast(x.message)
    }
  }
  const setActive = async (s, active) => {
    await api('PUT', '/admin/staff/' + s.id, { active })
    load()
  }
  const remove = async (s) => {
    if (!window.confirm(`Remove ${s.name}? ${L.many} with past bookings are made inactive instead.`)) return
    const r = await api('DELETE', '/admin/staff/' + s.id)
    toast(r.hidden ? 'Has bookings, so marked inactive' : `${L.one} removed`)
    if (editing === s.id) reset()
    load()
  }
  const svcName = (id) => services.find((s) => s.id === id)?.name

  return (
    <>
      <div className="page-head"><h1>{L.many}</h1><p className="muted">Each {L.lower} has their own calendar. Customers can pick one or choose "Any {L.lower}".</p></div>
      <form className="card form-card" onSubmit={save}>
        <h2 style={{ marginBottom: 14 }}>{editing ? `Edit ${L.lower}` : `Add a ${L.lower}`}</h2>
        <div className="form-grid">
          <div><label>Name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={60} /></div>
          <div><label>Role</label><input value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} placeholder="Role or title (optional)" maxLength={60} /></div>
          <div><label>Commission (% of service sales)</label><input type="number" min="0" max="100" step="0.5" value={f.commission_pct} onChange={(e) => setF({ ...f, commission_pct: e.target.value })} placeholder="0" /></div>
          <div className="full"><label>Photo (optional)</label><ImagePicker gallery={[]} value={f.photo_url} onChange={(v) => setF({ ...f, photo_url: v })} /></div>
          <div className="full">
            <label>Services this {L.lower} does</label>
            <div className="check-row">
              {services.map((s) => (
                <label key={s.id} className={'check' + (f.service_ids.includes(s.id) ? ' on' : '')}>
                  <input type="checkbox" checked={f.service_ids.includes(s.id)} onChange={() => toggleIn('service_ids', s.id)} /> {s.name}
                </label>
              ))}
              {!services.length && <span className="muted small">Add services first.</span>}
            </div>
          </div>
          <div className="full">
            <label>Weekly days off</label>
            <div className="check-row">
              {DAYS.map((d, i) => (
                <label key={d} className={'check' + (f.days_off.includes(i) ? ' on' : '')}>
                  <input type="checkbox" checked={f.days_off.includes(i)} onChange={() => toggleIn('days_off', i)} /> {d.slice(0, 3)}
                </label>
              ))}
            </div>
          </div>
        </div>
        <div className="row" style={{ marginTop: 16 }}>
          <button className="btn">{editing ? 'Save changes' : `Add ${L.lower}`}</button>
          {editing && <button type="button" className="btn ghost" onClick={reset}>Cancel</button>}
        </div>
      </form>

      <div className="svc-list">
        {rows.length === 0 && <div className="card empty">No {L.lowerMany} yet. Without {L.lowerMany}, each service is booked as one shared resource.</div>}
        {rows.map((s) => (
          <div key={s.id} className="card svc-item">
            <Avatar name={s.name} src={s.photo_url} size={52} />
            <div className="main">
              <b>{s.name}</b> {s.title && <span className="muted small">· {s.title}</span>}
              <div className="small" style={{ marginTop: 2 }}>{s.service_ids.map(svcName).filter(Boolean).join(', ') || <span className="muted">No services assigned</span>}</div>
              {s.days_off.length > 0 && <div className="muted small">Off: {s.days_off.map((d) => DAYS[d].slice(0, 3)).join(', ')}</div>}
              <div className="muted small">Commission {s.commission_pct || 0}% · {s.login_phone ? `login ${s.login_phone}` : 'no login yet'}</div>
            </div>
            <span className={'badge ' + (s.active ? 'completed' : 'cancelled')}>{s.active ? 'Active' : 'Inactive'}</span>
            <div className="row wrap">
              <button className="btn ghost sm" onClick={() => edit(s)}>Edit</button>
              <button className="btn ghost sm" onClick={() => setLoginFor(s)}>Login</button>
              <button className="btn ghost sm" onClick={() => setActive(s, !s.active)}>{s.active ? 'Deactivate' : 'Activate'}</button>
              <button className="btn danger sm" onClick={() => remove(s)}>Remove</button>
            </div>
          </div>
        ))}
      </div>
      {loginFor && <StaffLogin s={loginFor} L={L} toast={toast} onClose={() => setLoginFor(null)} onDone={() => { setLoginFor(null); load() }} />}
    </>
  )
}

export function Settings({ toast }) {
  const { settings, setSettings } = useSettings()
  const [f, setF] = useState(settings)
  useEffect(() => { setF(settings) }, [settings])
  // colour and font preview live while editing; leaving without saving restores the saved look
  const saved = useRef(settings)
  saved.current = settings
  useEffect(() => () => applyTheme(saved.current.brand, saved.current.font), [])
  const look = (patch) => {
    const next = { ...f, ...patch }
    setF(next)
    applyTheme(next.brand, next.font)
  }
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async (e) => {
    e.preventDefault()
    try {
      setSettings(await api('PUT', '/settings', f))
      toast('Settings saved')
    } catch (x) {
      toast(x.message)
    }
  }
  return (
    <>
      <div className="page-head"><h1>Business settings</h1><p className="muted">Shown to customers on your page and in the header.</p></div>
      <form className="card form-card" onSubmit={save} style={{ maxWidth: 720 }}>
        <div className="form-grid">
          <div className="full"><label>Business name</label><input value={f.name || ''} onChange={set('name')} required maxLength={60} /></div>
          <div className="full"><label>Tagline</label><input value={f.tagline || ''} onChange={set('tagline')} maxLength={200} /></div>
          <div><label>Phone</label><input value={f.phone || ''} onChange={set('phone')} maxLength={60} /></div>
          <div><label>WhatsApp number</label><input value={f.whatsapp || ''} onChange={set('whatsapp')} placeholder="91XXXXXXXXXX" maxLength={60} /></div>
          <div className="full">
            <label>Brand colour</label>
            <div className="swatches">
              {PRESETS.map((p) => (
                <button type="button" key={p.hex} className={'swatch' + (f.brand?.toLowerCase() === p.hex ? ' on' : '')} style={{ background: p.hex }} title={p.name} aria-label={p.name} onClick={() => look({ brand: p.hex })} />
              ))}
              <input type="color" className="swatch-input" value={f.brand || '#4f46e5'} onChange={(e) => look({ brand: e.target.value })} aria-label="Pick any colour" title="Any colour" />
            </div>
            <label style={{ marginTop: 14 }}>Heading style</label>
            <div className="chips">
              <button type="button" className={'chip' + (f.font === 'serif' ? ' on' : '')} onClick={() => look({ font: 'serif' })}>Elegant (serif)</button>
              <button type="button" className={'chip' + (f.font === 'sans' ? ' on' : '')} onClick={() => look({ font: 'sans' })}>Clean (sans)</button>
            </div>
          </div>
          <div className="full">
            <LocationFields
              value={{ city: f.city, address: f.address, lat: f.lat, lng: f.lng, listed: f.listed === '1' }}
              onChange={(p) => setF((cur) => ({ ...cur, ...p, ...('listed' in p ? { listed: p.listed ? '1' : '0' } : {}) }))}
            />
          </div>
          <div className="full"><label>Customers can cancel or reschedule until (hours before the appointment)</label><input type="number" min="0" max="72" value={f.cancel_hours ?? 2} onChange={set('cancel_hours')} /></div>
          <div className="full"><label>What do you call your team? (for example Stylist, Doctor, Trainer)</label><input value={f.staff_label || ''} onChange={set('staff_label')} maxLength={30} /></div>
          <div className="full">
            <label>Language your customers see first</label>
            <select value={f.language || 'en'} onChange={set('language')}>
              <option value="en">English</option><option value="mr">मराठी (Marathi)</option><option value="hi">हिन्दी (Hindi)</option>
            </select>
            <p className="muted small" style={{ marginTop: 6 }}>Customers can switch language themselves. The owner and team screens stay in English.</p>
          </div>
          <div className="full"><h2 style={{ fontSize: '1.05rem', marginTop: 8 }}>Billing and reminders</h2></div>
          <div><label>GST number (optional)</label><input value={f.gst_number || ''} onChange={set('gst_number')} maxLength={20} /></div>
          <div><label>GST % added to bills (0 = none)</label><input type="number" min="0" max="28" step="0.5" value={f.gst_percent ?? 0} onChange={set('gst_percent')} /></div>
          <div><label>UPI ID (shows a QR code to pay)</label><input value={f.upi_id || ''} onChange={set('upi_id')} placeholder="name@bank" maxLength={60} /></div>
          <div><label>Bill number prefix</label><input value={f.invoice_prefix ?? ''} onChange={set('invoice_prefix')} maxLength={8} /></div>
          <div className="full"><label>Message at the bottom of bills</label><input value={f.invoice_footer || ''} onChange={set('invoice_footer')} maxLength={200} /></div>
          <div className="full">
            <label>Automatic reminder, hours before the appointment (0 = off)</label>
            <input type="number" min="0" max="72" value={f.reminder_hours ?? 24} onChange={set('reminder_hours')} />
            <p className="muted small" style={{ marginTop: 6 }}>Reminders appear in Marketing, Messages. They are really sent only when the site administrator has connected a WhatsApp or SMS provider.</p>
          </div>
        </div>
        <button className="btn" style={{ marginTop: 16 }}>Save settings</button>
      </form>
    </>
  )
}

// A private link that puts all appointments into Google / Apple / Outlook calendar
export function CalendarLink({ toast }) {
  const [url, setUrl] = useState('')
  const get = async (regenerate) => {
    if (regenerate && !window.confirm('The old link will stop working. Continue?')) return
    try {
      const r = await api('POST', '/admin/calendar-link', { regenerate })
      setUrl(window.location.origin + r.path)
    } catch (x) { toast(x.message) }
  }
  const copy = () => navigator.clipboard?.writeText(url).then(() => toast('Link copied'))
  return (
    <div className="card form-card" style={{ maxWidth: 720 }}>
      <h2 style={{ marginBottom: 6 }}>Your calendar</h2>
      <p className="muted small" style={{ marginBottom: 12 }}>See all appointments in your phone calendar. In Google Calendar choose "Add calendar, From URL" and paste the link. Keep it private: anyone with the link can see your appointments.</p>
      {!url ? <button className="btn ghost" onClick={() => get(false)}>Show my calendar link</button> : (
        <div className="stack" style={{ gap: 8 }}>
          <input readOnly value={url} onFocus={(e) => e.target.select()} />
          <div className="row wrap"><button className="btn ghost sm" onClick={copy}>Copy link</button><button className="btn danger sm" onClick={() => get(true)}>Make a new link</button></div>
        </div>
      )}
    </div>
  )
}
