import { useCallback, useEffect, useMemo, useState } from 'react'
import QRCode from 'qrcode'
import { api } from '../api'
import { Modal, money, nice, useLabel, useSettings, waLink } from '../ui'

const r2 = (n) => Math.round(n * 100) / 100
const num = (v) => (Number(v) > 0 ? Number(v) : 0)
let keySeed = 1

// UPI QR: any UPI app can scan this and pay the exact amount to the business
export function UpiQr({ upi, name, amount, note }) {
  const [src, setSrc] = useState('')
  useEffect(() => {
    if (!upi || !(amount > 0)) return
    const link = `upi://pay?pa=${encodeURIComponent(upi)}&pn=${encodeURIComponent(name || '')}&am=${amount.toFixed(2)}&cu=INR&tn=${encodeURIComponent(note || 'Payment')}`
    QRCode.toDataURL(link, { margin: 1, width: 220 }).then(setSrc).catch(() => setSrc(''))
  }, [upi, name, amount, note])
  if (!upi || !(amount > 0) || !src) return null
  return (
    <div className="upi-qr">
      <img src={src} alt={`UPI QR code to pay ${amount}`} width="170" height="170" />
      <div><b>Scan to pay {money(amount)}</b><div className="muted small">{upi}</div></div>
    </div>
  )
}

// ---------- receive a payment against what a customer owes ----------
export function Receive({ customer, invoiceId, due, onClose, onDone, toast }) {
  const { settings } = useSettings()
  const [amount, setAmount] = useState(String(due))
  const [method, setMethod] = useState('cash')
  const [busy, setBusy] = useState(false)
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const url = invoiceId ? `/admin/invoices/${invoiceId}/payments` : `/admin/customers/${customer.id}/payments`
      const r = await api('POST', url, { amount: Number(amount), method })
      toast(r.due_left > 0 ? `Received. ${money(r.due_left)} still due` : 'Received. Nothing is due now')
      onDone()
    } catch (x) {
      toast(x.message)
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal title="Receive payment" onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <p>{customer.name} owes <b>{money(due)}</b>.</p>
        <div><label>Amount received (₹)</label><input type="number" min="1" max={due} step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} required /></div>
        <div>
          <label>Paid by</label>
          <div className="chips">{['cash', 'upi', 'card'].map((m) => <button type="button" key={m} className={'chip' + (method === m ? ' on' : '')} onClick={() => setMethod(m)}>{m.toUpperCase()}</button>)}</div>
        </div>
        {method === 'upi' && <UpiQr upi={settings.upi_id} name={settings.name} amount={num(amount)} note="Dues" />}
        {method === 'upi' && !settings.upi_id && <p className="muted small">Add your UPI ID in Settings to show a QR code here.</p>}
        <button className="btn block" disabled={busy || !(num(amount) > 0)}>{busy ? 'Saving…' : 'Save payment'}</button>
      </form>
    </Modal>
  )
}

// ---------- a bill: printable, shareable ----------
export function InvoiceView({ id, onClose, onChanged, toast, admin }) {
  const { settings } = useSettings()
  const [inv, setInv] = useState(null)
  const [receiving, setReceiving] = useState(false)
  const load = useCallback(() => api('GET', '/invoices/' + id).then(setInv).catch((e) => toast(e.message)), [id, toast])
  useEffect(() => { load() }, [load])
  if (!inv) return <Modal title="Bill" onClose={onClose}><p className="muted">Loading…</p></Modal>

  const b = inv.business
  const lines = inv.items.map((i) => `${i.name} x${i.qty} ${money(i.price * i.qty)}`).join(', ')
  const share = `${b.name}: bill ${inv.label} for ${inv.customer.name}. ${lines}. Total ${money(inv.total)}${inv.due > 0 ? `, ${money(inv.due)} due` : ', paid'}.`
  const when = inv.created_at.slice(0, 10)
  return (
    <Modal title={`Bill ${inv.label}`} onClose={onClose}>
      <div className="invoice-sheet">
        <div className="inv-head">
          <div><b className="inv-name">{b.name}</b>{(b.address || b.city) && <div className="small">{[b.address, b.city].filter(Boolean).join(', ')}</div>}{b.phone && <div className="small">Phone {b.phone}</div>}{b.gst_number && <div className="small">GSTIN {b.gst_number}</div>}</div>
          <div className="inv-meta"><b>{inv.label}</b><div className="small">{nice(when)}</div></div>
        </div>
        <div className="small" style={{ margin: '12px 0' }}>Billed to <b>{inv.customer.name}</b> · {inv.customer.phone}</div>
        <table className="inv-table">
          <thead><tr><th>Item</th><th>Qty</th><th>Price</th><th>Amount</th></tr></thead>
          <tbody>
            {inv.items.map((i) => (
              <tr key={i.id}><td>{i.name}{i.staff_name && <div className="small muted">{i.staff_name}</div>}</td><td>{i.qty}</td><td>{money(i.price)}</td><td>{money(i.price * i.qty)}</td></tr>
            ))}
          </tbody>
        </table>
        <div className="inv-totals">
          <div><span>Subtotal</span><b>{money(inv.subtotal)}</b></div>
          {inv.discount > 0 && <div><span>Discount</span><b>-{money(inv.discount)}</b></div>}
          {inv.tax > 0 && <div><span>GST {inv.tax_percent}%</span><b>{money(inv.tax)}</b></div>}
          {inv.tip > 0 && <div><span>Tip</span><b>{money(inv.tip)}</b></div>}
          <div className="inv-total"><span>Total</span><b>{money(inv.total)}</b></div>
          {inv.payments.map((p, i) => <div key={i} className="small"><span>Paid by {p.method}</span><b>{money(p.amount)}</b></div>)}
          <div className={inv.due > 0 ? 'inv-due' : 'inv-paid'}><span>{inv.due > 0 ? 'Balance due' : 'Paid in full'}</span><b>{inv.due > 0 ? money(inv.due) : '✓'}</b></div>
        </div>
        {b.footer && <p className="small muted" style={{ marginTop: 14, textAlign: 'center' }}>{b.footer}</p>}
      </div>

      {inv.due > 0 && <UpiQr upi={b.upi_id} name={b.name} amount={inv.due} note={inv.label} />}
      <div className="row wrap no-print" style={{ marginTop: 14 }}>
        <button className="btn ghost sm" onClick={() => window.print()}>Print / Save as PDF</button>
        <a className="btn ghost sm" href={waLink(share, admin ? inv.customer.phone : settings.whatsapp || '')} target="_blank" rel="noreferrer">{admin ? 'Send on WhatsApp' : 'Share'}</a>
        {admin && inv.due > 0 && <button className="btn sm" onClick={() => setReceiving(true)}>Receive payment</button>}
      </div>
      {receiving && (
        <Receive customer={inv.customer} invoiceId={inv.id} due={inv.due} toast={toast} onClose={() => setReceiving(false)} onDone={() => { setReceiving(false); load(); onChanged?.() }} />
      )}
    </Modal>
  )
}

// ---------- take payment: for a booking, or a walk-in sale ----------
export function Checkout({ booking, customer: fixedCustomer, onClose, onDone, toast }) {
  const { settings } = useSettings()
  const L = useLabel()
  const pct = Number(settings.gst_percent) || 0
  const [customers, setCustomers] = useState([])
  const [products, setProducts] = useState([])
  const [services, setServices] = useState([])
  const [staff, setStaff] = useState([])
  const [userId, setUserId] = useState(booking ? booking.user_id : fixedCustomer?.id || '')
  const [newCust, setNewCust] = useState({ name: '', phone: '' })
  const [packages, setPackages] = useState([])
  const [items, setItems] = useState(() =>
    booking ? [{ key: keySeed++, kind: 'service', ref_id: booking.service_id, name: booking.service_name, price: booking.price, qty: 1, staff_id: booking.staff_id || '' }] : []
  )
  const [discount, setDiscount] = useState('')
  const [tip, setTip] = useState('')
  const [pay, setPay] = useState({ cash: '', upi: '', card: '' })
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api('GET', '/admin/products').then((r) => setProducts(r.filter((p) => p.active))).catch(() => {})
    api('GET', '/services').then(setServices).catch(() => {})
    api('GET', '/admin/staff').then((r) => setStaff(r.filter((s) => s.active))).catch(() => {})
    if (!booking && !fixedCustomer) api('GET', '/admin/customers').then(setCustomers).catch(() => {})
  }, [booking, fixedCustomer])
  useEffect(() => {
    if (!userId) { setPackages([]); return }
    api('GET', `/admin/customers/${userId}/account`).then((r) => setPackages(r.packages)).catch(() => setPackages([]))
  }, [userId])

  const set = (key, patch) => setItems((list) => list.map((i) => (i.key === key ? { ...i, ...patch } : i)))
  const sub = r2(items.reduce((s, i) => s + num(i.price) * (Number(i.qty) || 1), 0))
  const disc = Math.min(num(discount), sub)
  const tax = r2(((sub - disc) * pct) / 100)
  const total = r2(sub - disc + tax + num(tip))
  const covered = r2(Math.min(total, items.filter((i) => i.customer_package_id).reduce((s, i) => s + num(i.price) * (1 + pct / 100), 0)))
  const payable = r2(total - covered)
  const paid = r2(num(pay.cash) + num(pay.upi) + num(pay.card))
  const due = r2(payable - paid)
  const fullBy = (m) => setPay({ cash: '', upi: '', card: '', [m]: String(payable) })

  const addProduct = (id) => {
    const p = products.find((x) => String(x.id) === String(id))
    if (p) setItems((l) => [...l, { key: keySeed++, kind: 'product', ref_id: p.id, name: p.name, price: p.price, qty: 1 }])
  }
  const addService = (id) => {
    const s = services.find((x) => String(x.id) === String(id))
    if (s) setItems((l) => [...l, { key: keySeed++, kind: 'service', ref_id: s.id, name: s.name, price: s.price, qty: 1, staff_id: '' }])
  }
  const matching = (it) => packages.filter((p) => !p.service_id || p.service_id === it.ref_id)

  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const body = {
        items: items.map((i) => ({ kind: i.kind, ref_id: i.ref_id, name: i.name, price: Number(i.price), qty: Number(i.qty) || 1, staff_id: i.staff_id ? Number(i.staff_id) : undefined, customer_package_id: i.customer_package_id ? Number(i.customer_package_id) : undefined })),
        discount: disc, tip: num(tip),
        payments: ['cash', 'upi', 'card'].filter((m) => num(pay[m]) > 0).map((m) => ({ method: m, amount: num(pay[m]) })),
      }
      if (booking) body.booking_id = booking.id
      else if (userId) body.user_id = Number(userId)
      else body.customer = newCust
      onDone(await api('POST', '/admin/checkout', body))
    } catch (x) {
      toast(x.message)
    } finally {
      setBusy(false)
    }
  }

  const who = booking ? booking.customer_name : fixedCustomer?.name
  const canSave = items.length > 0 && (booking || userId || (newCust.name && newCust.phone)) && due >= -0.009
  return (
    <Modal title={booking ? 'Take payment' : 'New sale'} onClose={onClose}>
      <form className="stack" onSubmit={submit}>
        {who ? <p>Customer: <b>{who}</b></p> : (
          <div className="stack" style={{ gap: 8 }}>
            <label>Customer</label>
            <select value={userId} onChange={(e) => setUserId(e.target.value)}>
              <option value="">New customer…</option>
              {customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
            </select>
            {!userId && (
              <div className="row">
                <input placeholder="Name" value={newCust.name} onChange={(e) => setNewCust({ ...newCust, name: e.target.value })} maxLength={80} />
                <input placeholder="Phone" inputMode="numeric" value={newCust.phone} onChange={(e) => setNewCust({ ...newCust, phone: e.target.value })} maxLength={20} />
              </div>
            )}
          </div>
        )}

        <div className="stack" style={{ gap: 8 }}>
          {items.map((i) => (
            <div key={i.key} className="co-item">
              <div className="row between">
                <input value={i.name} onChange={(e) => set(i.key, { name: e.target.value })} aria-label="Item" />
                <button type="button" className="btn ghost sm" onClick={() => setItems((l) => l.filter((x) => x.key !== i.key))} aria-label="Remove item">✕</button>
              </div>
              <div className="row wrap">
                <label className="co-f">Qty<input type="number" min="1" max="100" value={i.qty} onChange={(e) => set(i.key, { qty: e.target.value })} /></label>
                <label className="co-f">Price ₹<input type="number" min="0" step="0.01" value={i.price} onChange={(e) => set(i.key, { price: e.target.value })} /></label>
                {i.kind === 'service' && staff.length > 0 && (
                  <label className="co-f wide">{L.one}
                    <select value={i.staff_id || ''} onChange={(e) => set(i.key, { staff_id: e.target.value })}>
                      <option value="">None</option>
                      {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select>
                  </label>
                )}
                {i.kind === 'service' && matching(i).length > 0 && (
                  <label className="co-f wide">Package session
                    <select value={i.customer_package_id || ''} onChange={(e) => set(i.key, { customer_package_id: e.target.value, qty: e.target.value ? 1 : i.qty })}>
                      <option value="">Pay normally</option>
                      {matching(i).map((p) => <option key={p.id} value={p.id}>{p.name} ({p.sessions_left} left)</option>)}
                    </select>
                  </label>
                )}
              </div>
            </div>
          ))}
          <div className="row wrap">
            <select value="" onChange={(e) => addService(e.target.value)} aria-label="Add a service"><option value="">+ Add service</option>{services.map((s) => <option key={s.id} value={s.id}>{s.name} · {money(s.price)}</option>)}</select>
            <select value="" onChange={(e) => addProduct(e.target.value)} aria-label="Add a product"><option value="">+ Add product</option>{products.map((p) => <option key={p.id} value={p.id} disabled={p.stock < 1}>{p.name} · {money(p.price)} ({p.stock} in stock)</option>)}</select>
            <button type="button" className="btn ghost sm" onClick={() => setItems((l) => [...l, { key: keySeed++, kind: 'custom', name: '', price: '', qty: 1 }])}>+ Other</button>
          </div>
        </div>

        <div className="row wrap">
          <label className="co-f">Discount ₹<input type="number" min="0" step="0.01" value={discount} onChange={(e) => setDiscount(e.target.value)} /></label>
          <label className="co-f">Tip ₹<input type="number" min="0" step="0.01" value={tip} onChange={(e) => setTip(e.target.value)} /></label>
        </div>

        <div className="inv-totals">
          <div><span>Subtotal</span><b>{money(sub)}</b></div>
          {disc > 0 && <div><span>Discount</span><b>-{money(disc)}</b></div>}
          {pct > 0 && <div><span>GST {pct}%</span><b>{money(tax)}</b></div>}
          {num(tip) > 0 && <div><span>Tip</span><b>{money(num(tip))}</b></div>}
          <div className="inv-total"><span>Total</span><b>{money(total)}</b></div>
          {covered > 0 && <div className="small"><span>Covered by package</span><b>-{money(covered)}</b></div>}
        </div>

        {payable > 0 && (
          <div className="stack" style={{ gap: 8 }}>
            <div className="row between wrap"><b>Payment received</b>
              <span className="row" style={{ gap: 6 }}>{['cash', 'upi', 'card'].map((m) => <button type="button" key={m} className="chip" onClick={() => fullBy(m)}>All {m.toUpperCase()}</button>)}</span>
            </div>
            <div className="row wrap">
              {['cash', 'upi', 'card'].map((m) => <label key={m} className="co-f">{m.toUpperCase()} ₹<input type="number" min="0" step="0.01" value={pay[m]} onChange={(e) => setPay({ ...pay, [m]: e.target.value })} /></label>)}
            </div>
            {due > 0.009 && <p className="small" style={{ color: 'var(--warn)' }}>{money(due)} will be written in the customer's account as due (khata).</p>}
            {due < -0.009 && <p className="error">Payment is more than the bill.</p>}
            <UpiQr upi={settings.upi_id} name={settings.name} amount={num(pay.upi)} note="Bill" />
          </div>
        )}
        <button className="btn block" disabled={busy || !canSave}>{busy ? 'Saving…' : due > 0.009 ? `Save bill (${money(due)} due)` : 'Save bill'}</button>
      </form>
    </Modal>
  )
}

// ---------- the Sales page ----------
export function Sales({ toast }) {
  const [rows, setRows] = useState(null)
  const [q, setQ] = useState('')
  const [onlyDue, setOnlyDue] = useState(false)
  const [open, setOpen] = useState(null)
  const [selling, setSelling] = useState(false)
  const load = useCallback(() => api('GET', '/admin/invoices' + (onlyDue ? '?status=due' : '')).then(setRows).catch((e) => toast(e.message)), [onlyDue, toast])
  useEffect(() => { load() }, [load])

  const shown = useMemo(() => (rows || []).filter((r) => (r.label + r.customer_name + r.customer_phone).toLowerCase().includes(q.toLowerCase())), [rows, q])
  const total = shown.reduce((s, r) => s + r.total, 0)
  const due = shown.reduce((s, r) => s + Math.max(0, r.due), 0)

  return (
    <>
      <div className="page-head row between wrap">
        <div><h1>Sales</h1><p className="muted">Bills, payments and what customers owe you.</p></div>
        <button className="btn" onClick={() => setSelling(true)}>+ New sale</button>
      </div>
      <div className="grid cols-4 stats" style={{ marginBottom: 14 }}>
        <div className="card stat"><b>{shown.length}</b><span>Bills shown</span></div>
        <div className="card stat"><b>{money(total)}</b><span>Billed</span></div>
        <div className="card stat"><b>{money(due)}</b><span>Still due</span></div>
        <div className="card stat"><b>{money(total - due)}</b><span>Received</span></div>
      </div>
      <div className="row wrap" style={{ marginBottom: 12 }}>
        <input placeholder="Search bill number, name or phone" value={q} onChange={(e) => setQ(e.target.value)} style={{ maxWidth: 300 }} />
        <button className={'chip' + (!onlyDue ? ' on' : '')} onClick={() => setOnlyDue(false)}>All</button>
        <button className={'chip' + (onlyDue ? ' on' : '')} onClick={() => setOnlyDue(true)}>Due only</button>
      </div>
      <div className="card table-wrap" style={{ padding: 0 }}>
        {rows === null ? <p className="muted" style={{ padding: 20 }}>Loading…</p> : shown.length === 0 ? <div className="empty">No bills yet. Take payment from an appointment, or start a new sale.</div> : (
          <table>
            <thead><tr><th>Bill</th><th>Date</th><th>Customer</th><th>Total</th><th>Status</th></tr></thead>
            <tbody>
              {shown.map((r) => (
                <tr key={r.id} onClick={() => setOpen(r.id)} style={{ cursor: 'pointer' }}>
                  <td><b>{r.label}</b></td>
                  <td>{r.created_at.slice(0, 10)}</td>
                  <td>{r.customer_name}<div className="muted small">{r.customer_phone}</div></td>
                  <td>{money(r.total)}</td>
                  <td>{r.due > 0.009 ? <span className="badge no_show">Due {money(r.due)}</span> : <span className="badge completed">Paid</span>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
      {open && <InvoiceView id={open} admin onClose={() => setOpen(null)} onChanged={load} toast={toast} />}
      {selling && <Checkout onClose={() => setSelling(false)} toast={toast} onDone={(inv) => { setSelling(false); load(); toast(`Bill ${inv.label} saved`); setOpen(inv.id) }} />}
    </>
  )
}
