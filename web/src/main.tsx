import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '@/App';
import { ApiError, queryKeys } from '@/lib/api';
import '@/styles/app.css';

/**
 * A 401 anywhere means the session ended (expired, or the password was changed).
 * Re-checking auth status flips the app back to the login screen instead of
 * leaving a half-broken view behind.
 */
const queryCache = new QueryCache({
  onError: (error) => {
    if (error instanceof ApiError && error.status === 401) {
      void client.invalidateQueries({ queryKey: queryKeys.auth });
    }
  },
});

const client = new QueryClient({
  queryCache,
  defaultOptions: {
    queries: {
      // Live data arrives via the /api/stream SSE channel, so polling defaults
      // stay conservative and refetch-on-focus stays off.
      refetchOnWindowFocus: false,
      retry: (failureCount, error) =>
        error instanceof ApiError && error.status === 401 ? false : failureCount < 1,
      staleTime: 5_000,
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root missing from index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
