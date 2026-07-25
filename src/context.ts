import type { CliOptions } from './options.js';
import { controlCenterDatabasePath } from './paths.js';
import { discoverHermes, toPublicConnection, type HermesConnection } from './hermes/discovery.js';
import { HermesClient } from './hermes/client.js';
import { ApiServerClient } from './hermes/apiServer.js';
import { DashboardClient } from './hermes/dashboard.js';
import { Store } from './store/db.js';
import { SettingsRepo } from './store/settings.js';
import { MetricsRepo } from './store/metrics.js';
import { EventBus } from './events.js';
import { buildStatusSnapshot, metricInputsFromSnapshot, type StatusSnapshot } from './status.js';
import { log } from './log.js';

export interface AppContext {
  options: CliOptions;
  connection: HermesConnection;
  api: ApiServerClient;
  dashboard: DashboardClient;
  store: Store;
  settings: SettingsRepo;
  metrics: MetricsRepo;
  bus: EventBus;
  /** Cached snapshot; refetches when older than maxAgeMs. */
  getStatus(maxAgeMs?: number): Promise<StatusSnapshot>;
  /** Forces a fresh snapshot, records metrics and publishes it. Used by the poller. */
  refreshStatus(): Promise<StatusSnapshot>;
  lastStatus(): StatusSnapshot | null;
  close(): void;
}

const DEFAULT_STATUS_MAX_AGE_MS = 2000;

export function createContext(
  options: CliOptions,
  env: NodeJS.ProcessEnv = process.env,
): AppContext {
  const connection = discoverHermes(options, env);
  const publicConnection = toPublicConnection(connection);

  for (const warning of connection.warnings) log.warn(warning);

  const api = new ApiServerClient(
    new HermesClient({
      name: 'api-server',
      baseUrl: connection.apiServer.url,
      apiKey: connection.apiServer.key,
      defaultTimeoutMs: 15_000,
    }),
  );

  const dashboard = new DashboardClient(
    new HermesClient({
      name: 'dashboard',
      baseUrl: connection.dashboard.url,
      profile: connection.profile,
      defaultTimeoutMs: 15_000,
    }),
  );

  const store = Store.open(controlCenterDatabasePath(env));
  const settings = new SettingsRepo(store);
  const metrics = new MetricsRepo(store);
  const bus = new EventBus();

  let cached: StatusSnapshot | null = null;
  let inFlight: Promise<StatusSnapshot> | null = null;

  const fetchStatus = async (): Promise<StatusSnapshot> => {
    // Collapse concurrent callers onto one upstream round trip.
    inFlight ??= buildStatusSnapshot({ api, dashboard, connection: publicConnection }).finally(
      () => {
        inFlight = null;
      },
    );
    cached = await inFlight;
    return cached;
  };

  return {
    options,
    connection,
    api,
    dashboard,
    store,
    settings,
    metrics,
    bus,

    async getStatus(maxAgeMs = DEFAULT_STATUS_MAX_AGE_MS) {
      if (cached && Date.now() - cached.ts <= maxAgeMs) return cached;
      return fetchStatus();
    },

    async refreshStatus() {
      const snapshot = await fetchStatus();
      metrics.record(metricInputsFromSnapshot(snapshot), snapshot.ts);
      bus.publish({ type: 'status', snapshot });
      return snapshot;
    },

    lastStatus() {
      return cached;
    },

    close() {
      store.close();
    },
  };
}
