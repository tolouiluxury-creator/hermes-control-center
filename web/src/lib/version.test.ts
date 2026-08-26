import { describe, expect, it } from 'vitest';
import { APP_VERSION, formatVersionLabel } from './version';

describe('version label', () => {
  it('uses the stable package version for the product shell', () => {
    expect(APP_VERSION).toBe('1.0.0');
  });

  it('prefixes the product version with a compact v', () => {
    expect(formatVersionLabel('0.1.0')).toBe('v0.1.0');
  });

  it('preserves prerelease identifiers when they are present', () => {
    expect(formatVersionLabel('0.1.0-beta.3')).toBe('v0.1.0-beta.3');
  });
});
