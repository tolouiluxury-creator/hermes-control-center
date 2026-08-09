import type { FastifyInstance } from 'fastify';
import type { CliOptions } from '../options.js';
import { controlCenterHome, hermesHome } from '../paths.js';
import { pkg } from '../util/pkg.js';
import type { UpdateChecker } from '../updateCheck.js';

export interface MetaResponse {
  name: string;
  version: string;
  node: string;
  platform: string;
  profile: string | null;
  hermesHome: string;
  stateHome: string;
  startedAt: string;
}

/**
 * Identity endpoint. Intentionally free of secrets: the SPA uses it to show the
 * running version and which Hermes installation it is bound to.
 */
export async function registerMetaRoutes(
  app: FastifyInstance,
  options: CliOptions,
  updateChecker: UpdateChecker,
): Promise<void> {
  const startedAt = new Date().toISOString();

  app.get('/api/meta', async (): Promise<MetaResponse> => {
    return {
      name: pkg.name,
      version: pkg.version,
      node: process.version,
      platform: process.platform,
      profile: options.profile,
      hermesHome: hermesHome(),
      stateHome: controlCenterHome(),
      startedAt,
    };
  });

  /** Whether a newer release exists on GitHub — the topbar's update notice. */
  app.get('/api/meta/update', async () => updateChecker.check());
}
