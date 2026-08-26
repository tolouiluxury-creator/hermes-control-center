import { useCallback, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Bot, Check, LayoutGrid, Library, ListTodo, Plus, RotateCcw, Workflow } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router';
import {
  getDashboardLayout,
  getStatus,
  queryKeys,
  resetDashboardLayout,
  saveDashboardLayout,
} from '@/lib/api';
import { addWidget, layoutsEqual, moveWidget, removeWidget } from '@/lib/layout';
import { useStatus } from '@/lib/useStatus';
import { SetupScreen } from '@/components/SetupScreen';
import { Skeleton } from '@/components/Skeleton';
import { WidgetGrid } from '@/components/WidgetGrid';
import { WidgetPicker } from '@/components/WidgetPicker';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';
import { DEFAULT_LAYOUT, nextInstanceId, sanitizeLayout } from '@/widgets/registry';
import type { DashboardLayout, WidgetDefinition } from '@/widgets/types';
import type { MoveDirection } from '@/widgets/WidgetFrame';

const SAVE_DEBOUNCE_MS = 700;

/** One tile in the quick-actions strip under the page header. */
interface QuickAction {
  id: string;
  path: string;
  icon: typeof Workflow;
}

/** Keys must exist in en/de/fa under `dashboard.quickActions.<id>`. */
const QUICK_ACTIONS: QuickAction[] = [
  { id: 'workflow', path: '/workflows', icon: Workflow },
  { id: 'task', path: '/aufgaben', icon: ListTodo },
  { id: 'prompt', path: '/prompts', icon: Library },
  { id: 'bot', path: '/bots', icon: Bot },
];

export function DashboardPage() {
  const queryClient = useQueryClient();
  const toast = useToast();
  const { t } = useI18n();
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const { data: snapshot, isPending: statusPending, isFetching } = useStatus();
  // One-shot entrance animations: keyed by mount, so re-renders never replay
  // them but a fresh visit to the page does.
  const [mountRun] = useState(0);
  const mountedKey = `dashboard-${pathname === '/' ? mountRun : -1}`;
  const enterClass = `dashboard-enter key-${mountedKey}`;

  // Entrance classes for the three zones. Each is `.dash-enter-*`; the delays
  // are CSS variables on the parent, and all of it is no-ops for users who
  // asked the OS for less motion.
  const headerEnterClass = 'dash-enter dash-enter-header';
  const cardEnterClass = 'dash-enter dash-enter-card';

  const stored = useQuery({
    queryKey: queryKeys.dashboardLayout,
    queryFn: getDashboardLayout,
    staleTime: Number.POSITIVE_INFINITY,
  });

  const [layout, setLayout] = useState<DashboardLayout>(DEFAULT_LAYOUT);
  const [editing, setEditing] = useState(false);
  const [pickerOpen, setPickerOpen] = useState(false);

  // Adopt the stored layout once it arrives. Done during render rather than in
  // an effect so the grid never paints the defaults first and then jumps.
  const [adopted, setAdopted] = useState<unknown>(undefined);
  if (stored.data !== undefined && adopted !== stored.data) {
    setAdopted(stored.data);
    const { layout: clean, dropped } = sanitizeLayout(stored.data.layout);
    setLayout(clean);
    if (dropped.length > 0) {
      // Silent removal would look like data loss; say what happened.
      queueMicrotask(() =>
        toast.push({
          tone: 'warning',
          title: t('dashboard.droppedWidgets'),
          description: t('dashboard.droppedWidgets.desc', {
            count: dropped.length,
            names: [...new Set(dropped)].join(', '),
          }),
        }),
      );
    }
  }

  const save = useMutation({
    mutationFn: saveDashboardLayout,
    onError: (error: Error) => {
      toast.push({
        tone: 'error',
        title: t('dashboard.saveFailed'),
        description: error.message,
      });
    },
  });

  // Debounced: dragging fires a change per frame, and each one must not become
  // a request.
  const timer = useRef<number | null>(null);
  const pending = useRef<DashboardLayout | null>(null);

  const scheduleSave = useCallback(
    (next: DashboardLayout) => {
      pending.current = next;
      if (timer.current !== null) window.clearTimeout(timer.current);
      timer.current = window.setTimeout(() => {
        timer.current = null;
        const payload = pending.current;
        if (payload) save.mutate(payload);
      }, SAVE_DEBOUNCE_MS);
    },
    [save],
  );

  useEffect(() => {
    return () => {
      // A pending save must not be lost because the page was left.
      if (timer.current !== null) {
        window.clearTimeout(timer.current);
        if (pending.current) void saveDashboardLayout(pending.current).catch(() => {});
      }
    };
  }, []);

  const applyLayout = useCallback(
    (next: DashboardLayout) => {
      setLayout((current) => {
        if (layoutsEqual(current, next)) return current;
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const handleAdd = useCallback(
    (definition: WidgetDefinition) => {
      setPickerOpen(false);
      setLayout((current) => {
        const next = addWidget(current, {
          i: nextInstanceId(definition.id, current.widgets),
          widget: definition.id,
          x: 0,
          y: 0,
          w: definition.defaultSize.w,
          h: definition.defaultSize.h,
        });
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const handleRemove = useCallback(
    (instanceId: string) => {
      setLayout((current) => {
        const next = removeWidget(current, instanceId);
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const handleMove = useCallback(
    (instanceId: string, direction: MoveDirection) => {
      setLayout((current) => {
        const next = moveWidget(current, instanceId, direction);
        scheduleSave(next);
        return next;
      });
    },
    [scheduleSave],
  );

  const handleReset = useCallback(() => {
    void resetDashboardLayout()
      .then(() => {
        setLayout(DEFAULT_LAYOUT);
        return queryClient.invalidateQueries({ queryKey: queryKeys.dashboardLayout });
      })
      .then(() => toast.push({ tone: 'success', title: t('dashboard.layoutReset') }))
      .catch((error: Error) =>
        toast.push({
          tone: 'error',
          title: t('dashboard.resetFailed'),
          description: error.message,
        }),
      );
  }, [queryClient, toast, t]);

  if (statusPending || stored.isPending) {
    return (
      <div className="mx-auto max-w-[1600px] px-6 py-6">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <Skeleton className="h-56" />
          <Skeleton className="h-56" />
        </div>
      </div>
    );
  }

  if (snapshot?.setupRequired) {
    return (
      <SetupScreen
        snapshot={snapshot}
        onRetry={() =>
          void queryClient.fetchQuery({
            queryKey: queryKeys.status,
            queryFn: () => getStatus(true),
          })
        }
        retrying={isFetching}
      />
    );
  }

  return (
    <div className={`mx-auto max-w-[1600px] px-6 py-6 ${enterClass}`}>
      <div className="mb-5 grid auto-cols-[minmax(10rem,1fr)] grid-flow-col gap-3 overflow-x-auto pb-1 lg:grid-flow-row lg:grid-cols-4 lg:overflow-visible">
        {QUICK_ACTIONS.map((action) => {
          const Icon = action.icon;
          return (
            <button
              key={action.id}
              type="button"
              onClick={() => navigate(action.path)}
              className="quick-action group"
              aria-label={t(`dashboard.quickActions.${action.id}.aria`)}
            >
              <Icon
                size={16}
                strokeWidth={2.25}
                className="text-[var(--color-accent)]"
                aria-hidden
              />
              <span>{t(`dashboard.quickActions.${action.id}.label`)}</span>
            </button>
          );
        })}
      </div>

      <div className={`mb-4 flex flex-wrap items-center gap-2 ${headerEnterClass}`}>
        {/* Header chrome: fades in once, 240 ms. The per-zone delays live in
            app.css, driven by the parent's `.dashboard-enter` key. */}
        <button
          type="button"
          onClick={() => setEditing((value) => !value)}
          aria-pressed={editing}
          className={`inline-flex items-center gap-2 rounded-xl border px-3 py-1.5 text-sm transition-colors ${
            editing
              ? 'border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
              : 'border-[var(--color-hairline)] text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
          }`}
        >
          {editing ? <Check size={14} aria-hidden /> : <LayoutGrid size={14} aria-hidden />}
          {editing ? t('dashboard.done') : t('dashboard.arrange')}
        </button>

        {editing && (
          <>
            <button
              type="button"
              onClick={() => setPickerOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-hairline)] px-3 py-1.5 text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
            >
              <Plus size={14} aria-hidden />
              {t('dashboard.addWidget')}
            </button>

            <button
              type="button"
              onClick={handleReset}
              className="inline-flex items-center gap-2 rounded-xl border border-[var(--color-hairline)] px-3 py-1.5 text-sm text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)]"
            >
              <RotateCcw size={14} aria-hidden />
              {t('dashboard.reset')}
            </button>

            <p className="ml-auto text-xs text-[var(--color-ink-faint)]" role="status">
              {t('dashboard.arrangeHint')}
            </p>
          </>
        )}
      </div>

      {layout.widgets.length === 0 ? (
        <div className={`card p-10 text-center ${cardEnterClass}`}>
          <p className="text-sm font-medium">{t('dashboard.empty.title')}</p>
          <p className="mx-auto mt-1 max-w-sm text-xs text-[var(--color-ink-muted)]">
            {t('dashboard.empty.desc', { arrange: t('dashboard.arrange') })}
          </p>
        </div>
      ) : (
        <div className={`grid gap-4 ${cardEnterClass}`}>
          <WidgetGrid
            layout={layout}
            editing={editing}
            onChange={applyLayout}
            onRemove={handleRemove}
            onMove={handleMove}
          />
        </div>
      )}

      {pickerOpen && (
        <WidgetPicker layout={layout} onAdd={handleAdd} onClose={() => setPickerOpen(false)} />
      )}
    </div>
  );
}
