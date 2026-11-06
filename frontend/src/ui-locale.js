// The language the dates are shown in. Set by the language provider; read by date helpers.
// Latin digits are kept (1, 2, 3) so dates and times stay easy to read; month and day names follow the language.
let current = 'en'
export const setLocaleLang = (l) => { current = l }
export const dateLocale = () => ({ en: 'en-IN', mr: 'mr-IN-u-nu-latn', hi: 'hi-IN-u-nu-latn' })[current] || 'en-IN'
