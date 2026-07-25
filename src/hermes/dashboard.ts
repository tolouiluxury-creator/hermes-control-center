import { HermesClient, type RequestOptions } from './client.js';
import { DASHBOARD_STATUS_PATH } from './endpoints.js';
import {
  dashboardStatusSchema,
  systemStatsSchema,
  type DashboardStatus,
  type SystemStats,
} from './schemas.js';

/**
 * Hermes dashboard backend (default :9119). Owns configuration, inventory
 * (skills, MCP, models) and telemetry. Unauthenticated on loopback; the profile
 * query parameter is added by the underlying client.
 */
export class DashboardClient {
  constructor(private readonly client: HermesClient) {}

  get baseUrl(): string {
    return this.client.baseUrl;
  }

  status(options?: RequestOptions): Promise<DashboardStatus> {
    return this.client.json(dashboardStatusSchema, DASHBOARD_STATUS_PATH, options);
  }

  systemStats(options?: RequestOptions): Promise<SystemStats> {
    return this.client.json(systemStatsSchema, '/api/system/stats', options);
  }

  raw(path: string, options?: RequestOptions): Promise<Response> {
    return this.client.fetch(path, options);
  }
}
