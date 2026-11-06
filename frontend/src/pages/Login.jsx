import { useState } from 'react'
import { SLUG, api } from '../api'
import { DEMO_SLUG, TYPE_TAG } from '../config'
import { BrandName, useSettings } from '../ui'
import { LangSwitcher, useT } from '../i18n'

export default function Login({ onAuth, initialMode = 'login', onBack }) {
  const t = useT()
  const { settings } = useSettings()
  const [mode, setMode] = useState(initialMode)
  const [f, setF] = useState({ name: '', phone: '', password: '' })
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [step, setStep] = useState(1) // forgot password: 1 = ask for a code, 2 = enter it
  const [code, setCode] = useState('')
  const [info, setInfo] = useState('')
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value })
  const go = (m) => { setMode(m); setErr(''); setInfo(''); setStep(1); setCode('') }

  const demo = async (phone) => {
    setErr('')
    setBusy(true)
    try {
      onAuth(await api('POST', '/auth/login', { phone, password: '123456' }))
    } catch (x) {
      setErr(x.message)
    } finally {
      setBusy(false)
    }
  }

  const submit = async (e) => {
    e.preventDefault()
    setErr('')
    setBusy(true)
    try {
      if (mode === 'forgot') {
        if (step === 1) {
          const r = await api('POST', '/auth/forgot', { phone: f.phone })
          setInfo(r.dev_code ? `${r.message} Test mode: your code is ${r.dev_code}.` : r.message)
          if (r.dev_code) setCode(r.dev_code)
          setStep(2)
        } else {
          await api('POST', '/auth/reset', { phone: f.phone, code, password: f.password })
          setF({ ...f, password: '' })
          go('login')
          setInfo(t('Password changed. You can log in now.'))
        }
        return
      }
      const body = mode === 'login' ? { phone: f.phone, password: f.password } : f
      onAuth(await api('POST', '/auth/' + mode, body))
    } catch (x) {
      setErr(x.message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="auth-wrap">
      <section className={'auth-hero' + (settings.type === 'beauty' ? ' photo' : '')}>
        {onBack && <button type="button" className="btn ghost sm" onClick={onBack} style={{ alignSelf: 'flex-start', color: '#fff', borderColor: 'rgba(255,255,255,.4)' }}>{t('← Back to home')}</button>}
        <div className="brand">
          <div className="brand-mark" style={{ background: 'rgba(255,255,255,0.18)' }}>✿</div> <BrandName />
        </div>
        <div><LangSwitcher light /></div>
        <div>
          <div className="hero-note">{t(TYPE_TAG[settings.type] || 'Book online · Quick · Easy')}</div>
          <h1>{settings.tagline || 'Book your appointment online.'}</h1>
          <p>{t('Pick a service, choose a time that suits you and you are done. No calls, no waiting.')}</p>
          <ul className="feature-list">
            <li><span>✓</span> {t('Live available time slots')}</li>
            <li><span>✓</span> {t('No double bookings, ever')}</li>
            <li><span>✓</span> {t('Cancel any time from your phone')}</li>
          </ul>
        </div>
        <p className="small" style={{ margin: 0 }}>© {settings.name}</p>
      </section>

      <section className="auth-form">
        <form className="card auth-card stack" onSubmit={submit}>
          <div>
            <h2>{mode === 'login' ? t('Welcome back') : mode === 'forgot' ? t('Reset your password') : t('Create your account')}</h2>
            <p className="muted small" style={{ marginTop: 4 }}>
              {mode === 'login' ? t('Login to manage your bookings.') : mode === 'forgot' ? (step === 1 ? t('We will send a code to your phone.') : t('Enter the code and choose a new password.')) : t('It takes less than a minute.')}
            </p>
          </div>
          {mode !== 'forgot' && (
            <div className="tabs">
              <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => go('login')}>{t('Login')}</button>
              <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => go('register')}>{t('Sign up')}</button>
            </div>
          )}
          {info && <div className="notice">{info}</div>}
          {mode === 'register' && (
            <div>
              <label>{t('Full name')}</label>
              <input value={f.name} onChange={set('name')} placeholder={t('Your name')} required />
            </div>
          )}
          <div>
            <label>{t('Phone number')}</label>
            <input value={f.phone} onChange={set('phone')} placeholder={t('10-digit mobile')} inputMode="numeric" required />
          </div>
          {mode === 'forgot' && step === 2 && (
            <div>
              <label>{t('Code from the message')}</label>
              <input value={code} onChange={(e) => setCode(e.target.value)} inputMode="numeric" maxLength={6} placeholder={t('6 digits')} required />
            </div>
          )}
          {(mode !== 'forgot' || step === 2) && (
            <div>
              <label>{mode === 'forgot' ? t('New password') : t('Password')}</label>
              <input type="password" value={f.password} onChange={set('password')} placeholder={t('Min 6 characters')} minLength={6} required />
            </div>
          )}
          {err && <div className="error">{err}</div>}
          <button className="btn block" disabled={busy}>{busy ? t('Please wait…') : mode === 'login' ? t('Login') : mode === 'forgot' ? (step === 1 ? t('Send code') : t('Change password')) : t('Create account')}</button>
          {mode === 'login' && <button type="button" className="linkbtn" onClick={() => go('forgot')}>{t('Forgot password?')}</button>}
          {mode === 'forgot' && <button type="button" className="linkbtn" onClick={() => go('login')}>{t('Back to login')}</button>}
          {SLUG === DEMO_SLUG && <div className="demo">
            <b>{t('Try the demo')}</b> {t('(no sign-up needed)')}
            <div className="row" style={{ marginTop: 8 }}>
              <button type="button" className="btn ghost sm" disabled={busy} onClick={() => demo('9000000003')}>{t('Customer')}</button>
              <button type="button" className="btn ghost sm" disabled={busy} onClick={() => demo('9000000001')}>{t('Owner')}</button>
              <button type="button" className="btn ghost sm" disabled={busy} onClick={() => demo('9000000021')}>{t('Team member')}</button>
            </div>
          </div>}
        </form>
      </section>
    </div>
  )
}
