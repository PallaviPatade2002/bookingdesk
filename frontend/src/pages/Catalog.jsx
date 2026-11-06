import { useCallback, useEffect, useState } from 'react'
import { api } from '../api'
import { ImagePicker, Modal, SubTabs, money, useSettings } from '../ui'
import { Services } from './Manage'
import { InvoiceView, UpiQr } from './Billing'

const r2 = (n) => Math.round(n * 100) / 100

function Products({ toast }) {
  const [rows, setRows] = useState([])
  const empty = { name: '', price: '', stock: '' }
  const [f, setF] = useState(empty)
  const [editing, setEditing] = useState(null)
  const load = useCallback(() => api('GET', '/admin/products').then(setRows), [])
  useEffect(() => { load() }, [load])
  const save = async (e) => {
    e.preventDefault()
    const body = { name: f.name, price: Number(f.price), stock: Number(f.stock || 0) }
    try {
      editing ? await api('PUT', '/admin/products/' + editing, body) : await api('POST', '/admin/products', body)
      toast(editing ? 'Product updated' : 'Product added')
      setF(empty)
      setEditing(null)
      load()
    } catch (x) { toast(x.message) }
  }
  const remove = async (p) => {
    if (!window.confirm(`Delete ${p.name}? Products that were sold are hidden instead.`)) return
    const r = await api('DELETE', '/admin/products/' + p.id)
    toast(r.hidden ? 'It was sold before, so it is hidden now' : 'Product deleted')
    load()
  }
  return (
    <>
      <p className="muted" style={{ marginBottom: 14 }}>Things you sell at the counter. Stock goes down automatically when you sell them in a bill.</p>
      <form className="card form-card" onSubmit={save}>
        <div className="form-grid">
          <div className="full"><label>Product name</label><input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required maxLength={80} /></div>
          <div><label>Price (₹)</label><input type="number" min="0" step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} required /></div>
          <div><label>In stock</label><input type="number" min="0" step="1" value={f.stock} onChange={(e) => setF({ ...f, stock: e.target.value })} /></div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn">{editing ? 'Save changes' : 'Add product'}</button>
          {editing && <button type="button" className="btn ghost" onClick={() => { setEditing(null); setF(empty) }}>Cancel</button>}
        </div>
      </form>
      <div className="svc-list">
        {rows.length === 0 && <div className="card empty">No products yet.</div>}
        {rows.map((p) => (
          <div key={p.id} className="card svc-item">
            <div className="main"><b>{p.name}</b><div className="small">{money(p.price)}</div></div>
            <span className={'badge ' + (p.stock <= 3 ? 'no_show' : 'completed')}>{p.stock} in stock</span>
            <span className={'badge ' + (p.active ? 'completed' : 'cancelled')}>{p.active ? 'Visible' : 'Hidden'}</span>
            <div className="row wrap">
              <button className="btn ghost sm" onClick={() => { setEditing(p.id); setF({ name: p.name, price: p.price, stock: p.stock }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Edit</button>
              <button className="btn ghost sm" onClick={async () => { await api('PUT', '/admin/products/' + p.id, { active: !p.active }); load() }}>{p.active ? 'Hide' : 'Show'}</button>
              <button className="btn danger sm" onClick={() => remove(p)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
    </>
  )
}

// sell a package: bill the customer and give them the sessions
function SellPackage({ pkg, onClose, onDone, toast }) {
  const { settings } = useSettings()
  const pct = Number(settings.gst_percent) || 0
  const [customers, setCustomers] = useState([])
  const [userId, setUserId] = useState('')
  const [nc, setNc] = useState({ name: '', phone: '' })
  const [discount, setDiscount] = useState('')
  const [method, setMethod] = useState('cash')
  const [busy, setBusy] = useState(false)
  useEffect(() => { api('GET', '/admin/customers').then(setCustomers).catch(() => {}) }, [])
  const disc = Math.min(Number(discount) > 0 ? Number(discount) : 0, pkg.price)
  const total = r2((pkg.price - disc) * (1 + pct / 100))
  const save = async (e) => {
    e.preventDefault()
    setBusy(true)
    try {
      const body = { discount: disc, payments: method === 'later' ? [] : [{ method, amount: total }] }
      if (userId) body.user_id = Number(userId)
      else body.customer = nc
      onDone(await api('POST', `/admin/packages/${pkg.id}/sell`, body))
    } catch (x) { toast(x.message) } finally { setBusy(false) }
  }
  return (
    <Modal title={`Sell: ${pkg.name}`} onClose={onClose}>
      <form className="stack" onSubmit={save}>
        <div>
          <label>Customer</label>
          <select value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">New customer…</option>
            {customers.map((c) => <option key={c.id} value={c.id}>{c.name} · {c.phone}</option>)}
          </select>
        </div>
        {!userId && (
          <div className="row">
            <input placeholder="Name" value={nc.name} onChange={(e) => setNc({ ...nc, name: e.target.value })} required maxLength={80} />
            <input placeholder="Phone" inputMode="numeric" value={nc.phone} onChange={(e) => setNc({ ...nc, phone: e.target.value })} required maxLength={20} />
          </div>
        )}
        <div className="row wrap"><label className="co-f">Price ₹<input value={pkg.price} disabled /></label><label className="co-f">Discount ₹<input type="number" min="0" value={discount} onChange={(e) => setDiscount(e.target.value)} /></label></div>
        <div className="inv-totals"><div className="inv-total"><span>To pay{pct > 0 ? ` (incl. GST ${pct}%)` : ''}</span><b>{money(total)}</b></div></div>
        <div>
          <label>Paid by</label>
          <div className="chips">{[['cash', 'Cash'], ['upi', 'UPI'], ['card', 'Card'], ['later', 'Pay later']].map(([m, t]) => <button type="button" key={m} className={'chip' + (method === m ? ' on' : '')} onClick={() => setMethod(m)}>{t}</button>)}</div>
        </div>
        {method === 'upi' && <UpiQr upi={settings.upi_id} name={settings.name} amount={total} note={pkg.name} />}
        <button className="btn block" disabled={busy}>{busy ? 'Saving…' : 'Sell package'}</button>
      </form>
    </Modal>
  )
}

function Packages({ toast }) {
  const [rows, setRows] = useState([])
  const [services, setServices] = useState([])
  const empty = { name: '', description: '', price: '', sessions: 5, service_id: '', valid_days: 180 }
  const [f, setF] = useState(empty)
  const [editing, setEditing] = useState(null)
  const [selling, setSelling] = useState(null)
  const [bill, setBill] = useState(null)
  const load = useCallback(() => {
    api('GET', '/admin/packages').then(setRows)
    api('GET', '/services/all').then(setServices)
  }, [])
  useEffect(() => { load() }, [load])
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const save = async (e) => {
    e.preventDefault()
    const body = { ...f, price: Number(f.price), sessions: Number(f.sessions), valid_days: Number(f.valid_days), service_id: f.service_id ? Number(f.service_id) : null }
    try {
      editing ? await api('PUT', '/admin/packages/' + editing, body) : await api('POST', '/admin/packages', body)
      toast(editing ? 'Package updated' : 'Package added')
      setF(empty)
      setEditing(null)
      load()
    } catch (x) { toast(x.message) }
  }
  const remove = async (p) => {
    if (!window.confirm(`Delete ${p.name}? Packages that were sold are hidden instead.`)) return
    const r = await api('DELETE', '/admin/packages/' + p.id)
    toast(r.hidden ? 'Already sold, so it is hidden now' : 'Package deleted')
    load()
  }
  const svcName = (id) => services.find((s) => s.id === id)?.name
  return (
    <>
      <p className="muted" style={{ marginBottom: 14 }}>Sell a bundle of sessions (for example "Facial x5") at a lower price. Customers use a session each time they come; you see what is left.</p>
      <form className="card form-card" onSubmit={save}>
        <div className="form-grid">
          <div><label>Package name</label><input value={f.name} onChange={set('name')} required maxLength={80} placeholder="e.g. Facial x5" /></div>
          <div><label>Price (₹)</label><input type="number" min="0" value={f.price} onChange={set('price')} required /></div>
          <div className="full"><label>Description</label><input value={f.description || ''} onChange={set('description')} maxLength={300} /></div>
          <div><label>Number of sessions</label><input type="number" min="1" max="200" value={f.sessions} onChange={set('sessions')} required /></div>
          <div><label>Valid for (days)</label><input type="number" min="1" max="1825" value={f.valid_days} onChange={set('valid_days')} required /></div>
          <div className="full">
            <label>Which service</label>
            <select value={f.service_id || ''} onChange={set('service_id')}>
              <option value="">Any service</option>
              {services.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
        </div>
        <div className="row" style={{ marginTop: 14 }}>
          <button className="btn">{editing ? 'Save changes' : 'Add package'}</button>
          {editing && <button type="button" className="btn ghost" onClick={() => { setEditing(null); setF(empty) }}>Cancel</button>}
        </div>
      </form>
      <div className="svc-list">
        {rows.length === 0 && <div className="card empty">No packages yet.</div>}
        {rows.map((p) => (
          <div key={p.id} className="card svc-item">
            <div className="main">
              <b>{p.name}</b> <span className="badge">{p.sessions} sessions</span>
              <div className="muted small">{p.description}</div>
              <div className="small">{money(p.price)} · {p.service_id ? svcName(p.service_id) || 'one service' : 'any service'} · valid {p.valid_days} days · sold {p.sold}</div>
            </div>
            <span className={'badge ' + (p.active ? 'completed' : 'cancelled')}>{p.active ? 'On sale' : 'Hidden'}</span>
            <div className="row wrap">
              {p.active ? <button className="btn sm" onClick={() => setSelling(p)}>Sell</button> : null}
              <button className="btn ghost sm" onClick={() => { setEditing(p.id); setF({ name: p.name, description: p.description || '', price: p.price, sessions: p.sessions, service_id: p.service_id || '', valid_days: p.valid_days }); window.scrollTo({ top: 0, behavior: 'smooth' }) }}>Edit</button>
              <button className="btn ghost sm" onClick={async () => { await api('PUT', '/admin/packages/' + p.id, { active: !p.active }); load() }}>{p.active ? 'Hide' : 'Show'}</button>
              <button className="btn danger sm" onClick={() => remove(p)}>Delete</button>
            </div>
          </div>
        ))}
      </div>
      {selling && <SellPackage pkg={selling} toast={toast} onClose={() => setSelling(null)} onDone={(r) => { setSelling(null); load(); toast('Package sold'); setBill(r.id) }} />}
      {bill && <InvoiceView id={bill} admin onClose={() => setBill(null)} toast={toast} />}
    </>
  )
}

function Gallery({ toast }) {
  const [rows, setRows] = useState([])
  const [f, setF] = useState({ url: '', caption: '' })
  const load = useCallback(() => api('GET', '/gallery').then(setRows), [])
  useEffect(() => { load() }, [load])
  const add = async (e) => {
    e.preventDefault()
    try {
      await api('POST', '/admin/gallery', f)
      setF({ url: '', caption: '' })
      load()
    } catch (x) { toast(x.message) }
  }
  return (
    <>
      <p className="muted" style={{ marginBottom: 14 }}>Photos of your work, shown on your public page. Paste an image link (for example from Google Drive, Instagram or your website) or pick one of the sample photos.</p>
      <form className="card form-card" onSubmit={add}>
        <label>Photo</label>
        <ImagePicker value={f.url} onChange={(v) => setF({ ...f, url: v })} />
        <div style={{ marginTop: 12 }}><label>Caption (optional)</label><input value={f.caption} onChange={(e) => setF({ ...f, caption: e.target.value })} maxLength={100} /></div>
        <button className="btn" style={{ marginTop: 14 }} disabled={!f.url}>Add to gallery</button>
      </form>
      <div className="gallery-grid">
        {rows.length === 0 && <div className="card empty" style={{ gridColumn: '1 / -1' }}>No photos yet.</div>}
        {rows.map((g) => (
          <figure key={g.id} className="g-item">
            <img src={g.url} alt={g.caption || 'Our work'} loading="lazy" />
            {g.caption && <figcaption>{g.caption}</figcaption>}
            <button className="btn danger sm" onClick={async () => { await api('DELETE', '/admin/gallery/' + g.id); load() }}>Remove</button>
          </figure>
        ))}
      </div>
    </>
  )
}

export default function Catalog({ toast }) {
  const [tab, setTab] = useState('services')
  return (
    <>
      <div className="page-head"><h1>Catalog</h1><p className="muted">Everything you offer and sell.</p></div>
      <SubTabs value={tab} onChange={setTab} items={[['services', 'Services'], ['products', 'Products'], ['packages', 'Packages'], ['gallery', 'Gallery']]} />
      {tab === 'services' && <Services toast={toast} embedded />}
      {tab === 'products' && <Products toast={toast} />}
      {tab === 'packages' && <Packages toast={toast} />}
      {tab === 'gallery' && <Gallery toast={toast} />}
    </>
  )
}
