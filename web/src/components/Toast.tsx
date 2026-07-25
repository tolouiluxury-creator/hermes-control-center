import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { AlertTriangle, CheckCircle2, Info, X, XCircle } from 'lucide-react';

export type ToastTone = 'info' | 'success' | 'warning' | 'error';

export interface Toast {
  id: number;
  tone: ToastTone;
  title: string;
  description?: string;
  /** 0 keeps the toast until it is dismissed by hand. */
  durationMs: number;
}

export type ToastInput = Omit<Partial<Toast>, 'id'> & { title: string };

interface ToastContextValue {
  push: (toast: ToastInput) => number;
  dismiss: (id: number) => void;
}

const ToastContext = createContext<ToastContextValue | null>(null);

/** Errors stay until dismissed; anything else clears itself. */
const DEFAULT_DURATIONS: Record<ToastTone, number> = {
  info: 5000,
  success: 4000,
  warning: 8000,
  error: 0,
};

const MAX_VISIBLE = 4;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const push = useCallback((input: ToastInput): number => {
    const id = nextId.current++;
    const tone = input.tone ?? 'info';
    const toast: Toast = {
      id,
      tone,
      title: input.title,
      description: input.description,
      durationMs: input.durationMs ?? DEFAULT_DURATIONS[tone],
    };

    // Oldest go first: a burst of events must not push the newest off screen.
    setToasts((current) => [...current, toast].slice(-MAX_VISIBLE));
    return id;
  }, []);

  const value = useMemo(() => ({ push, dismiss }), [push, dismiss]);

  return (
    <ToastContext.Provider value={value}>
      {children}
      <ToastViewport toasts={toasts} onDismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastContextValue {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used inside a ToastProvider');
  return context;
}

const TONE_STYLES: Record<ToastTone, { icon: typeof Info; color: string }> = {
  info: { icon: Info, color: 'var(--color-info)' },
  success: { icon: CheckCircle2, color: 'var(--color-ok)' },
  warning: { icon: AlertTriangle, color: 'var(--color-warn)' },
  error: { icon: XCircle, color: 'var(--color-danger)' },
};

function ToastViewport({
  toasts,
  onDismiss,
}: {
  toasts: Toast[];
  onDismiss: (id: number) => void;
}) {
  return (
    <div
      className="pointer-events-none fixed right-4 bottom-4 flex w-[min(24rem,calc(100vw-2rem))] flex-col gap-2"
      style={{ zIndex: 'var(--z-toast)' }}
    >
      {toasts.map((toast) => (
        <ToastCard key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastCard({ toast, onDismiss }: { toast: Toast; onDismiss: (id: number) => void }) {
  const [paused, setPaused] = useState(false);
  const { icon: Icon, color } = TONE_STYLES[toast.tone];

  useEffect(() => {
    if (toast.durationMs === 0 || paused) return;
    const timer = window.setTimeout(() => onDismiss(toast.id), toast.durationMs);
    return () => window.clearTimeout(timer);
  }, [toast.durationMs, toast.id, onDismiss, paused]);

  return (
    <div
      // Errors interrupt; everything else waits for a pause in the reading.
      role={toast.tone === 'error' ? 'alert' : 'status'}
      className="card pointer-events-auto flex items-start gap-3 p-3.5"
      style={{ animation: 'toast-in var(--duration-slow) var(--ease-ui)' }}
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusCapture={() => setPaused(true)}
      onBlurCapture={() => setPaused(false)}
    >
      <Icon size={16} style={{ color }} className="mt-0.5 shrink-0" aria-hidden />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-medium">{toast.title}</p>
        {toast.description && (
          <p className="mt-0.5 text-xs break-words text-[var(--color-ink-muted)]">
            {toast.description}
          </p>
        )}
      </div>
      <button
        type="button"
        onClick={() => onDismiss(toast.id)}
        className="-m-1 shrink-0 rounded-lg p-1 text-[var(--color-ink-faint)] transition-colors hover:text-[var(--color-ink)]"
        aria-label={`Meldung schließen: ${toast.title}`}
      >
        <X size={14} aria-hidden />
      </button>
    </div>
  );
}
