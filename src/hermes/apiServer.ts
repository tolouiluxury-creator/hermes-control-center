import type { HermesClient, RequestOptions } from './client.js';
import { API_CAPABILITIES_PATH, API_HEALTH_DETAILED_PATH, API_HEALTH_PATH } from './endpoints.js';
import {
  capabilitiesSchema,
  healthDetailedSchema,
  healthSchema,
  type Capabilities,
  type Health,
  type HealthDetailed,
} from './schemas.js';

/**
 * Hermes API server (default :8642). Owns conversation, session, run and job
 * traffic. Every call needs the bearer key except /health.
 */
export class ApiServerClient {
  constructor(private readonly client: HermesClient) {}

  get baseUrl(): string {
    return this.client.baseUrl;
  }

  get hasKey(): boolean {
    return this.client.hasKey;
  }

  health(options?: RequestOptions): Promise<Health> {
    return this.client.json(healthSchema, API_HEALTH_PATH, { ...options, auth: false });
  }

  healthDetailed(options?: RequestOptions): Promise<HealthDetailed> {
    return this.client.json(healthDetailedSchema, API_HEALTH_DETAILED_PATH, options);
  }

  capabilities(options?: RequestOptions): Promise<Capabilities> {
    return this.client.json(capabilitiesSchema, API_CAPABILITIES_PATH, options);
  }

  /** Escape hatch for streaming endpoints that are piped straight through. */
  raw(path: string, options?: RequestOptions): Promise<Response> {
    return this.client.fetch(path, options);
  }
}
