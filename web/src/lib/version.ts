import packageJson from '../../../package.json';

export const APP_VERSION = packageJson.version;

export function formatVersionLabel(version: string): string {
  return `v${version}`;
}
