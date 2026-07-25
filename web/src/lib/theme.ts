import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'dark' | 'light' | 'system';

const STORAGE_KEY = 'hcc.theme';

function readStored(): ThemePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'dark' || value === 'light' || value === 'system') return value;
  } catch {
    // Private mode or blocked storage: fall through to the default.
  }
  return 'dark';
}

/**
 * Writes the preference onto <html>. `system` removes the attribute entirely so
 * the CSS media query takes over, rather than us re-implementing it in JS.
 */
function apply(preference: ThemePreference): void {
  const root = document.documentElement;
  if (preference === 'system') root.removeAttribute('data-theme');
  else root.setAttribute('data-theme', preference);
}

/** Applied before React mounts, so no frame ever renders in the wrong theme. */
export function initTheme(): void {
  apply(readStored());
}

export function useTheme() {
  const [preference, setPreference] = useState<ThemePreference>(readStored);

  useEffect(() => {
    apply(preference);
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Not being able to persist is not worth interrupting the user over.
    }
  }, [preference]);

  const cycle = useCallback(() => {
    setPreference((current) =>
      current === 'dark' ? 'light' : current === 'light' ? 'system' : 'dark',
    );
  }, []);

  return { preference, setPreference, cycle };
}
