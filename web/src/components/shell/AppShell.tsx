import { Suspense, useCallback, useEffect, useState } from 'react';
import { Outlet, useLocation } from 'react-router';
import { X } from 'lucide-react';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { DegradedBanner } from './DegradedBanner';
import { CommandPalette } from '@/components/CommandPalette';
import { SkeletonText } from '@/components/Skeleton';
import { useControlCenterStream } from '@/lib/stream';
import { useKeyBinding } from '@/lib/shortcuts';

const COLLAPSED_KEY = 'hcc.sidebar.collapsed';

function readCollapsed(): boolean {
  try {
    return localStorage.getItem(COLLAPSED_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * The frame every page renders inside: sidebar, top bar, command palette and
 * the single SSE subscription that feeds the whole app.
 *
 * Mounting the stream here rather than per page means one connection for the
 * session, and pages simply read the query cache it writes into.
 */
export function AppShell() {
  const { state: streamState } = useControlCenterStream();
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const location = useLocation();

  useEffect(() => {
    try {
      localStorage.setItem(COLLAPSED_KEY, collapsed ? '1' : '0');
    } catch {
      // Persisting a layout preference is not worth an error message.
    }
  }, [collapsed]);

  // A route change on mobile should reveal the page, not leave the drawer over
  // it. Adjusted during render rather than in an effect, so the drawer never
  // paints once over the new page before closing.
  const [lastPath, setLastPath] = useState(location.pathname);
  if (location.pathname !== lastPath) {
    setLastPath(location.pathname);
    setDrawerOpen(false);
  }

  useKeyBinding({ key: 'k', mod: true }, () => setPaletteOpen((open) => !open));
  useKeyBinding({ key: 'b', mod: true }, () => setCollapsed((value) => !value));
  useKeyBinding({ key: 'Escape' }, () => setDrawerOpen(false), drawerOpen);

  const closePalette = useCallback(() => setPaletteOpen(false), []);

  return (
    <div className="flex h-full">
      <a
        href="#hauptinhalt"
        className="sr-only focus:not-sr-only focus:fixed focus:top-3 focus:left-3 focus:z-[var(--z-toast)] focus:rounded-lg focus:bg-[var(--color-elevated)] focus:px-3 focus:py-2 focus:text-sm"
      >
        Zum Hauptinhalt springen
      </a>

      {/*
       * Desktop sidebar: part of the layout, never overlapping the content.
       *
       * The width deliberately does not animate. A width transition re-runs
       * layout for every nav row on each frame, and because this element's
       * inline width is rewritten on every re-render — the SSE channel pushes a
       * status snapshot every few seconds — each rewrite restarted the
       * transition from its old value, leaving the rail visually stuck at the
       * expanded width. Snapping is both correct and cheaper.
       */}
      <div
        className="hidden shrink-0 lg:block"
        style={{
          width: collapsed ? 'var(--sidebar-width-collapsed)' : 'var(--sidebar-width)',
          zIndex: 'var(--z-sidebar)',
        }}
      >
        <Sidebar collapsed={collapsed} onToggleCollapsed={() => setCollapsed((value) => !value)} />
      </div>

      {/* Mobile drawer. */}
      {drawerOpen && (
        <div
          className="fixed inset-0 bg-black/50 lg:hidden"
          style={{ zIndex: 'var(--z-overlay)' }}
          onClick={() => setDrawerOpen(false)}
        >
          <div
            className="h-full w-[var(--sidebar-width)]"
            onClick={(event) => event.stopPropagation()}
            role="dialog"
            aria-modal="true"
            aria-label="Navigation"
          >
            <Sidebar
              collapsed={false}
              onToggleCollapsed={() => setDrawerOpen(false)}
              onNavigate={() => setDrawerOpen(false)}
            />
          </div>
          <button
            type="button"
            onClick={() => setDrawerOpen(false)}
            className="absolute top-3 right-3 rounded-lg p-2 text-white/70"
            aria-label="Navigation schließen"
          >
            <X size={18} aria-hidden />
          </button>
        </div>
      )}

      <div className="flex min-w-0 flex-1 flex-col">
        <Topbar
          streamState={streamState}
          onOpenSidebar={() => setDrawerOpen(true)}
          onOpenPalette={() => setPaletteOpen(true)}
        />

        <DegradedBanner />

        <main id="hauptinhalt" className="min-h-0 flex-1 overflow-y-auto" tabIndex={-1}>
          <Suspense
            fallback={
              <div className="mx-auto max-w-5xl px-6 py-10">
                <SkeletonText lines={6} />
              </div>
            }
          >
            <Outlet />
          </Suspense>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={closePalette} />
    </div>
  );
}
