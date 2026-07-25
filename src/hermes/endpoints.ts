/**
 * Hermes Agent exposes two independent HTTP surfaces. The control center needs
 * both: the API server for conversation/session/run/job traffic, and the
 * dashboard backend for management and telemetry data.
 */
export const DEFAULT_API_SERVER_URL = 'http://127.0.0.1:8642';
export const DEFAULT_DASHBOARD_URL = 'http://127.0.0.1:9119';

export const DEFAULT_API_SERVER_PORT = 8642;
export const DEFAULT_DASHBOARD_PORT = 9119;

/** Liveness probe on the API server. Unauthenticated. */
export const API_HEALTH_PATH = '/health';
/** Authenticated readiness probe with per-subsystem checks. */
export const API_HEALTH_DETAILED_PATH = '/health/detailed';
/** Machine-readable feature list, used for graceful degradation. */
export const API_CAPABILITIES_PATH = '/v1/capabilities';
/** Dashboard status: agent version, gateway state, platform states. */
export const DASHBOARD_STATUS_PATH = '/api/status';
