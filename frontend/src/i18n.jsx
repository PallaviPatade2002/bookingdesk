import { createContext, useContext, useMemo, useState } from 'react'
import mr from './locales/mr'
import hi from './locales/hi'
import { setLocaleLang } from './ui-locale'

// Languages for the customer-facing screens. Texts are written in English in the code and looked up
// here; anything without a translation is shown in English, so a missing word never breaks a screen.
export const LANGS = [['en', 'English'], ['mr', 'मराठी'], ['hi', 'हिन्दी']]
const DICT = { mr, hi }
const KEY = 'lang'

export const makeT = (lang) => (text, vars) => {
  let out = (lang !== 'en' && DICT[lang]?.[text]) || text
  if (vars) for (const [k, v] of Object.entries(vars)) out = out.split('{' + k + '}').join(String(v))
  return out
}

const english = { lang: 'en', setLang: () => {}, t: makeT('en') }
const I18nCtx = createContext(english)
export const useT = () => useContext(I18nCtx).t
export const useLang = () => useContext(I18nCtx)

function stored() {
  try {
    const v = localStorage.getItem(KEY)
    return LANGS.some(([k]) => k === v) ? v : null
  } catch {
    return null
  }
}
const fromBrowser = () => {
  const l = (navigator.language || 'en').slice(0, 2)
  return l === 'mr' || l === 'hi' ? l : null
}

// fixed = true keeps the owner and team screens in English
export function LangProvider({ defaultLang = 'en', fixed = false, children }) {
  const [pick, setPick] = useState(stored())
  const lang = fixed ? 'en' : pick || fromBrowser() || (LANGS.some(([k]) => k === defaultLang) ? defaultLang : 'en')
  setLocaleLang(lang) // dates follow the language
  const value = useMemo(
    () => ({
      lang,
      t: makeT(lang),
      setLang: (l) => {
        try { localStorage.setItem(KEY, l) } catch { /* private mode: the choice just lasts for this visit */ }
        setPick(l)
      },
    }),
    [lang]
  )
  return <I18nCtx.Provider value={value}>{children}</I18nCtx.Provider>
}

export function LangSwitcher({ light = false }) {
  const { lang, setLang } = useLang()
  return (
    <select className={'lang-pick' + (light ? ' light' : '')} value={lang} onChange={(e) => setLang(e.target.value)} aria-label="Language">
      {LANGS.map(([k, name]) => <option key={k} value={k}>{name}</option>)}
    </select>
  )
}
