import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import {
  Avatar, Badge, Stars, Toast, TopBar, addMinutes, dur, downloadIcs, iso, money, nice, parseDate,
  serviceImage, time12, useLabel, useSettings, waLink,
} from '../ui'
import Profile from './Profile'
import { InvoiceView } from './Billing'
import { useT } from '../i18n'
import { dateLocale } from '../ui-locale'

const nextDays = (n) => Array.from({ length: n }, (_, i) => {
  const d = new Date()
  d.setDate(d.getDate() + i)
  return d
})

function DateStrip({ date, setDate }) {
  return (
    <div className="date-strip">
      {nextDays(21).map((d) => (
        <button key={iso(d)} type="button" className={'date-chip' + (iso(d) === date ? ' selected' : '')} onClick={() => setDate(iso(d))}>
          <small>{d.toLocaleDateString(dateLocale(), { weekday: 'short' })}</small>
          <b>{d.getDate()}</b>
          <small>{d.toLocaleDateString(dateLocale(), { month: 'short' })}</small>
        </button>
      ))}
    </div>
  )
}

function Slots({ slots, time, setTime, emptyText, fullDay }) {
  const t = useT()
  if (slots === null) return <p className="muted">{t('Loading slots…')}</p>
  if (!slots.length) return <div className="empty" style={{ padding: 16 }}>{emptyText}</div>
  if (fullDay) return <p style={{ padding: 8 }}>{t('✓ This day is free. You will book the whole day.')}</p>
  return (
    <div className="slot-grid">
      {slots.map((t) => <button key={t} type="button" className={'slot' + (time === t ? ' selected' : '')} onClick={() => setTime(t)}>{time12(t)}</button>)}
    </div>
  )
}

function Confirmation({ done, onView, onAgain }) {
  const t = useT()
  const { settings } = useSettings()
  const L = useLabel()
  const end = done.end || addMinutes(done.time, done.svc.duration_min)
  const fullDay = done.svc.mode === 'day'
  const text = t('I booked {service} at {business} on {date} at {time}.', { service: done.svc.name, business: settings.name, date: nice(done.date), time: time12(done.time) })
  return (
    <div className="card confirm-card">
      <div className="confirm-check">✓</div>
      <h1>{t('Booking confirmed')}</h1>
      <p className="muted">{t('We have reserved your slot. See you soon!')}</p>
      <dl>
        <div><dt>{t('Treatment')}</dt><dd>{done.svc.name}</dd></div>
        {done.staffName && <div><dt>{L.one}</dt><dd>{done.staffName}</dd></div>}
        <div><dt>{t('Date')}</dt><dd>{nice(done.date)}</dd></div>
        <div><dt>{t('Time')}</dt><dd>{fullDay ? t('Full day') : `${time12(done.time)} – ${time12(end)}`}</dd></div>
        {done.venue && <div><dt>{t('Venue')}</dt><dd>{done.venue}</dd></div>}
        <div><dt>{t('To pay')}</dt><dd>{money(done.price)}</dd></div>
        {settings.address && <div><dt>{t('Where')}</dt><dd>{settings.address}</dd></div>}
      </dl>
      <div className="stack" style={{ gap: 10 }}>
        <button className="btn block" onClick={onView}>{t('View my bookings')}</button>
        <div className="row wrap" style={{ justifyContent: 'center' }}>
          <button className="btn ghost sm" onClick={() => downloadIcs({ title: `${done.svc.name} at ${settings.name}`, date: done.date, start: done.time, end, location: settings.address || '' })}>{t('Add to calendar')}</button>
          <a className="btn ghost sm" href={waLink(text)} target="_blank" rel="noreferrer">{t('Share on WhatsApp')}</a>
          <button className="btn ghost sm" onClick={onAgain}>{t('Book another')}</button>
        </div>
      </div>
    </div>
  )
}

function Book({ onBooked, onEnquiry }) {
  const t = useT()
  const L = useLabel()
  const [venue, setVenue] = useState('')
  const [guests, setGuests] = useState('')
  const [services, setServices] = useState([])
  const [cat, setCat] = useState('All')
  const [svc, setSvc] = useState(null)
  const [stylists, setStylists] = useState([])
  const [staffId, setStaffId] = useState('')
  const [date, setDate] = useState(iso(new Date()))
  const [slots, setSlots] = useState(null)
  const [time, setTime] = useState('')
  const [note, setNote] = useState('')
  const [code, setCode] = useState('')
  const [coupon, setCoupon] = useState(null)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api('GET', '/services').then(setServices).catch((e) => setErr(e.message))
  }, [])

  const pick = (s) => {
    setSvc(s)
    setStaffId('')
    setStylists([])
    api('GET', '/staff?service_id=' + s.id).then(setStylists).catch(() => {})
  }

  const loadSlots = useCallback(() => {
    if (!svc) return
    setTime('')
    if (svc.mode === 'quote') { setSlots([]); return }
    setSlots(null)
    api('GET', `/slots?date=${date}&service_id=${svc.id}${staffId ? '&staff_id=' + staffId : ''}`)
      .then((r) => {
        setSlots(r.slots)
        if (svc.mode === 'day' && r.slots.length) setTime(r.slots[0]) // a full-day booking has only one start
      })
      .catch((e) => setErr(e.message))
  }, [svc, date, staffId])
  useEffect(loadSlots, [loadSlots])

  const applyCoupon = async () => {
    setErr('')
    try {
      setCoupon(await api('GET', '/coupons/check?code=' + encodeURIComponent(code)))
    } catch (e) {
      setCoupon(null)
      setErr(e.message)
    }
  }

  const isQuote = svc?.mode === 'quote'
  const isDay = svc?.mode === 'day'
  const ready = !!svc && (isQuote || !!time)
  const price = svc ? (coupon ? Math.round((svc.price * (100 - coupon.percent)) / 100) : svc.price) : 0

  const confirm = async () => {
    setErr('')
    setBusy(true)
    try {
      if (isQuote) {
        await api('POST', '/enquiries', { service_id: svc.id, date, venue, guests: guests ? Number(guests) : undefined, details: note })
        onEnquiry()
        return
      }
      const r = await api('POST', '/bookings', { service_id: svc.id, date, time, note, venue, guests: guests ? Number(guests) : undefined, ...(staffId && { staff_id: Number(staffId) }), ...(coupon && { coupon: coupon.code }) })
      const staffName = stylists.find((s) => s.id === r.staff_id)?.name
      onBooked({ svc, date, time, staffName, price: r.price, end: r.end, venue })
    } catch (e) {
      setErr(e.message)
      loadSlots()
    } finally {
      setBusy(false)
    }
  }

  const cats = ['All', ...new Set(services.map((s) => s.category))]
  const shown = services.filter((s) => cat === 'All' || s.category === cat)
  const chosen = stylists.find((s) => String(s.id) === String(staffId))

  const step = !svc ? 1 : !ready ? 2 : 3
  const stepEl = (n, label) => (
    <div className={'step ' + (step === n ? 'on' : step > n ? 'done' : '')}><i>{step > n ? '✓' : n}</i> {label}</div>
  )

  return (
    <>
      <div className="page-head">
        <h1>{t('Book an appointment')}</h1>
        <p className="muted">{t('Choose a treatment, then pick a day and time.')}</p>
      </div>
      <div className="steps">{stepEl(1, t('Treatment'))}{stepEl(2, t('Date & time'))}{stepEl(3, t('Confirm'))}</div>
      {err && <div className="error" style={{ marginBottom: 16 }}>{err}</div>}

      <div className="grid book-layout">
        <div className="stack" style={{ gap: 24 }}>
          <section>
            <h2 style={{ marginBottom: 12 }}>{t('1. Select treatment')}</h2>
            {cats.length > 2 && (
              <div className="chips" style={{ marginBottom: 14 }}>
                {cats.map((c) => <button key={c} className={'chip' + (cat === c ? ' on' : '')} onClick={() => setCat(c)}>{c}</button>)}
              </div>
            )}
            <div className="grid cols-2">
              {shown.map((s) => (
                <div key={s.id} className={'card service-card' + (svc?.id === s.id ? ' selected' : '')} onClick={() => pick(s)}>
                  <div className="pic" style={serviceImage(s) ? { backgroundImage: `url(${serviceImage(s)})` } : undefined} />
                  <div className="body">
                    <div className="row between">
                      <h3>{s.name}</h3>
                      <span className="price">{s.mode === 'quote' && !s.price ? t('Quote') : money(s.price)}</span>
                    </div>
                    <p className="muted small" style={{ margin: '6px 0 10px' }}>{s.description}</p>
                    <span className="badge">{s.mode === 'day' ? t('Full day') : s.mode === 'quote' ? t('Send enquiry') : dur(s.duration_min)}</span>
                  </div>
                </div>
              ))}
              {!services.length && !err && <div className="empty">{t('No treatments available yet.')}</div>}
            </div>
          </section>

          {svc && !isQuote && stylists.length > 0 && (
            <section>
              <h2 style={{ marginBottom: 12 }}>{t('2. Choose your {who}', { who: L.lower })}</h2>
              <div className="grid cols-2">
                <div className={'card stylist' + (!staffId ? ' selected' : '')} onClick={() => setStaffId('')}>
                  <Avatar name="Any" size={40} /> <div><b>{t('Any {who}', { who: L.lower })}</b><div className="muted small">{t('First available')}</div></div>
                </div>
                {stylists.map((s) => (
                  <div key={s.id} className={'card stylist' + (String(s.id) === String(staffId) ? ' selected' : '')} onClick={() => setStaffId(String(s.id))}>
                    <Avatar name={s.name} src={s.photo_url} size={40} /> <div><b>{s.name}</b><div className="muted small">{s.title}</div></div>
                  </div>
                ))}
              </div>
            </section>
          )}

          {svc && (
            <section>
              <h2 style={{ marginBottom: 12 }}>{!isQuote && stylists.length > 0 ? '3' : '2'}. {isQuote ? t('Pick the date of your event') : isDay ? t('Pick the day') : t('Pick date & time')}</h2>
              <DateStrip date={date} setDate={setDate} />
              {!isQuote && (
                <div className="card" style={{ marginTop: 8 }}>
                  <Slots slots={slots} time={time} setTime={setTime} fullDay={isDay} emptyText={chosen ? t('No free slots on this day for {name}. Try another date or {who}.', { name: chosen.name, who: L.lower }) : t('No free slots on this day. Try another date.')} />
                </div>
              )}
            </section>
          )}
        </div>

        <aside className="card summary stack">
          <h2>{isQuote ? t('Your enquiry') : t('Your booking')}</h2>
          <dl>
            <div><dt>{t('Treatment')}</dt><dd>{svc ? svc.name : '—'}</dd></div>
            {!isQuote && stylists.length > 0 && <div><dt>{L.one}</dt><dd>{chosen ? chosen.name : t('Any {who}', { who: L.lower })}</dd></div>}
            <div><dt>{t('Date')}</dt><dd>{svc ? nice(date) : '—'}</dd></div>
            {!isQuote && <div><dt>{t('Time')}</dt><dd>{isDay ? (time ? t('Full day') : '—') : time ? time12(time) : '—'}</dd></div>}
            {!isQuote && !isDay && <div><dt>{t('Duration')}</dt><dd>{svc ? dur(svc.duration_min) : '—'}</dd></div>}
            <div><dt>{isQuote ? t('Price') : t('Total')}</dt><dd className="price">{!svc ? '—' : isQuote ? t('Quote on request') : <>{coupon && <span className="strike">{money(svc.price)}</span>}{money(price)}</>}</dd></div>
          </dl>
          {!!svc?.ask_venue && (
            <div className="stack" style={{ gap: 8 }}>
              <div><label>{t('Venue / address *')}</label><input value={venue} onChange={(e) => setVenue(e.target.value)} placeholder={t('Where should we come?')} maxLength={200} /></div>
              <div><label>{t('Number of guests (optional)')}</label><input type="number" min="1" value={guests} onChange={(e) => setGuests(e.target.value)} /></div>
            </div>
          )}
          {!isQuote && <div>
            <label>{t('Coupon code')}</label>
            <div className="coupon-row">
              <input value={code} onChange={(e) => { setCode(e.target.value); setCoupon(null) }} placeholder={t('e.g. WELCOME10')} maxLength={20} />
              <button type="button" className="btn ghost sm" onClick={applyCoupon} disabled={!code.trim()}>{t('Apply')}</button>
            </div>
            {coupon && <p className="small" style={{ color: 'var(--ok)', marginTop: 6 }}>{coupon.code} applied: {coupon.percent}% off</p>}
          </div>}
          <div>
            <label>{isQuote ? t('Tell us what you need') : t('Note (optional)')}</label>
            <textarea rows={isQuote ? 4 : 2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={isQuote ? t('Theme, size, anything that helps us quote') : t('Anything we should know?')} maxLength={isQuote ? 500 : 300} />
          </div>
          <button className="btn block" disabled={!ready || busy || (svc?.ask_venue && !venue.trim())} onClick={confirm}>
            {busy ? t('Please wait…') : isQuote ? t('Send enquiry') : t('Confirm booking')}
          </button>
          <p className="muted small">{isQuote ? t('We will reply with a price. You decide after that.') : t('Pay at the business after your service.')}</p>
        </aside>
      </div>
    </>
  )
}

function Reschedule({ b, onDone, onClose, toast }) {
  const t = useT()
  const L = useLabel()
  const [date, setDate] = useState(b.date >= iso(new Date()) ? b.date : iso(new Date()))
  const [stylists, setStylists] = useState([])
  const [pref, setPref] = useState(b.staff_id ? String(b.staff_id) : '')
  const [slots, setSlots] = useState(null)
  const [time, setTime] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => { api('GET', '/staff?service_id=' + b.service_id).then(setStylists).catch(() => {}) }, [b.service_id])
  useEffect(() => {
    setSlots(null)
    setTime('')
    api('GET', `/slots?date=${date}&service_id=${b.service_id}&exclude=${b.id}${pref ? '&staff_id=' + pref : ''}`)
      .then((r) => setSlots(r.slots))
      .catch((e) => toast(e.message))
  }, [date, pref, b.id, b.service_id, toast])

  const save = async () => {
    setBusy(true)
    try {
      await api('PATCH', `/bookings/${b.id}/reschedule`, { date, time, staff_id: pref ? Number(pref) : null })
      toast(t('Booking moved'))
      onDone()
    } catch (e) {
      toast(e.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="panel stack">
      <b>{t('Pick a new date and time')}</b>
      {stylists.length > 0 && (
        <div>
          <label>{L.one}</label>
          <select value={pref} onChange={(e) => setPref(e.target.value)}>
            <option value="">{t('Any {who}', { who: L.lower })}</option>
            {stylists.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </div>
      )}
      <DateStrip date={date} setDate={setDate} />
      <Slots slots={slots} time={time} setTime={setTime} emptyText={t('No free slots on this day. Try another date.')} />
      <div className="row">
        <button className="btn sm" disabled={!time || busy} onClick={save}>{busy ? 'Saving…' : 'Move booking'}</button>
        <button className="btn ghost sm" onClick={onClose}>{t('Never mind')}</button>
      </div>
    </div>
  )
}

function Rate({ b, onDone, toast }) {
  const t = useT()
  const [rating, setRating] = useState(0)
  const [comment, setComment] = useState('')
  const send = async () => {
    try {
      await api('POST', `/bookings/${b.id}/review`, { rating, comment })
      toast(t('Thanks for your review!'))
      onDone()
    } catch (e) {
      toast(e.message)
    }
  }
  return (
    <div className="panel stack">
      <b>{t('How was your visit?')}</b>
      <Stars value={rating} onChange={setRating} size={28} />
      <textarea rows={2} value={comment} onChange={(e) => setComment(e.target.value)} placeholder={t('Tell us more (optional)')} maxLength={400} />
      <div><button className="btn sm" disabled={!rating} onClick={send}>{t('Submit review')}</button></div>
    </div>
  )
}

function MyBookings() {
  const t = useT()
  const [rows, setRows] = useState(null)
  const [toast, setToast] = useState('')
  const [open, setOpen] = useState(null) // { id, kind: 'move' | 'rate' }
  const [enq, setEnq] = useState([])
  const [bill, setBill] = useState(null)
  const say = useCallback((m) => setToast(m), [])
  const load = useCallback(() => {
    api('GET', '/enquiries/mine').then(setEnq).catch(() => {})
    return api('GET', '/bookings/mine').then(setRows)
  }, [])
  useEffect(() => { load() }, [load])

  const cancel = async (id) => {
    if (!window.confirm(t('Cancel this booking?'))) return
    try {
      await api('PATCH', `/bookings/${id}/cancel`)
      setToast(t('Booking cancelled'))
      load()
    } catch (e) {
      setToast(e.message)
    }
  }
  const done = () => { setOpen(null); load() }
  const accept = async (e) => {
    if (!window.confirm(t('Accept the quote of {price} and book {date}?', { price: money(e.quote_price), date: nice(e.date) }))) return
    try {
      await api('POST', `/enquiries/${e.id}/accept`)
      setToast(t('Booked! See your booking below.'))
      load()
    } catch (x) { setToast(x.message) }
  }
  const ENQ = { new: t('Waiting for a quote'), quoted: t('Quote received'), confirmed: t('Booked'), declined: t('Declined') }

  return (
    <>
      <div className="page-head">
        <h1>{t('My bookings')}</h1>
        <p className="muted">{t('Your upcoming and past appointments.')}</p>
      </div>
      {enq.filter((e) => e.status !== 'confirmed').length > 0 && (
        <div className="stack" style={{ marginBottom: 20 }}>
          <h2>{t('My enquiries')}</h2>
          {enq.filter((e) => e.status !== 'confirmed').map((e) => (
            <div key={e.id} className="card booking-item">
              <div className="booking-main">
                <h3>{e.service_name} <span className={'badge ' + (e.status === 'quoted' ? 'no_show' : e.status === 'declined' ? 'cancelled' : 'booked')}>{ENQ[e.status]}</span></h3>
                <p className="muted small">For {nice(e.date)}{e.venue ? ` · ${e.venue}` : ''}{e.guests ? ` · ${e.guests} guests` : ''}</p>
                {e.status === 'quoted' && <p style={{ marginTop: 4 }}>{t('Quote:')} <b>{money(e.quote_price)}</b>{e.reply ? ` · ${e.reply}` : ''}</p>}
                {e.status === 'declined' && e.reply && <p className="small" style={{ marginTop: 4 }}>{e.reply}</p>}
              </div>
              {e.status === 'quoted' && <button className="btn sm" onClick={() => accept(e)}>{t('Accept quote')}</button>}
            </div>
          ))}
        </div>
      )}
      <div className="stack">
        {rows === null && <p className="muted">{t('Loading…')}</p>}
        {rows?.length === 0 && <div className="card empty">{t('You have no bookings yet.')}</div>}
        {rows?.map((b) => {
          const d = parseDate(b.date)
          const isOpen = open?.id === b.id
          return (
            <div key={b.id} className="card booking-item">
              <div className="booking-date">
                <small>{d.toLocaleDateString(dateLocale(), { month: 'short' })}</small>
                <b>{d.getDate()}</b>
              </div>
              <div className="booking-main">
                <h3>{b.service_name}{b.staff_name && <span className="muted small" style={{ fontWeight: 400 }}> · {t('with {name}', { name: b.staff_name })}</span>}</h3>
                <p className="muted small">{nice(b.date)} · {b.end_min - b.start_min >= 480 ? t('Full day') : `${time12(b.start)} – ${time12(b.end)}`} · {money(b.price)}{b.coupon_code && ` · ${b.coupon_code}`}</p>
                {b.venue && <p className="small" style={{ marginTop: 2 }}>📍 {b.venue}{b.guests ? ` · ${b.guests} guests` : ''}</p>}
                {b.note && <p className="small" style={{ marginTop: 4 }}>“{b.note}”</p>}
                {b.my_rating && <div className="rating-line"><Stars value={b.my_rating} size={16} /><span className="muted small">{t('Your review')}</span></div>}
              </div>
              <Badge status={b.status} />
              {b.status === 'booked' && (
                <div className="row wrap">
                  <button className="btn ghost sm" onClick={() => setOpen(isOpen && open.kind === 'move' ? null : { id: b.id, kind: 'move' })}>{t('Reschedule')}</button>
                  <button className="btn danger sm" onClick={() => cancel(b.id)}>{t('Cancel')}</button>
                </div>
              )}
              {b.invoice_id && <button className="btn ghost sm" onClick={() => setBill(b.invoice_id)}>{t('View bill')}</button>}
              {b.status === 'completed' && !b.my_rating && (
                <button className="btn ghost sm" onClick={() => setOpen(isOpen ? null : { id: b.id, kind: 'rate' })}>{t('Rate visit')}</button>
              )}
              {isOpen && open.kind === 'move' && <Reschedule b={b} onDone={done} onClose={() => setOpen(null)} toast={say} />}
              {isOpen && open.kind === 'rate' && <Rate b={b} onDone={done} toast={say} />}
            </div>
          )
        })}
      </div>
      {bill && <InvoiceView id={bill} toast={say} onClose={() => setBill(null)} />}
      <Toast msg={toast} onDone={() => setToast('')} />
    </>
  )
}

// what the customer owes, their package sessions and bills
function Wallet() {
  const t = useT()
  const { settings } = useSettings()
  const [w, setW] = useState(null)
  const [bill, setBill] = useState(null)
  const [toast, setToast] = useState('')
  const say = useCallback((m) => setToast(m), [])
  useEffect(() => { api('GET', '/me/wallet').then(setW).catch(() => setW(false)) }, [])
  if (w === null) return <p className="muted">{t('Loading…')}</p>
  if (w === false) return <div className="card empty">{t('Could not load your bills.')}</div>
  return (
    <>
      <div className="page-head"><h1>{t('Bills & packages')}</h1><p className="muted">{t('What you have paid for and what is left.')}</p></div>
      {w.due > 0 && <div className="card setup" style={{ marginBottom: 16 }}><b>{t('You owe {amount}', { amount: money(w.due) })}</b><div className="small">{settings.upi_id ? t('Please pay at the business or by UPI to {upi}.', { upi: settings.upi_id }) : t('Please pay at the business.')}</div></div>}
      {w.packages.length > 0 && (
        <div className="stack" style={{ marginBottom: 20 }}>
          <h2>{t('My packages')}</h2>
          {w.packages.map((p) => <div key={p.id} className="card row between"><div><b>{p.name}</b><div className="muted small">{t('valid until {date}', { date: nice(p.expires) })}</div></div><span className="badge completed">{t('{n} sessions left', { n: p.sessions_left })}</span></div>)}
        </div>
      )}
      <div className="stack">
        <h2>{t('My bills')}</h2>
        {w.invoices.length === 0 && <div className="card empty">{t('No bills yet.')}</div>}
        {w.invoices.map((i) => (
          <button key={i.id} className="card row between" style={{ textAlign: 'left', cursor: 'pointer', font: 'inherit', color: 'inherit' }} onClick={() => setBill(i.id)}>
            <div><b>{i.label}</b><div className="muted small">{i.created_at.slice(0, 10)}</div></div>
            <div style={{ textAlign: 'right' }}><b>{money(i.total)}</b>{i.due > 0.009 ? <div><span className="badge no_show">Due {money(i.due)}</span></div> : <div><span className="badge completed">{t('Paid')}</span></div>}</div>
          </button>
        ))}
      </div>
      {bill && <InvoiceView id={bill} toast={say} onClose={() => setBill(null)} />}
      <Toast msg={toast} onDone={() => setToast('')} />
    </>
  )
}

export default function Customer({ user, onLogout, onUser }) {
  const t = useT()
  const [tab, setTab] = useState('book')
  const [done, setDone] = useState(null)
  const [toast, setToast] = useState('')
  const { settings } = useSettings()
  const [next, setNext] = useState(null)
  useEffect(() => {
    if (tab !== 'book') return
    api('GET', '/bookings/mine').then((rows) => {
      const now = new Date()
      const ahead = rows.filter((b) => b.status === 'booked' && new Date(b.date + 'T' + b.start + ':00') > now)
      setNext(ahead.sort((x, y) => (x.date + x.start).localeCompare(y.date + y.start))[0] || null)
    }).catch(() => {})
  }, [tab, done])
  const say = useCallback((m) => setToast(m), [])
  return (
    <>
      <TopBar user={user} tab={tab} setTab={(t) => { setDone(null); setTab(t) }} onLogout={onLogout} showLang tabs={[['book', t('Book')], ['mine', t('My bookings')], ['wallet', t('Bills')], ['profile', t('Profile')]]} />
      <main className="container">
        {tab === 'book' && !done && next && (
          <div className="card next-appt">
            <div><small>{t('Your next appointment')}</small><b>{next.service_name}{next.staff_name && ` ${t('with {name}', { name: next.staff_name })}`}</b><span className="muted small">{nice(next.date)} · {time12(next.start)}</span></div>
            <button className="btn ghost sm" onClick={() => setTab('mine')}>{t('View')}</button>
          </div>
        )}
        {tab === 'book' && (done
          ? <Confirmation done={done} onView={() => { setDone(null); setTab('mine') }} onAgain={() => setDone(null)} />
          : <Book onBooked={setDone} onEnquiry={() => { setToast(t('Enquiry sent. We will reply with a quote.')); setTab('mine') }} />)}
        {tab === 'mine' && <MyBookings />}
        {tab === 'wallet' && <Wallet />}
        {tab === 'profile' && <Profile user={user} onUser={onUser} toast={say} />}
        {(settings.phone || settings.address) && (
          <p className="muted small" style={{ marginTop: 40, textAlign: 'center' }}>
            {settings.name}{settings.address && ` · ${settings.address}`}{settings.phone && ` · ${settings.phone}`}
          </p>
        )}
      </main>
      <Toast msg={toast} onDone={() => setToast('')} />
    </>
  )
}
