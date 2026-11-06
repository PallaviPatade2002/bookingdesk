import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { money, nice, useLabel, waLink } from '../ui'

const LABEL = { new: ['New', 'booked'], quoted: ['Quote sent', 'no_show'], confirmed: ['Booked', 'completed'], declined: ['Declined', 'cancelled'] }

// Owner side of "quote" services: read the enquiry, send a price, book it
export default function Enquiries({ toast, onCount }) {
  const L = useLabel()
  const [rows, setRows] = useState(null)
  const [staff, setStaff] = useState([])
  const [open, setOpen] = useState(null)
  const [f, setF] = useState({ price: '', reply: '', staff_id: '' })
  const load = useCallback(() => api('GET', '/admin/enquiries').then((r) => { setRows(r); onCount?.(r.filter((e) => e.status === 'new').length) }).catch((e) => toast(e.message)), [toast, onCount])
  useEffect(() => { load(); api('GET', '/admin/staff').then((r) => setStaff(r.filter((s) => s.active))).catch(() => {}) }, [load])

  const act = async (fn, ok) => {
    try {
      await fn()
      toast(ok)
      setOpen(null)
      load()
    } catch (x) { toast(x.message) }
  }
  const quote = (e) => act(() => api('PATCH', `/admin/enquiries/${e.id}`, { status: 'quoted', quote_price: Number(f.price), reply: f.reply }), 'Quote sent to the customer')
  const decline = (e) => act(() => api('PATCH', `/admin/enquiries/${e.id}`, { status: 'declined', reply: f.reply }), 'Declined')
  const book = (e) => act(() => api('POST', `/admin/enquiries/${e.id}/book`, { price: f.price !== '' ? Number(f.price) : undefined, staff_id: f.staff_id ? Number(f.staff_id) : undefined }), 'Booked for the whole day')
  const start = (e) => { setOpen(open === e.id ? null : e.id); setF({ price: e.quote_price ?? '', reply: e.reply || '', staff_id: '' }) }

  return (
    <>
      <p className="muted" style={{ marginBottom: 14 }}>Customers send an enquiry for jobs priced by quote (decoration, wedding shoot...). Reply with a price; when they accept, the whole day is booked.</p>
      <div className="svc-list">
        {rows === null && <p className="muted">Loading…</p>}
        {rows && rows.length === 0 && <div className="card empty">No enquiries yet. Add a service with "Quote request" in Catalog to start receiving them.</div>}
        {(rows || []).map((e) => (
          <div key={e.id} className="card svc-item">
            <div className="main">
              <b>{e.service_name}</b> <span className={'badge ' + LABEL[e.status][1]}>{LABEL[e.status][0]}</span>
              <div className="small">{e.customer_name} · {e.customer_phone} · for <b>{nice(e.date)}</b>{e.guests ? ` · ${e.guests} guests` : ''}</div>
              {e.venue && <div className="small muted">Venue: {e.venue}</div>}
              {e.details && <div className="small">“{e.details}”</div>}
              {e.quote_price != null && <div className="small">Quote: <b>{money(e.quote_price)}</b>{e.reply ? ` · ${e.reply}` : ''}</div>}
            </div>
            <div className="row wrap">
              <a className="btn ghost sm" href={waLink(`Hi ${e.customer_name.split(' ')[0]}, about your enquiry for ${e.service_name} on ${nice(e.date)}: `, e.customer_phone)} target="_blank" rel="noreferrer">WhatsApp</a>
              {(e.status === 'new' || e.status === 'quoted') && <button className="btn sm" onClick={() => start(e)}>{open === e.id ? 'Close' : e.status === 'new' ? 'Reply' : 'Edit'}</button>}
            </div>
            {open === e.id && (
              <div className="panel stack">
                <div className="row wrap">
                  <label className="co-f">Price ₹<input type="number" min="0" value={f.price} onChange={(x) => setF({ ...f, price: x.target.value })} /></label>
                  {staff.length > 0 && <label className="co-f wide">{L.one} for the day<select value={f.staff_id} onChange={(x) => setF({ ...f, staff_id: x.target.value })}><option value="">Not assigned</option>{staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
                </div>
                <div><label>Message to the customer (optional)</label><input value={f.reply} onChange={(x) => setF({ ...f, reply: x.target.value })} maxLength={300} placeholder="What the price includes" /></div>
                <div className="row wrap">
                  <button className="btn sm" disabled={f.price === ''} onClick={() => quote(e)}>Send quote</button>
                  <button className="btn success sm" disabled={f.price === '' && e.quote_price == null} onClick={() => book(e)}>Book now</button>
                  <button className="btn danger sm" onClick={() => decline(e)}>Decline</button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
    </>
  )
}
