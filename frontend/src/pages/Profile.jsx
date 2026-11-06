import { useEffect, useState } from 'react'
import { api } from '../api'
import { LangSwitcher, useT } from '../i18n'

export default function Profile({ user, onUser, toast }) {
  const t = useT()
  const [name, setName] = useState(user.name)
  const [birthday, setBirthday] = useState(user.birthday || '')
  const [optout, setOptout] = useState(!!user.optout)
  const [pw, setPw] = useState({ current: '', next: '' })
  useEffect(() => {
    api('GET', '/auth/me').then((u) => { setBirthday(u.birthday || ''); setOptout(!!u.optout) }).catch(() => {})
  }, [])

  const saveName = async (e) => {
    e.preventDefault()
    try {
      const r = await api('PUT', '/auth/profile', { name, birthday, optout })
      onUser({ ...user, name: r.name, birthday: r.birthday, optout: r.optout })
      toast('Profile saved')
    } catch (x) {
      toast(x.message)
    }
  }
  const savePw = async (e) => {
    e.preventDefault()
    try {
      await api('PUT', '/auth/password', pw)
      setPw({ current: '', next: '' })
      toast('Password changed')
    } catch (x) {
      toast(x.message)
    }
  }

  return (
    <>
      <div className="page-head"><h1>{t('My profile')}</h1><p className="muted">{t('Your details and password.')}</p></div>
      <div className="grid cols-2" style={{ alignItems: 'start' }}>
        <form className="card stack" onSubmit={saveName}>
          <h2>{t('Details')}</h2>
          <div><label>{t('Name')}</label><input value={name} onChange={(e) => setName(e.target.value)} required maxLength={80} /></div>
          <div><label>{t('Phone')}</label><input value={user.phone || ''} disabled /></div>
          <div><label>{t('Birthday (optional)')}</label><input type="date" value={birthday} onChange={(e) => setBirthday(e.target.value)} /></div>
          <label className="check" style={{ borderRadius: 12 }}><input type="checkbox" checked={optout} onChange={(e) => setOptout(e.target.checked)} /> {t('Do not send me offers')}</label>
          <div><label>{t('Language')}</label><LangSwitcher /></div>
          <button className="btn">{t('Save')}</button>
        </form>
        <form className="card stack" onSubmit={savePw}>
          <h2>{t('Change password')}</h2>
          <div><label>{t('Current password')}</label><input type="password" value={pw.current} onChange={(e) => setPw({ ...pw, current: e.target.value })} required /></div>
          <div><label>{t('New password')}</label><input type="password" value={pw.next} onChange={(e) => setPw({ ...pw, next: e.target.value })} minLength={6} required /></div>
          <button className="btn">{t('Change password')}</button>
        </form>
      </div>
    </>
  )
}
