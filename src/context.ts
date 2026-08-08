import type { CliOptions } from './options.js';
import { loadControlCenterConfig, updateControlCenterConfig } from './config.js';
import { AuthService } from './auth/service.js';
import { DashboardSessionToken } from './hermes/sessionToken.js';
import { controlCenterDatabasePath } from './paths.js';
import { discoverHermes, toPublicConnection, type HermesConnection } from './hermes/discovery.js';
import { HermesClient } from './hermes/client.js';
import { ApiServerClient } from './hermes/apiServer.js';
import { DashboardClient } from './hermes/dashboard.js';
import { GatewayClient } from './hermes/gateway.js';
import { Store } from './store/db.js';
import { WorkflowsRepo } from './store/workflows.js';
import { WorkflowRunsRepo } from './store/workflowRuns.js';
import { WorkflowRunner } from './hermes/workflowRunner.js';
import { SettingsRepo } from './store/settings.js';
import { MetricsRepo } from './store/metrics.js';
import { EventBus } from './events.js';
import { buildStatusSnapshot, metricInputsFromSnapshot, type StatusSnapshot } from './status.js';
import {
  detectWorkspaceRoot,
  OutsideWorkspaceError,
  resolveInsideRoot,
  type WorkspaceRoot,
} from './routes/workspaceRoot.js';
import { log } from './log.js';

export interface AppContext {
  options: CliOptions;
  connection: HermesConnection;
  auth: AuthService;
  api: ApiServerClient;
  dashboard: DashboardClient;
  /** Chat with the agent over the dashboard's tui_gateway WebSocket. */
  gateway: GatewayClient;
  store: Store;
  workflowRuns: WorkflowRunsRepo;
  workflowRunner: WorkflowRunner;
  settings: SettingsRepo;
  metrics: MetricsRepo;
  bus: EventBus;
  /** Cached snapshot; refetches when older than maxAgeMs. */
  getStatus(maxAgeMs?: number): Promise<StatusSnapshot>;
  /** Forces a fresh snapshot, records metrics and publishes it. Used by the poller. */
  refreshStatus(): Promise<StatusSnapshot>;
  lastStatus(): StatusSnapshot | null;
  /**
   * Resolve a path against the configured workspace root, or null when it falls
   * outside — or when no root is configured at all.
   *
   * Lives here rather than in the workspace routes because the chat needs the
   * same boundary: a conversation can start the agent in a directory, and
   * without this check that would be a way around the confinement the workspace
   * area exists to enforce.
   */
  resolveWorkspacePath(path: string): string | null;
  /** Null when no root is configured. */
  getWorkspaceRoot(): WorkspaceRoot | null;
  /**
   * Applies a new root to the live server and persists it to the config file,
   * so setting it through the web UI takes effect immediately — the same
   * pattern as {@link AuthService.updatePasswordHash}. Without this, a
   * freshly-set root would need a process restart before the workspace area
   * actually opened.
   */
  setWorkspaceRoot(root: WorkspaceRoot): void;
  close(): void;
}

const DEFAULT_STATUS_MAX_AGE_MS = 2000;

export function createContext(
  options: CliOptions,
  env: NodeJS.ProcessEnv = process.env,
): AppContext {
  // Loaded once and shared: discovery reads the connection details from it, and
  // the auth service the password hash.
  const loadedConfig = loadControlCenterConfig(env);
  // The config file is the ordinary place for the workspace root; a flag or env
  // var still wins. Null keeps the workspace area closed rather than defaulting
  // it to a directory nobody chose.
  const resolved: CliOptions = {
    ...options,
    workspaceRoot: options.workspaceRoot ?? loadedConfig.config.workspaceRoot ?? null,
  };
  const connection = discoverHermes(options, env, loadedConfig);
  const publicConnection = toPublicConnection(connection);
  const auth = new AuthService(loadedConfig.config.auth ?? null);

  for (const warning of connection.warnings) log.warn(warning);

  const api = new ApiServerClient(
    new HermesClient({
      name: 'api-server',
      baseUrl: connection.apiServer.url,
      apiKey: connection.apiServer.key,
      defaultTimeoutMs: 15_000,
    }),
  );

  // The dashboard guards its API with a session token embedded in its HTML.
  // The REST client and the chat gateway share one provider so a single
  // bootstrap (and a single refresh after a restart) serves both.
  const dashboardToken = new DashboardSessionToken(connection.dashboard.url, {
    onWarn: (message) => log.warn(message),
  });

  const dashboard = new DashboardClient(
    new HermesClient({
      name: 'dashboard',
      baseUrl: connection.dashboard.url,
      profile: connection.profile,
      tokenProvider: dashboardToken,
      defaultTimeoutMs: 15_000,
    }),
  );

  const gateway = new GatewayClient(connection.dashboard.url, dashboardToken, connection.profile);

  const store = Store.open(controlCenterDatabasePath(env));
  const workflows = new WorkflowsRepo(store);
  const workflowRuns = new WorkflowRunsRepo(store);
  const workflowRunner = new WorkflowRunner({ dashboard, workflows, runs: workflowRuns });
  const settings = new SettingsRepo(store);
  const metrics = new MetricsRepo(store);
  const bus = new EventBus();

  let cached: StatusSnapshot | null = null;
  let inFlight: Promise<StatusSnapshot> | null = null;

  /** Null when no root is configured, which closes the workspace area entirely. */
  const configuredRoot = resolved.workspaceRoot?.trim();
  let workspaceRoot = configuredRoot ? detectWorkspaceRoot(configuredRoot) : null;

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
    options: resolved,
    connection,
    auth,
    api,
    dashboard,
    gateway,
    store,
    workflowRuns,
    workflowRunner,
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

    resolveWorkspacePath(path: string) {
      if (!workspaceRoot) return null;
      try {
        return resolveInsideRoot(workspaceRoot, path);
      } catch (error) {
        if (error instanceof OutsideWorkspaceError) return null;
        throw error;
      }
    },

    getWorkspaceRoot() {
      return workspaceRoot;
    },

    setWorkspaceRoot(root) {
      workspaceRoot = root;
      updateControlCenterConfig({ workspaceRoot: root.root });
    },

    close() {
      gateway.close();
      store.close();
    },
  };
}
