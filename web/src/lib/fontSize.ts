import { useEffect, useState } from 'react';

export type FontSizePreference = 'small' | 'default' | 'large';

const STORAGE_KEY = 'hcc.fontSize';

function readStored(): FontSizePreference {
  try {
    const value = localStorage.getItem(STORAGE_KEY);
    if (value === 'small' || value === 'default' || value === 'large') return value;
  } catch {
    // Private mode or blocked storage: fall through to the default.
  }
  return 'default';
}

/**
 * Writes the preference onto <html>. `default` removes the attribute
 * entirely, leaving the base stylesheet's 16px in charge — same convention
 * as {@link ../theme.ts}'s `system` preference.
 */
function apply(preference: FontSizePreference): void {
  const root = document.documentElement;
  if (preference === 'default') root.removeAttribute('data-font-size');
  else root.setAttribute('data-font-size', preference);
}

/** Applied before React mounts, so no frame ever renders at the wrong size. */
export function initFontSize(): void {
  apply(readStored());
}

export function useFontSize() {
  const [preference, setPreference] = useState<FontSizePreference>(readStored);

  useEffect(() => {
    apply(preference);
    try {
      localStorage.setItem(STORAGE_KEY, preference);
    } catch {
      // Not being able to persist is not worth interrupting the user over.
    }
  }, [preference]);

  return { preference, setPreference };
}
