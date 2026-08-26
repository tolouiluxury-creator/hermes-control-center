import { describe, expect, it } from 'vitest';
import { profileNameFromBotName } from './profileName.js';

describe('profileNameFromBotName', () => {
  it('turns a human Bot name into a stable Hermes profile name', () => {
    expect(profileNameFromBotName('Research & Design')).toBe('research-design');
  });

  it('uses a safe fallback when the name contains no profile characters', () => {
    expect(profileNameFromBotName('机器人')).toBe('bot');
  });
});
