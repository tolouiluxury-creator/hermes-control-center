import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { en } from './en';
import { de } from './de';
import { fa } from './fa';

/**
 * Lightweight internationalisation: a flat key→string dictionary per language,
 * a `t()` lookup with `{name}` interpolation, and a preference persisted per
 * device. English is the default; Persian sets the document to right-to-left.
 *
 * No dependency — the app is small enough that a context and three objects beat
 * pulling in an i18n framework, and it keeps the bundle lean.
 */

export type Lang = 'en' | 'de' | 'fa';

export const LANGUAGES: { id: Lang; label: string; endonym: string }[] = [
  { id: 'en', label: 'English', endonym: 'English' },
  { id: 'de', label: 'Deutsch', endonym: 'Deutsch' },
  { id: 'fa', label: 'Persian', endonym: 'فارسی' },
];

export type Dict = Record<string, string>;

const DICTS: Record<Lang, Dict> = { en, de, fa };
const RTL: Record<Lang, boolean> = { en: false, de: false, fa: true };
const STORAGE_KEY = 'hcc.lang';

function isLang(value: unknown): value is Lang {
  return value === 'en' || value === 'de' || value === 'fa';
}

function readStored(): Lang {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (isLang(value)) return value;
  } catch {
    // Blocked storage: fall through to the default.
  }
  return 'en';
}

function interpolate(template: string, params?: Record<string, string | number>): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) =>
    key in params ? String(params[key]) : match,
  );
}

/** Looks a key up in the active language, falling back to English, then the key. */
export function translate(
  lang: Lang,
  key: string,
  params?: Record<string, string | number>,
): string {
  const value = DICTS[lang][key] ?? DICTS.en[key] ?? key;
  return interpolate(value, params);
}

export type TFunction = (key: string, params?: Record<string, string | number>) => string;

/** Applies `lang` and `dir` to <html>. Called before mount and on every change. */
export function applyLang(lang: Lang): void {
  const root = document.documentElement;
  root.lang = lang;
  root.dir = RTL[lang] ? 'rtl' : 'ltr';
}

/** Runs before React mounts so the first frame is already in the right direction. */
export function initLang(): void {
  applyLang(readStored());
}

interface I18nContextValue {
  lang: Lang;
  setLang: (lang: Lang) => void;
  dir: 'ltr' | 'rtl';
  t: TFunction;
}

const I18nContext = createContext<I18nContextValue | null>(null);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [lang, setLangState] = useState<Lang>(readStored);

  useEffect(() => {
    applyLang(lang);
    try {
      localStorage.setItem(STORAGE_KEY, lang);
    } catch {
      // Not persisting is not worth interrupting the user over.
    }
  }, [lang]);

  const setLang = useCallback((next: Lang) => setLangState(next), []);
  const t = useCallback<TFunction>((key, params) => translate(lang, key, params), [lang]);

  const value = useMemo<I18nContextValue>(
    () => ({ lang, setLang, dir: RTL[lang] ? 'rtl' : 'ltr', t }),
    [lang, setLang, t],
  );

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  const context = useContext(I18nContext);
  if (!context) throw new Error('useI18n must be used inside an I18nProvider');
  return context;
}
