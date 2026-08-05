import { describe, expect, it } from 'vitest';
import { isImageFileName, parseAttachmentRefs } from './chatAttachmentRefs.js';

describe('parseAttachmentRefs', () => {
  it('returns the text unchanged as body when there is no ref block', () => {
    expect(parseAttachmentRefs('just a message')).toEqual({ refs: [], body: 'just a message' });
  });

  it('extracts a single ref and reduces the path to a name', () => {
    expect(parseAttachmentRefs('@file:.hermes/desktop-attachments/report.txt\n\nhello')).toEqual({
      refs: [
        {
          raw: '@file:.hermes/desktop-attachments/report.txt',
          path: '.hermes/desktop-attachments/report.txt',
          name: 'report.txt',
        },
      ],
      body: 'hello',
    });
  });

  it('extracts multiple refs in order', () => {
    const text = '@file:a.png\n@file:b.png\n\nsee attached';
    expect(parseAttachmentRefs(text)).toEqual({
      refs: [
        { raw: '@file:a.png', path: 'a.png', name: 'a.png' },
        { raw: '@file:b.png', path: 'b.png', name: 'b.png' },
      ],
      body: 'see attached',
    });
  });

  it('handles a backtick-quoted path with spaces', () => {
    const text = '@file:`.hermes/desktop-attachments/my exam schedule.csv`\n\n';
    expect(parseAttachmentRefs(text).refs).toEqual([
      {
        raw: '@file:`.hermes/desktop-attachments/my exam schedule.csv`',
        path: '.hermes/desktop-attachments/my exam schedule.csv',
        name: 'my exam schedule.csv',
      },
    ]);
  });

  it('returns an empty body for an image sent without a caption', () => {
    expect(parseAttachmentRefs('@file:a.png\n\n').body).toBe('');
  });

  it('treats a leading line as plain text, not a ref, if no blank-line separator follows', () => {
    const text = '@file:a.png\nnot actually a caption';
    expect(parseAttachmentRefs(text)).toEqual({ refs: [], body: text });
  });
});

describe('isImageFileName', () => {
  it.each(['photo.png', 'photo.JPG', 'a.b.gif', 'x.webp'])('accepts %s', (name) => {
    expect(isImageFileName(name)).toBe(true);
  });

  it.each(['report.txt', 'archive.zip', 'noextension', 'png'])('rejects %s', (name) => {
    expect(isImageFileName(name)).toBe(false);
  });
});
