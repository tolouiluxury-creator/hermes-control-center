const FILE_REF_LINE = /^@file:(?:`([^`]+)`|(\S+))$/;

export interface AttachmentRef {
  /** The exact ref line, e.g. `@file:.hermes/desktop-attachments/report.txt` — used as a cache key. */
  raw: string;
  /** Full path as Hermes reported it. */
  path: string;
  /** Last path segment only — what gets shown, never the full path. */
  name: string;
}

export interface ParsedAttachments {
  refs: AttachmentRef[];
  /** Message text with the leading ref block (and its blank-line separator) stripped. */
  body: string;
}

/** Reverses buildOutgoingText(): splits the ref block it prepends back out of a message. */
export function parseAttachmentRefs(text: string): ParsedAttachments {
  const lines = text.split('\n');
  let i = 0;
  const refs: AttachmentRef[] = [];
  while (i < lines.length) {
    const line = lines[i];
    if (line === undefined) break;
    const match = FILE_REF_LINE.exec(line);
    if (!match) break;
    const path = match[1] ?? match[2] ?? '';
    refs.push({ raw: line, path, name: path.split('/').pop() || path });
    i++;
  }
  if (refs.length === 0) return { refs: [], body: text };
  // buildOutgoingText() always separates the ref block with exactly one blank
  // line — without it, the leading @file:-looking lines weren't actually one.
  if (lines[i] !== '') return { refs: [], body: text };
  return { refs, body: lines.slice(i + 1).join('\n') };
}

const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif']);

export function isImageFileName(name: string): boolean {
  const ext = name.split('.').pop()?.toLowerCase();
  return ext !== undefined && ext !== name.toLowerCase() && IMAGE_EXTENSIONS.has(ext);
}
