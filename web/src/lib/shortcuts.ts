import { useEffect } from 'react';

export interface KeyBinding {
  key: string;
  /** Cmd on macOS, Ctrl elsewhere — the platform-correct "primary" modifier. */
  mod?: boolean;
  shift?: boolean;
}

/**
 * True when the event originates from somewhere the user is typing. Global
 * shortcuts must not steal a keystroke from a text field — except the
 * modifier-based ones, which no text field claims.
 */
export function isFromTextEntry(target: EventTarget | null): boolean {
  // Duck-typed rather than `instanceof HTMLElement`: the check then also works
  // where that global does not exist, and behaves identically in the browser.
  if (!target || typeof target !== 'object') return false;

  const element = target as { isContentEditable?: boolean; tagName?: unknown };
  if (element.isContentEditable === true) return true;

  const tag = typeof element.tagName === 'string' ? element.tagName.toUpperCase() : '';
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
}

export function matchesBinding(event: KeyboardEvent, binding: KeyBinding): boolean {
  const primary = event.metaKey || event.ctrlKey;
  if (Boolean(binding.mod) !== primary) return false;
  if (Boolean(binding.shift) !== event.shiftKey) return false;
  return event.key.toLowerCase() === binding.key.toLowerCase();
}

export function useKeyBinding(
  binding: KeyBinding,
  handler: (event: KeyboardEvent) => void,
  enabled = true,
): void {
  useEffect(() => {
    if (!enabled) return undefined;

    const onKeyDown = (event: KeyboardEvent): void => {
      if (!matchesBinding(event, binding)) return;
      if (!binding.mod && isFromTextEntry(event.target)) return;
      event.preventDefault();
      handler(event);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [binding.key, binding.mod, binding.shift, handler, enabled, binding]);
}
