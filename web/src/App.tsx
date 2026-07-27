import { useQuery, useQueryClient } from '@tanstack/react-query';
import { BrowserRouter } from 'react-router';
import { getAuthStatus, queryKeys } from '@/lib/api';
import { LoginScreen } from '@/components/LoginScreen';
import { ToastProvider } from '@/components/Toast';
import { I18nProvider } from '@/lib/i18n';
import { AppRoutes } from '@/routes';

/**
 * Decides between the login gate and the application, and nothing else — the
 * layout lives in AppShell so that this stays the one place where "may this
 * person see anything at all?" is answered.
 */
export default function App() {
  const queryClient = useQueryClient();

  const auth = useQuery({
    queryKey: queryKeys.auth,
    queryFn: getAuthStatus,
    staleTime: 30_000,
  });

  if (auth.isPending) {
    return (
      <main className="grid min-h-full place-items-center">
        <p className="text-sm text-[var(--color-ink-muted)]" role="status">
          Verbinde …
        </p>
      </main>
    );
  }

  if (auth.data?.required === true && !auth.data.authenticated) {
    return (
      <main className="min-h-full">
        <LoginScreen
          onSuccess={() => {
            // Nothing was allowed to load while locked, so refetch everything.
            void queryClient.invalidateQueries();
          }}
        />
      </main>
    );
  }

  return (
    <I18nProvider>
      <ToastProvider>
        <BrowserRouter>
          <AppRoutes />
        </BrowserRouter>
      </ToastProvider>
    </I18nProvider>
  );
}
