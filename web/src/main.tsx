import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import App from '@/App';
import '@/styles/app.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Live data arrives via the /api/stream SSE channel, so polling defaults
      // stay conservative and refetch-on-focus stays off.
      refetchOnWindowFocus: false,
      retry: 1,
      staleTime: 5_000,
    },
  },
});

const container = document.getElementById('root');
if (!container) throw new Error('Root element #root missing from index.html');

createRoot(container).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <App />
    </QueryClientProvider>
  </StrictMode>,
);
