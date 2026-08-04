import { describe, expect, it } from 'vitest';
import { buildOutgoingText } from './chatOutgoing.js';

describe('buildOutgoingText', () => {
  it('returns the text unchanged when there are no refs', () => {
    expect(buildOutgoingText([], 'hello')).toBe('hello');
  });

  it('prepends a single ref, separated by a blank line', () => {
    expect(buildOutgoingText(['ref'], 'text')).toBe('ref\n\ntext');
  });

  it('joins multiple refs by newline before the blank-line separator', () => {
    expect(buildOutgoingText(['ref1', 'ref2'], 'text')).toBe('ref1\nref2\n\ntext');
  });
});
