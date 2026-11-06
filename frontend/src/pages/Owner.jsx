import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { Badge, Modal, iso, money, nice, parseDate, time12, useLabel, useSettings, waLink } from '../ui'
import { Checkout, InvoiceView, Receive } from './Billing'

// ---------- one appointment: details + actions + WhatsApp reminder ----------
export function BookingModal({ b, onClose, onChanged, toast }) {
  const { settings } = useSettings()
  const L = useLabel()
  const [step, setStep] = useState(null) // 'pay' | 'bill'
  const [billId, setBillId] = useState(b.invoice_id || null)
  const setStatus = async (status) => {
    try {
      await api('PATCH', `/admin/bookings/${b.id}`, { status })
      toast('Updated')
      onChanged()
      onClose()
    } catch (e) {
      toast(e.message)
    }
  }
  const msg = `Hi ${b.customer_name}, a reminder of your ${b.service_name} appointment at ${settings.name} on ${nice(b.date)} at ${time12(b.start)}. See you soon!`
  return (
    <Modal title={b.service_name} onClose={onClose}>
      <div className="stack" style={{ gap: 10 }}>
        <div className="row between"><span className="muted">When</span><b>{nice(b.date)} · {time12(b.start)} – {time12(b.end)}</b></div>
        <div className="row between"><span className="muted">Customer</span><b>{b.customer_name}</b></div>
        <div className="row between"><span className="muted">Phone</span><a href={'tel:' + b.customer_phone}><b>{b.customer_phone}</b></a></div>
        {b.staff_name && <div className="row between"><span className="muted">{L.one}</span><b>{b.staff_name}</b></div>}
        <div className="row between"><span className="muted">Price</span><b>{money(b.price)}{b.coupon_code ? ` (${b.coupon_code})` : ''}</b></div>
        <div className="row between"><span className="muted">Status</span><Badge status={b.status} /></div>
        {b.venue && <div className="row between"><span className="muted">Venue</span><b style={{ textAlign: 'right' }}>{b.venue}</b></div>}
        {b.guests && <div className="row between"><span className="muted">Guests</span><b>{b.guests}</b></div>}
        {b.note && <div className="panel" style={{ margin: 0 }}>“{b.note}”</div>}
        {(b.status === 'booked' || b.status === 'completed') && (billId
          ? <button className="btn block" onClick={() => setStep('bill')}>View bill</button>
          : <button className="btn block" onClick={() => setStep('pay')}>Take payment</button>)}
        <a className="btn ghost block" href={waLink(msg, b.customer_phone)} target="_blank" rel="noreferrer">Send WhatsApp reminder</a>
        {b.status === 'booked' && (
          <div className="row wrap">
            <button className="btn success sm" onClick={() => setStatus('completed')}>Complete</button>
            <button className="btn ghost sm" onClick={() => setStatus('no_show')}>No-show</button>
            <button className="btn danger sm" onClick={() => setStatus('cancelled')}>Cancel</button>
          </div>
        )}
      </div>
      {step === 'pay' && <Checkout booking={b} toast={toast} onClose={() => setStep(null)} onDone={(inv) => { setBillId(inv.id); setStep('bill'); onChanged(); toast(`Bill ${inv.label} saved`) }} />}
      {step === 'bill' && billId && <InvoiceView id={billId} admin toast={toast} onChanged={onChanged} onClose={() => setStep(null)} />}
    </Modal>
  )
}

// ---------- owner books for a walk-in / phone customer ----------
export function WalkIn({ date: initial, onClose, onDone, toast }) {
  const L = useLabel()
  const [services, setServices] = useState([])
  const [stylists, setStylists] = useState([])
  const [f, setF] = useState({ name: '', phone: '', service_id: '', staff_id: '', date: initial, time: '', note: '' })
  const [slots, setSlots] = useState(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => { api('GET', '/services').then(setServices) }, [])
  useEffect(() => {
    if (!f.service_id) return
    api('GET', '/staff?service_id=' + f.service_id).then(setStylists).catch(() => {})
  }, [f.service_id])
  useEffect(() => {
    if (!f.service_id || !f.date) return
    api('GET', `/slots?date=${f.date}&service_id=${f.service_id}${f.staff_id ? '&staff_id=' + f.staff_id : ''}`)
      .then((r) => setSlots(r.slots))
      .catch((e) => toast(e.message))
  }, [f.service_id, f.staff_id, f.date, toast])

  const set = (k) => (e) => setF({ ...f, [k]: e.target.value, ...(k !== 'time' && k !== 'name' && k !== 'phone' && k !== 'note' ? { time: '' } : {}), ...(k === 'service_id' ? { staff_id: '' } : {}) })
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      await api('POST', '/admin/bookings', { ...f, service_id: Number(f.service_id), staff_id: f.staff_id ? Number(f.staff_id) : undefined })
      toast('Appointment added')
      onDone()
    } catch (x) {
      toast(x.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Add appointment" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div><label>Customer name</label><input value={f.name} onChange={set('name')} required maxLength={80} /></div>
        <div><label>Phone</label><input value={f.phone} onChange={set('phone')} inputMode="numeric" required maxLength={20} /></div>
        <div>
          <label>Treatment</label>
          <select value={f.service_id} onChange={set('service_id')} required>
            <option value="">Choose…</option>
            {services.map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.price)}</option>)}
          </select>
        </div>
        {stylists.length > 0 && f.service_id && (
          <div>
            <label>{L.one}</label>
            <select value={f.staff_id} onChange={set('staff_id')}>
              <option value="">Any {L.lower}</option>
              {stylists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        )}
        <div><label>Date</label><input type="date" value={f.date} min={iso(new Date())} onChange={set('date')} required /></div>
        {f.service_id && (
          <div>
            <label>Time</label>
            {slots === null ? <p className="muted small">Loading…</p> : slots.length === 0 ? <p className="muted small">No free slots on this day.</p> : (
              <div className="slot-grid">{slots.map((t) => <button type="button" key={t} className={'slot' + (f.time === t ? ' selected' : '')} onClick={() => setF({ ...f, time: t })}>{time12(t)}</button>)}</div>
            )}
          </div>
        )}
        <div><label>Note (optional)</label><input value={f.note} onChange={set('note')} maxLength={300} /></div>
        <button className="btn block" disabled={busy || !f.time}>{busy ? 'Saving…' : 'Add appointment'}</button>
      </form>
    </Modal>
  )
}

// ---------- customers ----------
export function Customers({ toast }) {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [open, setOpen] = useState(null)
  const [notes, setNotes] = useState('')
  const [temp, setTemp] = useState(null)
  const [account, setAccount] = useState(null)
  const [receiving, setReceiving] = useState(null)
  const [selling, setSelling] = useState(null)
  const [bill, setBill] = useState(null)
  const load = useCallback(() => api('GET', '/admin/customers').then(setRows), [])
  const loadAccount = useCallback((id) => api('GET', `/admin/customers/${id}/account`).then(setAccount).catch(() => setAccount(null)), [])
  useEffect(() => { load() }, [load])

  const shown = (rows || []).filter((c) => (c.name + c.phone).toLowerCase().includes(q.toLowerCase()))
  const toggle = (c) => {
    const next = open === c.id ? null : c.id
    setOpen(next)
    setNotes(c.notes || '')
    setAccount(null)
    if (next) loadAccount(next)
  }
  const due = (rows || []).reduce((s, c) => s + Math.max(0, c.due || 0), 0)
  const saveNotes = async (c) => {
    await api('PUT', '/admin/customers/' + c.id, { notes })
    toast('Notes saved')
    load()
  }
  const reset = async (c) => {
    if (!window.confirm(`Create a temporary password for ${c.name}?`)) return
    const r = await api('POST', `/admin/customers/${c.id}/reset-password`)
    setTemp({ name: c.name, phone: c.phone, pw: r.temp_password })
  }

  return (
    <>
      <div className="page-head row between wrap">
        <div><h1>Customers</h1><p className="muted">{rows ? `${rows.length} customers` : ''}{due > 0 && ` · ${money(due)} due from customers`}</p></div>
        <input placeholder="Search name or phone" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 260 }} />
      </div>
      <div className="svc-list">
        {rows === null && <p className="muted">Loading…</p>}
        {rows && shown.length === 0 && <div className="card empty">No customers found.</div>}
        {shown.map((c) => (
          <div key={c.id} className="card svc-item">
            <div className="main">
              <b>{c.name}</b> <span className="muted small">· {c.phone}</span>{c.due > 0.009 && <span className="badge no_show" style={{ marginLeft: 8 }}>Owes {money(c.due)}</span>}{c.optout ? <span className="badge cancelled" style={{ marginLeft: 8 }}>No offers</span> : null}
              <div className="small muted">
                {c.visits} visit{c.visits === 1 ? '' : 's'} · {money(c.spent)} spent{c.last_booking && ` · last booking ${parseDate(c.last_booking).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}`}
              </div>
              {c.notes && open !== c.id && <div className="small" style={{ marginTop: 2 }}>📝 {c.notes}</div>}
            </div>
            <div className="row wrap">
              <a className="btn ghost sm" href={waLink(`Hi ${c.name.split(' ')[0]}, `, c.phone)} target="_blank" rel="noreferrer">WhatsApp</a>
              {c.due > 0.009 && <button className="btn sm" onClick={() => setReceiving(c)}>Receive</button>}
              <button className="btn ghost sm" onClick={() => toggle(c)}>{open === c.id ? 'Close' : 'Account'}</button>
            </div>
            {open === c.id && (
              <div className="panel stack">
                {account ? (
                  <>
                    <div className="row between wrap">
                      <b>Account</b>
                      <button className="btn sm" onClick={() => setSelling(c)}>New sale</button>
                    </div>
                    {account.packages.length > 0 && (
                      <div className="small">{account.packages.map((p) => <div key={p.id}>🎟 {p.name}: <b>{p.sessions_left}</b> session{p.sessions_left === 1 ? '' : 's'} left, until {p.expires}</div>)}</div>
                    )}
                    {account.invoices.length === 0 ? <p className="muted small">No bills yet.</p> : (
                      <div className="stack" style={{ gap: 4 }}>
                        {account.invoices.slice(0, 6).map((i) => (
                          <button key={i.id} className="step-item" onClick={() => setBill(i.id)}>
                            <b>{i.label}</b> <span className="muted small">{i.created_at.slice(0, 10)}</span> <span style={{ marginLeft: 'auto' }}>{money(i.total)}{i.due > 0.009 ? <span className="badge no_show" style={{ marginLeft: 8 }}>Due {money(i.due)}</span> : null}</span>
                          </button>
                        ))}
                      </div>
                    )}
                    {c.birthday && <p className="muted small">Birthday: {parseDate(c.birthday).toLocaleDateString('en-IN', { day: 'numeric', month: 'long' })}</p>}
                  </>
                ) : <p className="muted small">Loading account…</p>}
                <label>Private notes (only you see this)</label>
                <textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Allergies, preferences, anything worth remembering…" maxLength={500} />
                <div className="row wrap">
                  <button className="btn sm" onClick={() => saveNotes(c)}>Save notes</button>
                  <button className="btn ghost sm" onClick={() => reset(c)}>Reset password</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      {temp && (
        <Modal title="Temporary password" onClose={() => setTemp(null)}>
          <p>Share this with <b>{temp.name}</b>. They can change it in Profile after logging in.</p>
          <p style={{ fontSize: '1.6rem', fontWeight: 700, letterSpacing: '.08em', margin: '14px 0' }}>{temp.pw}</p>
          <a className="btn block" href={waLink(`Your temporary password is ${temp.pw}. Please change it after you log in.`, temp.phone)} target="_blank" rel="noreferrer">Send on WhatsApp</a>
        </Modal>
      )}
      {receiving && <Receive customer={receiving} due={receiving.due} toast={toast} onClose={() => setReceiving(null)} onDone={() => { setReceiving(null); load(); if (open) loadAccount(open) }} />}
      {selling && <Checkout customer={selling} toast={toast} onClose={() => setSelling(null)} onDone={(inv) => { setSelling(null); load(); if (open) loadAccount(open); setBill(inv.id); toast(`Bill ${inv.label} saved`) }} />}
      {bill && <InvoiceView id={bill} admin toast={toast} onChanged={() => { load(); if (open) loadAccount(open) }} onClose={() => setBill(null)} />}
    </>
  )
}

// ---------- offers / coupons ----------
export function Offers({ toast, embedded }) {
  const [rows, setRows] = useState([])
  const [f, setF] = useState({ code: '', percent: 10, expires: '' })
  const load = useCallback(() => api('GET', '/admin/coupons').then(setRows), [])
  useEffect(() => { load() }, [load])
  const add = async (e) => {
    e.preventDefault()
    try {
      await api('POST', '/admin/coupons', { code: f.code, percent: Number(f.percent), expires: f.expires || null })
      setF({ code: '', percent: 10, expires: '' })
      toast('Offer created')
      load()
    } catch (x) {
      toast(x.message)
    }
  }
  const toggle = async (c) => { await api('PUT', '/admin/coupons/' + c.code, { active: !c.active }); load() }
  const remove = async (c) => {
    if (!window.confirm(`Delete ${c.code}?`)) return
    await api('DELETE', '/admin/coupons/' + c.code)
    load()
  }
  const expired = (c) => c.expires && c.expires < iso(new Date())

  return (
    <>
      {!embedded && <div className="page-head"><h1>Offers</h1><p className="muted">Discount codes customers can apply when booking.</p></div>}
      <form className="card form-card" onSubmit={add}>
        <div className="form-grid">
          <div><label>Code</label><input value={f.code} onChange={(e) => setF({ ...f, code: e.target.value.toUpperCase() })} placeholder="FESTIVE20" required maxLength={20} /></div>
          <div><label>Discount (%)</label><input type="number" min="1" max="90" value={f.percent} onChange={(e) => setF({ ...f, percent: e.target.value })} required /></div>
          <div><label>Valid until (optional)</label><input type="date" value={f.expires} onChange={(e) => setF({ ...f, expires: e.target.value })} /></div>
        </div>
        <button className="btn" style={{ marginTop: 16 }}>Create offer</button>
      </form>
      <div className="svc-list">
        {rows.length === 0 && <div className="card empty">No offers yet.</div>}
        {rows.map((c) => (
          <div key={c.code} className="card svc-item">
            <div className="main"><b style={{ letterSpacing: '.06em' }}>{c.code}</b> <span className="badge">{c.percent}% off</span>
              <div className="muted small">Used {c.used} time{c.used === 1 ? '' : 's'}{c.expires && ` · ${expired(c) ? 'expired' : 'valid until'} ${nice(c.expires)}`}</div>
            </div>
            <span className={'badge ' + (c.active && !expired(c) ? 'completed' : 'cancelled')}>{c.active && !expired(c) ? 'Active' : 'Off'}</span>
            <div className="row wrap">
              <button className="btn ghost sm" onClick={() => toggle(c)}>{c.active ? 'Turn off' : 'Turn on'}</button>
              <button className="btn danger sm" onClick={() => remove(c)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}
