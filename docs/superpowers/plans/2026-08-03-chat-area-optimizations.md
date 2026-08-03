# Chat Area Optimizations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add file attachments, a grouped/searchable conversation list, and a collapsible right sidebar (ToDos + Workspace tabs) to the Chats page, plus an auto-scroll lock and a message→ToDo action.

**Architecture:** Five independently shippable phases, each ending in the project's full gate and a commit. File attachments go through Hermes's native `file.attach` gateway RPC (JSON-RPC over the existing WebSocket, via `ctx.gateway.request`) — no new upload/download HTTP endpoints, no change to the earlier decision that left `/api/files/upload` unused. ToDos are the control center's own data (new SQLite table, same pattern as the existing prompt library). The Workspace tab reuses the existing sandboxed workspace API through a component extracted out of `WorkspacePage.tsx` so the CRUD logic exists in exactly one place.

**Tech Stack:** React 19, TypeScript, Tailwind v4, Fastify, `node:sqlite` via the project's `Store`/migrations system, Vitest.

## Global Constraints

- Full gate before every commit: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`.
- New user-facing strings go in all three i18n dictionaries (`web/src/lib/i18n/{de,en,fa}.ts`) with the same key set — check with the parity script the project already uses:
  `node -e "const f=p=>require('fs').readFileSync(p,'utf8');const k=s=>new Set([...s.matchAll(/^\s{2}'([^']+)':/gm)].map(m=>m[1]));const a=k(f('web/src/lib/i18n/en.ts')),b=k(f('web/src/lib/i18n/de.ts')),c=k(f('web/src/lib/i18n/fa.ts'));console.log(a.size,b.size,c.size);const d=(x,y,n)=>[...x].filter(z=>!y.has(z)).forEach(z=>console.log('fehlt in '+n+':',z));d(a,b,'de');d(a,c,'fa');d(b,a,'en');d(c,a,'en');"`
- No new npm dependencies — everything here is buildable with what's already installed (React, `@tanstack/react-query`, `lucide-react`, Fastify, `zod`, `node:sqlite`).
- Never edit a shipped migration in `src/store/migrations.ts` — append a new entry.
- Match existing code style: no comments explaining *what* code does, only non-obvious *why*; Tailwind classes and CSS custom properties (`--color-*`) exactly as used elsewhere, never new colors.
- Never write directly to the real Hermes agent from a test — the project's tests are pure-function/store unit tests (Vitest, `:memory:` SQLite); there are no React component tests in this codebase (confirmed: no `*.test.tsx` files exist), so new UI does not get a component test, only the pure logic it depends on does.

---

## Phase 1: File attachments

### Task 1: Server route for staging an attachment

**Files:**
- Modify: `src/routes/chat.ts` (add a route near the other `/api/chat/*` routes, after the `/api/chat/resume` handler at line 200)
- Test: none (thin route wrapping a gateway RPC call — matches how `/api/chat/resume` and `/api/chat/session` are untested at the route level; the project has no route-level test harness for `chat.ts`)

**Interfaces:**
- Consumes: `ctx.gateway.request<T>(method, params)` (already accepts a `profile` default per the earlier gateway fix — nothing to change there), `describeGatewayError(error)` (already defined in `chat.ts`), Fastify's `app`/`ctx` already in scope in `registerChatRoutes`.
- Produces: `POST /api/chat/attach` — request body `{ liveId: string; dataUrl: string; name: string }`, response `{ name: string; refText: string }` on success, `{ error: 'gateway_error', message }` (503) on gateway failure, `{ error: 'invalid_request' }` (400) on a malformed body. Later tasks (Task 3) call this exact path and shape.

- [ ] **Step 1: Read the existing `/api/chat/resume` handler for the pattern to match**

Open `src/routes/chat.ts` and find the `app.post('/api/chat/resume', ...)` handler (around line 181). Note the shape: parse with a zod schema, call `ctx.gateway.request(...)`, catch and translate to a 503 with `describeGatewayError`.

- [ ] **Step 2: Add the schema and route**

Add this near the other schemas at the top of the file (next to `resumeSchema`/`createSchema`):

```typescript
const attachSchema = z.object({
  liveId: z.string().trim().min(1),
  dataUrl: z.string().trim().min(1),
  name: z.string().trim().min(1).max(255),
});
```

Add the route directly after the `/api/chat/resume` handler (after its closing `});` around line 200):

```typescript
  app.post('/api/chat/attach', async (request, reply) => {
    const parsed = attachSchema.safeParse(request.body ?? {});
    if (!parsed.success) return reply.code(400).send({ error: 'invalid_request' });
    // ~10 MB of raw bytes is roughly 13.3 MB base64 — reject well before Fastify's
    // own body-size limit so the failure reads as "too big" and not "server error".
    if (parsed.data.dataUrl.length > 14_000_000) {
      return reply.code(413).send({ error: 'too_large', message: 'File is too large (max 10 MB).' });
    }
    try {
      const result = await ctx.gateway.request<{
        attached?: boolean;
        name?: string;
        ref_text?: string;
      }>('file.attach', {
        session_id: parsed.data.liveId,
        data_url: parsed.data.dataUrl,
        name: parsed.data.name,
      });
      if (!result.ref_text) {
        return reply.code(503).send({ error: 'gateway_error', message: 'Attachment was not accepted.' });
      }
      return { name: result.name ?? parsed.data.name, refText: result.ref_text };
    } catch (error) {
      return reply.code(503).send({ error: 'gateway_error', message: describeGatewayError(error) });
    }
  });
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 4: Manual verification against the real server (this cannot be unit-tested — it's a live WebSocket call to Hermes)**

Deploy is out of scope for this task (later, whole-feature deploy) but locally verify the route at least compiles into `dist` and matches the shape a client will call:
Run: `npm run build`
Expected: build succeeds with no new errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/chat.ts
git commit -m "Chat: add a server route staging a file attachment via Hermes's file.attach"
```

---

### Task 2: Frontend API client for attaching a file

**Files:**
- Modify: `web/src/lib/api.ts` (add near `sendChatPrompt`, around line 724)

**Interfaces:**
- Consumes: `apiRequest<T>(path, init)`, the `jsonBody()` helper already defined in the file.
- Produces: `attachChatFile(liveId: string, dataUrl: string, name: string): Promise<{ name: string; refText: string }>` — Task 3 calls this exact function.

- [ ] **Step 1: Add the client function**

In `web/src/lib/api.ts`, directly after the `sendChatPrompt` export (around line 724-725), add:

```typescript
export const attachChatFile = (
  liveId: string,
  dataUrl: string,
  name: string,
): Promise<{ name: string; refText: string }> =>
  apiRequest<{ name: string; refText: string }>('/chat/attach', {
    method: 'POST',
    ...jsonBody({ liveId, dataUrl, name }),
  });
```

- [ ] **Step 2: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 3: Commit**

```bash
git add web/src/lib/api.ts
git commit -m "Chat: add the attachChatFile API client function"
```

---

### Task 3: Attachment chips in the compose row

**Files:**
- Create: `web/src/components/AttachmentChip.tsx`
- Modify: `web/src/pages/ChatsPage.tsx` (compose form, around lines 780-813; `send()`, around lines 418-459)
- Modify: `web/src/lib/i18n/{de,en,fa}.ts` (new keys)

**Interfaces:**
- Consumes: `attachChatFile` (Task 2), `liveRef.current` / `liveId` (already in `ChatsPage.tsx`), `useToast` (existing).
- Produces: nothing consumed by a later task — this is the leaf of the file-attachment feature.

- [ ] **Step 1: Write `AttachmentChip.tsx`**

```typescript
import { Paperclip, X } from 'lucide-react';

export interface PendingAttachment {
  file: File;
  /** Set once the file has been read into a data URL, ready to send. */
  dataUrl: string | null;
}

export function AttachmentChip({
  attachment,
  onRemove,
}: {
  attachment: PendingAttachment;
  onRemove: () => void;
}) {
  const sizeKb = Math.round(attachment.file.size / 1024);
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--color-hairline)] bg-[var(--color-raised)] py-1 pr-1 pl-2.5 text-xs text-[var(--color-ink-muted)]">
      <Paperclip size={11} className="shrink-0" aria-hidden />
      <span className="max-w-[10rem] truncate">{attachment.file.name}</span>
      <span className="shrink-0 text-[var(--color-ink-faint)]">{sizeKb} KB</span>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${attachment.file.name}`}
        className="shrink-0 rounded-full p-0.5 text-[var(--color-ink-faint)] hover:text-[var(--color-danger)]"
      >
        <X size={11} aria-hidden />
      </button>
    </span>
  );
}
```

- [ ] **Step 2: Add attachment state and a file-reading helper to `ChatsPage.tsx`**

In `web/src/pages/ChatsPage.tsx`, change line 3 from:
```typescript
import { CheckSquare, MessagesSquare, Pin, Plus, Send, Square, Trash2 } from 'lucide-react';
```
to:
```typescript
import { CheckSquare, MessagesSquare, Paperclip, Pin, Plus, Send, Square, Trash2 } from 'lucide-react';
```

In the `@/lib/api` import block (lines 4-16), change:
```typescript
import {
  ApiError,
  createChatSession,
```
to:
```typescript
import {
  ApiError,
  attachChatFile,
  createChatSession,
```

Add two new import lines after line 25 (`import { TypingDots } from '@/components/TypingDots';`):
```typescript
import { AttachmentChip, type PendingAttachment } from '@/components/AttachmentChip';
```

Add state right after the existing `[input, setInput]` state (around line 48):

```typescript
  const [attachments, setAttachments] = useState<PendingAttachment[]>([]);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
```

Add this helper function near `send` (just above it, around line 417):

```typescript
  const readAsDataUrl = (file: File): Promise<string> =>
    new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = () => reject(reader.error ?? new Error('read failed'));
      reader.readAsDataURL(file);
    });

  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files);
    const staged: PendingAttachment[] = list.map((file) => ({ file, dataUrl: null }));
    setAttachments((current) => [...current, ...staged]);
    for (const item of staged) {
      try {
        const dataUrl = await readAsDataUrl(item.file);
        setAttachments((current) =>
          current.map((entry) => (entry.file === item.file ? { ...entry, dataUrl } : entry)),
        );
      } catch {
        setAttachments((current) => current.filter((entry) => entry.file !== item.file));
        toast.push({ tone: 'error', title: t('chat.attachReadFailed', { name: item.file.name }) });
      }
    }
  };
```

- [ ] **Step 3: Wire attachments into `send()`**

Replace the existing `send` function body (lines 418-459) with:

```typescript
  const send = async () => {
    const text = input.trim();
    const pending = attachments.filter((entry) => entry.dataUrl !== null);
    if ((text === '' && pending.length === 0) || streaming) return;
    setInput('');
    inputRef.current?.focus();
    setMessages((current) => [...current, { role: 'user', text }, { role: 'assistant', text: '' }]);
    setStreaming(true);
    try {
      let live = liveRef.current;
      if (!live) {
        const ids = await createChatSession({
          model: modelPick?.model,
          provider: modelPick?.provider,
          profile,
          cwd: cwd ?? undefined,
        });
        if (!ids.liveId) throw new Error(t('chat.sendFailed'));
        live = ids.liveId;
        liveRef.current = live;
        setLiveId(live);
        sessionRef.current = ids.storedId ?? null;
        setSessionId(ids.storedId ?? null);
        setStartedWithModel(modelPick?.model ?? null);
      }
      const refs: string[] = [];
      for (const item of pending) {
        // dataUrl is non-null here (filtered above), narrowed for TypeScript.
        const { refText } = await attachChatFile(live, item.dataUrl as string, item.file.name);
        refs.push(refText);
      }
      const outgoing = refs.length > 0 ? `${refs.join('\n')}\n\n${text}` : text;
      setAttachments([]);
      await sendChatPrompt(live, outgoing);
    } catch (error) {
      setStreaming(false);
      setMessages((current) => current.slice(0, -1));
      toast.push({
        tone: 'error',
        title: t('chat.sendFailed'),
        description: error instanceof Error ? error.message : undefined,
      });
    }
  };
```

- [ ] **Step 4: Add the paperclip button, hidden file input, drag-and-drop, and the chip tray to the compose form**

Replace the `<form>` block (lines 780-813) with:

```tsx
              {attachments.length > 0 && (
                <div className="mb-2 flex flex-wrap gap-1.5">
                  {attachments.map((attachment, index) => (
                    <AttachmentChip
                      key={`${attachment.file.name}-${index}`}
                      attachment={attachment}
                      onRemove={() =>
                        setAttachments((current) => current.filter((_, i) => i !== index))
                      }
                    />
                  ))}
                </div>
              )}

              <form
                className="mt-3 flex items-end gap-2"
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => {
                  event.preventDefault();
                  if (event.dataTransfer.files.length > 0) void addFiles(event.dataTransfer.files);
                }}
                onSubmit={(event) => {
                  event.preventDefault();
                  void send();
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  multiple
                  className="hidden"
                  onChange={(event) => {
                    if (event.target.files && event.target.files.length > 0) {
                      void addFiles(event.target.files);
                    }
                    event.target.value = '';
                  }}
                />
                <button
                  type="button"
                  onClick={() => fileInputRef.current?.click()}
                  disabled={connecting}
                  title={t('chat.attachFile')}
                  aria-label={t('chat.attachFile')}
                  className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl border border-[var(--color-hairline)] px-3 text-[var(--color-ink-muted)] transition-colors hover:text-[var(--color-ink)] disabled:opacity-40"
                >
                  <Paperclip size={15} aria-hidden />
                </button>
                <textarea
                  ref={inputRef}
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && !event.shiftKey) {
                      event.preventDefault();
                      void send();
                    }
                  }}
                  rows={1}
                  placeholder={connecting ? t('chat.connecting') : t('chat.placeholder')}
                  disabled={connecting}
                  className="min-h-[2.75rem] flex-1 resize-y rounded-xl border border-[var(--color-hairline)] bg-[var(--color-base)] px-3 py-2.5 text-sm outline-none focus-visible:border-[var(--color-accent)] disabled:opacity-60"
                />
                <button
                  type="submit"
                  disabled={
                    connecting ||
                    streaming ||
                    (input.trim() === '' && attachments.every((a) => a.dataUrl === null))
                  }
                  className="inline-flex h-11 items-center gap-2 rounded-xl border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 px-4 text-sm font-medium text-[var(--color-accent)] transition-colors hover:bg-[var(--color-accent)]/20 disabled:opacity-40"
                >
                  <Send size={15} aria-hidden />
                  {t('chat.send')}
                </button>
              </form>
```

- [ ] **Step 5: Add the two new i18n keys to all three dictionaries**

In `web/src/lib/i18n/de.ts`, next to the other `chat.*` keys (near line 191):
```typescript
  'chat.attachFile': 'Datei anhängen',
  'chat.attachReadFailed': 'Konnte {name} nicht lesen.',
```
In `web/src/lib/i18n/en.ts`, same location:
```typescript
  'chat.attachFile': 'Attach file',
  'chat.attachReadFailed': 'Could not read {name}.',
```
In `web/src/lib/i18n/fa.ts`, same location:
```typescript
  'chat.attachFile': 'پیوست کردن فایل',
  'chat.attachReadFailed': 'خواندن {name} ممکن نشد.',
```

- [ ] **Step 6: Run the i18n parity check**

Run the command from Global Constraints.
Expected: all three counts equal, no "fehlt in" lines printed.

- [ ] **Step 7: Full gate**

Run: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`
Expected: all green. (`format:check` will likely need `npx prettier --write web/src/pages/ChatsPage.tsx web/src/components/AttachmentChip.tsx web/src/lib/api.ts web/src/lib/i18n/*.ts` run first if it complains — run that, then re-run the gate.)

- [ ] **Step 8: Commit**

```bash
git add web/src/components/AttachmentChip.tsx web/src/pages/ChatsPage.tsx web/src/lib/i18n/de.ts web/src/lib/i18n/en.ts web/src/lib/i18n/fa.ts
git commit -m "Chat: attach files to a message via drag-and-drop or a picker"
```

- [ ] **Step 9: Deploy and manually verify (cannot be meaningfully unit-tested — real WebSocket, real Hermes)**

Deploy per the project's established process (tar the tracked+untracked-not-ignored files to the server, `npm ci && npm run build`, restart `hermes-control-center.service`). Then, in the browser: open a conversation, attach a small text file, send a message referencing it, confirm the agent's reply shows it read the file's content.

---

## Phase 2: Conversation list — date grouping and search

### Task 4: `groupByRecency()` pure function

**Files:**
- Create: `web/src/lib/chatGroups.ts`
- Test: `web/src/lib/chatGroups.test.ts`

**Interfaces:**
- Consumes: nothing beyond a `ChatSessionSummary[]` (already defined in `web/src/lib/api.ts`, has `startedAt: number | null`).
- Produces: `groupByRecency(sessions: ChatSessionSummary[], now?: number): { label: string; sessions: ChatSessionSummary[] }[]` — Task 5 renders this directly. Group labels are translation keys (`'chat.groupToday' | 'chat.groupYesterday' | 'chat.groupThisWeek' | 'chat.groupOlder'`), not display text — the caller translates.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it } from 'vitest';
import { groupByRecency } from './chatGroups.js';
import type { ChatSessionSummary } from './api.js';

function session(id: string, startedAt: number | null): ChatSessionSummary {
  return { id, title: '', preview: '', startedAt, messageCount: 0, model: null, pinned: false };
}

describe('groupByRecency', () => {
  const now = new Date('2026-08-03T12:00:00').getTime();
  const day = 24 * 60 * 60 * 1000;

  it('buckets into today, yesterday, this week, and older', () => {
    const sessions = [
      session('today', now - 2 * 60 * 60 * 1000),
      session('yesterday', now - day - 60 * 1000),
      session('this-week', now - 3 * day),
      session('older', now - 30 * day),
    ];
    const groups = groupByRecency(sessions, now);
    expect(groups.map((g) => g.label)).toEqual([
      'chat.groupToday',
      'chat.groupYesterday',
      'chat.groupThisWeek',
      'chat.groupOlder',
    ]);
    expect(groups[0]?.sessions.map((s) => s.id)).toEqual(['today']);
    expect(groups[1]?.sessions.map((s) => s.id)).toEqual(['yesterday']);
    expect(groups[2]?.sessions.map((s) => s.id)).toEqual(['this-week']);
    expect(groups[3]?.sessions.map((s) => s.id)).toEqual(['older']);
  });

  it('omits empty groups entirely', () => {
    const groups = groupByRecency([session('today', now)], now);
    expect(groups).toHaveLength(1);
  });

  it('puts a session with no startedAt into "older" rather than dropping it', () => {
    const groups = groupByRecency([session('unknown', null)], now);
    expect(groups[0]?.label).toBe('chat.groupOlder');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- chatGroups`
Expected: FAIL — `chatGroups.ts` does not exist yet.

- [ ] **Step 3: Write the implementation**

```typescript
import type { ChatSessionSummary } from './api.js';

export interface ChatSessionGroup {
  label: 'chat.groupToday' | 'chat.groupYesterday' | 'chat.groupThisWeek' | 'chat.groupOlder';
  sessions: ChatSessionSummary[];
}

const DAY_MS = 24 * 60 * 60 * 1000;

function startOfDay(ts: number): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/**
 * Groups by local calendar day relative to `now`, not by a rolling 24h/7d
 * window — "yesterday" means the previous calendar day, matching how every
 * other date-grouped list (email, chat apps) reads.
 */
export function groupByRecency(
  sessions: ChatSessionSummary[],
  now: number = Date.now(),
): ChatSessionGroup[] {
  const todayStart = startOfDay(now);
  const yesterdayStart = todayStart - DAY_MS;
  const weekStart = todayStart - 7 * DAY_MS;

  const buckets: Record<ChatSessionGroup['label'], ChatSessionSummary[]> = {
    'chat.groupToday': [],
    'chat.groupYesterday': [],
    'chat.groupThisWeek': [],
    'chat.groupOlder': [],
  };

  for (const session of sessions) {
    const startedAt = session.startedAt;
    if (startedAt === null || startedAt < weekStart) {
      buckets['chat.groupOlder'].push(session);
    } else if (startedAt >= todayStart) {
      buckets['chat.groupToday'].push(session);
    } else if (startedAt >= yesterdayStart) {
      buckets['chat.groupYesterday'].push(session);
    } else {
      buckets['chat.groupThisWeek'].push(session);
    }
  }

  return (Object.keys(buckets) as ChatSessionGroup['label'][])
    .map((label) => ({ label, sessions: buckets[label] }))
    .filter((group) => group.sessions.length > 0);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- chatGroups`
Expected: PASS, 3 tests.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/chatGroups.ts web/src/lib/chatGroups.test.ts
git commit -m "Chat: add groupByRecency for the conversation list"
```

---

### Task 5: Wire grouping and search into the conversation list

**Files:**
- Modify: `web/src/pages/ChatsPage.tsx` (list rendering, lines 540-650; imports)
- Modify: `web/src/lib/i18n/{de,en,fa}.ts`

**Interfaces:**
- Consumes: `groupByRecency` (Task 4).
- Produces: nothing consumed by a later task.

- [ ] **Step 1: Add search state and import `groupByRecency`**

In `ChatsPage.tsx`, change the `lucide-react` import line (as left by Task 3's edit) from:
```typescript
import { CheckSquare, MessagesSquare, Paperclip, Pin, Plus, Send, Square, Trash2 } from 'lucide-react';
```
to:
```typescript
import { CheckSquare, MessagesSquare, Paperclip, Pin, Plus, Search, Send, Square, Trash2 } from 'lucide-react';
```

Add a new import line after the `@/lib/format` import:
```typescript
import { groupByRecency } from '@/lib/chatGroups';
```

Add state next to `[sessions, setSessions]` (around line 36):

```typescript
  const [listSearch, setListSearch] = useState('');
```

- [ ] **Step 2: Compute filtered + grouped sessions**

Add this right before the `return (` (around line 461), after `openSession` is computed:

```typescript
  const visibleSessions = listSearch.trim() === ''
    ? sessions
    : sessions.filter((session) => {
        const haystack = `${session.title ?? ''} ${session.preview ?? ''}`.toLowerCase();
        return haystack.includes(listSearch.trim().toLowerCase());
      });
  const groups = groupByRecency(visibleSessions);
```

- [ ] **Step 3: Add the search input above the list, and render by group**

Insert a search input right after the "new conversation" button block and before the selection-mode row (i.e., right after the `</button>` that closes the "new conversation" button, before the `{sessions.length > 0 && (` block, around line 475):

```tsx
          {sessions.length > 0 && (
            <div className="relative mt-2">
              <Search
                size={12}
                className="pointer-events-none absolute top-1/2 left-2 -translate-y-1/2 text-[var(--color-ink-faint)]"
                aria-hidden
              />
              <input
                value={listSearch}
                onChange={(event) => setListSearch(event.target.value)}
                placeholder={t('chat.searchConversations')}
                aria-label={t('chat.searchConversations')}
                className="w-full rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] py-1.5 pr-2 pl-7 text-xs outline-none focus-visible:border-[var(--color-accent)]"
              />
            </div>
          )}
```

Now replace the list body. Find the `<ul className="space-y-1">` block (starts around line 540) through its closing `</ul>` (around line 649), which currently maps `sessions.map(...)`. Replace the whole `<ul>...</ul>` with:

```tsx
              <div className="space-y-3">
                {groups.map((group) => (
                  <div key={group.label}>
                    <p className="mb-1 px-1 text-[0.65rem] font-medium tracking-wide text-[var(--color-ink-faint)] uppercase">
                      {t(group.label)}
                    </p>
                    <ul className="space-y-1">
                      {group.sessions.map((session) => {
                        const active = session.id === sessionId;
                        const label = session.title || session.preview || t('chat.conversation');
                        const picked = selected.has(session.id);
                        return (
                          <li key={session.id}>
                            <div className="group flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() =>
                                  selecting ? toggleSelected(session.id) : void openExisting(session.id)
                                }
                                aria-pressed={selecting ? picked : undefined}
                                className={`flex min-w-0 flex-1 items-start gap-2 rounded-lg px-2.5 py-2 text-left transition-colors ${
                                  active && !selecting
                                    ? 'bg-[var(--color-accent)]/10 text-[var(--color-ink)]'
                                    : 'text-[var(--color-ink-muted)] hover:bg-[var(--color-raised)]'
                                }`}
                              >
                                {selecting &&
                                  (picked ? (
                                    <CheckSquare
                                      size={13}
                                      className="mt-0.5 shrink-0 text-[var(--color-accent)]"
                                      aria-hidden
                                    />
                                  ) : (
                                    <Square
                                      size={13}
                                      className="mt-0.5 shrink-0 text-[var(--color-ink-faint)]"
                                      aria-hidden
                                    />
                                  ))}
                                <span className="min-w-0 flex-1">
                                  <p className="truncate text-xs font-medium">{label}</p>
                                  <p className="mt-0.5 flex items-center gap-1.5 text-[0.65rem] text-[var(--color-ink-faint)]">
                                    {session.messageCount > 0 && (
                                      <span>
                                        {session.messageCount} {t('chat.messages')}
                                      </span>
                                    )}
                                    {session.startedAt && (
                                      <span>· {formatRelativeTime(session.startedAt, lang)}</span>
                                    )}
                                  </p>
                                </span>
                              </button>

                              {!selecting && (
                                <span className="flex shrink-0 items-center gap-0.5 self-center">
                                  <button
                                    type="button"
                                    onClick={() => void togglePin(session)}
                                    disabled={pinning === session.id}
                                    title={session.pinned ? t('chat.unpin') : t('chat.pin')}
                                    aria-label={session.pinned ? t('chat.unpin') : t('chat.pin')}
                                    aria-pressed={session.pinned}
                                    className={`rounded-md p-1 transition-colors disabled:opacity-40 ${
                                      session.pinned
                                        ? 'text-[var(--color-accent)]'
                                        : 'text-[var(--color-ink-faint)] opacity-0 group-hover:opacity-100 focus-visible:opacity-100 hover:text-[var(--color-ink)]'
                                    }`}
                                  >
                                    <Pin size={12} aria-hidden fill={session.pinned ? 'currentColor' : 'none'} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmOne(session.id)}
                                    title={t('common.delete')}
                                    aria-label={`${t('common.delete')} ${label}`}
                                    className="rounded-md p-1 text-[var(--color-ink-faint)] opacity-0 transition-colors group-hover:opacity-100 hover:text-[var(--color-danger)] focus-visible:opacity-100"
                                  >
                                    <Trash2 size={12} aria-hidden />
                                  </button>
                                </span>
                              )}
                            </div>

                            {confirmOne === session.id && (
                              <ConfirmInline
                                tone="danger"
                                message={t('chat.deleteOneConfirm', { name: label })}
                                confirmLabel={t('common.delete')}
                                pending={deleting}
                                onConfirm={() => void removeOne(session.id)}
                                onCancel={() => setConfirmOne(null)}
                              />
                            )}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ))}
                {groups.length === 0 && listSearch.trim() !== '' && (
                  <p className="px-1 text-xs text-[var(--color-ink-faint)]">{t('chat.noSearchResults')}</p>
                )}
              </div>
```

- [ ] **Step 2: Add the four new i18n keys to all three dictionaries**

`de.ts`:
```typescript
  'chat.searchConversations': 'Unterhaltungen durchsuchen',
  'chat.noSearchResults': 'Keine Treffer.',
  'chat.groupToday': 'Heute',
  'chat.groupYesterday': 'Gestern',
  'chat.groupThisWeek': 'Diese Woche',
  'chat.groupOlder': 'Älter',
```
`en.ts`:
```typescript
  'chat.searchConversations': 'Search conversations',
  'chat.noSearchResults': 'No matches.',
  'chat.groupToday': 'Today',
  'chat.groupYesterday': 'Yesterday',
  'chat.groupThisWeek': 'This week',
  'chat.groupOlder': 'Older',
```
`fa.ts`:
```typescript
  'chat.searchConversations': 'جستجوی گفتگوها',
  'chat.noSearchResults': 'نتیجه‌ای یافت نشد.',
  'chat.groupToday': 'امروز',
  'chat.groupYesterday': 'دیروز',
  'chat.groupThisWeek': 'این هفته',
  'chat.groupOlder': 'قدیمی‌تر',
```

- [ ] **Step 3: i18n parity check, then full gate**

Run the parity check and the full gate command from Global Constraints.
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add web/src/pages/ChatsPage.tsx web/src/lib/i18n/de.ts web/src/lib/i18n/en.ts web/src/lib/i18n/fa.ts
git commit -m "Chat: group the conversation list by date and add a search field"
```

- [ ] **Step 5: Deploy and manually verify**

Confirm groups appear in the right order, a session with no `startedAt` lands in "Älter", and typing in the search field filters the visible list without touching the network.

---

## Phase 3: Right sidebar shell + ToDos tab

### Task 6: `todos` table migration

**Files:**
- Modify: `src/store/migrations.ts`

**Interfaces:**
- Consumes: nothing.
- Produces: a `todos` table (`id, session_id, text, done, pinned, created_at, updated_at`) that Task 7's `TodosRepo` reads and writes.

- [ ] **Step 1: Append migration version 3**

At the end of the `MIGRATIONS` array in `src/store/migrations.ts` (after the version-2 entry, before the closing `];`), add:

```typescript
  {
    version: 3,
    name: 'add todos',
    // Chat-scoped quick notes. Hermes has no such thing, same reasoning as
    // the prompt library: this is the control center's own data.
    sql: `
      CREATE TABLE todos (
        id          TEXT PRIMARY KEY,
        session_id  TEXT NOT NULL,
        text        TEXT NOT NULL,
        done        INTEGER NOT NULL DEFAULT 0,
        pinned      INTEGER NOT NULL DEFAULT 0,
        created_at  INTEGER NOT NULL,
        updated_at  INTEGER NOT NULL
      );
      CREATE INDEX todos_session_idx ON todos (session_id);
    `,
  },
```

- [ ] **Step 2: Verify `LATEST_VERSION` picks it up automatically**

Read the bottom of `migrations.ts` — `LATEST_VERSION` is `MIGRATIONS.reduce((highest, m) => Math.max(highest, m.version), 0)`, so no change needed there; confirm by inspection that this now evaluates to 3.

- [ ] **Step 3: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: no errors (no existing test asserts a fixed `LATEST_VERSION` number — confirm this by checking `src/store/store.test.ts` doesn't hardcode `2`; if it does, update that expectation as part of this step).

- [ ] **Step 4: Commit**

```bash
git add src/store/migrations.ts
git commit -m "Store: add the todos table migration"
```

---

### Task 7: `TodosRepo`

**Files:**
- Create: `src/store/todos.ts`
- Test: `src/store/todos.test.ts`

**Interfaces:**
- Consumes: `Store` (`src/store/db.js`).
- Produces:
  ```typescript
  export interface Todo {
    id: string;
    sessionId: string;
    text: string;
    done: boolean;
    pinned: boolean;
    createdAt: number;
    updatedAt: number;
  }
  export interface TodoInput { text: string }
  export class TodosRepo {
    constructor(store: Store);
    listForSession(sessionId: string): Todo[];
    create(sessionId: string, input: TodoInput, now?: number): Todo;
    setDone(id: string, done: boolean, now?: number): Todo | null;
    setPinned(id: string, pinned: boolean, now?: number): Todo | null;
    delete(id: string): boolean;
  }
  ```
  Task 9's routes call every one of these exactly as named.

- [ ] **Step 1: Write the failing test**

```typescript
import { describe, expect, it, beforeEach } from 'vitest';
import { Store } from './db.js';
import { TodosRepo } from './todos.js';

function memoryStore(): Store {
  return Store.open(':memory:');
}

describe('TodosRepo', () => {
  let repo: TodosRepo;

  beforeEach(() => {
    repo = new TodosRepo(memoryStore());
  });

  it('creates a todo scoped to a session', () => {
    const todo = repo.create('session-a', { text: '  Check logs  ' });
    expect(todo.text).toBe('Check logs');
    expect(todo.sessionId).toBe('session-a');
    expect(todo.done).toBe(false);
    expect(todo.pinned).toBe(false);
  });

  it('lists only todos for the given session, pinned first then newest first', () => {
    repo.create('session-a', { text: 'first' }, 1000);
    const second = repo.create('session-a', { text: 'second' }, 2000);
    repo.create('session-b', { text: 'other session' }, 3000);
    repo.setPinned(second.id, true);

    const list = repo.listForSession('session-a');
    expect(list.map((t) => t.text)).toEqual(['second', 'first']);
  });

  it('toggles done and pinned independently, bumping updatedAt', () => {
    const todo = repo.create('session-a', { text: 'x' }, 1000);
    const done = repo.setDone(todo.id, true, 2000);
    expect(done?.done).toBe(true);
    expect(done?.pinned).toBe(false);
    expect(done?.updatedAt).toBe(2000);
  });

  it('returns null from setDone/setPinned for a missing id', () => {
    expect(repo.setDone('missing', true)).toBeNull();
    expect(repo.setPinned('missing', true)).toBeNull();
  });

  it('deletes a todo and reports whether one existed', () => {
    const todo = repo.create('session-a', { text: 'x' });
    expect(repo.delete(todo.id)).toBe(true);
    expect(repo.delete(todo.id)).toBe(false);
    expect(repo.listForSession('session-a')).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npm test -- src/store/todos.test.ts`
Expected: FAIL — `src/store/todos.ts` does not exist.

- [ ] **Step 3: Write the implementation**

```typescript
import { randomUUID } from 'node:crypto';
import type { Store } from './db.js';

/** Quick notes scoped to one chat. Hermes has no such thing, same reasoning as the prompt library. */

export interface Todo {
  id: string;
  sessionId: string;
  text: string;
  done: boolean;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface TodoInput {
  text: string;
}

interface TodoRow {
  id: string;
  session_id: string;
  text: string;
  done: number;
  pinned: number;
  created_at: number;
  updated_at: number;
}

function toTodo(row: TodoRow): Todo {
  return {
    id: row.id,
    sessionId: row.session_id,
    text: row.text,
    done: row.done === 1,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export class TodosRepo {
  constructor(private readonly store: Store) {}

  listForSession(sessionId: string): Todo[] {
    return this.store
      .all<TodoRow>(
        'SELECT * FROM todos WHERE session_id = ? ORDER BY pinned DESC, created_at DESC',
        sessionId,
      )
      .map(toTodo);
  }

  private get(id: string): Todo | null {
    const row = this.store.get<TodoRow>('SELECT * FROM todos WHERE id = ?', id);
    return row ? toTodo(row) : null;
  }

  create(sessionId: string, input: TodoInput, now = Date.now()): Todo {
    const todo: Todo = {
      id: randomUUID(),
      sessionId,
      text: input.text.trim(),
      done: false,
      pinned: false,
      createdAt: now,
      updatedAt: now,
    };
    this.store.run(
      `INSERT INTO todos (id, session_id, text, done, pinned, created_at, updated_at)
       VALUES (?, ?, ?, 0, 0, ?, ?)`,
      todo.id,
      todo.sessionId,
      todo.text,
      todo.createdAt,
      todo.updatedAt,
    );
    return todo;
  }

  setDone(id: string, done: boolean, now = Date.now()): Todo | null {
    if (!this.get(id)) return null;
    this.store.run('UPDATE todos SET done = ?, updated_at = ? WHERE id = ?', done ? 1 : 0, now, id);
    return this.get(id);
  }

  setPinned(id: string, pinned: boolean, now = Date.now()): Todo | null {
    if (!this.get(id)) return null;
    this.store.run('UPDATE todos SET pinned = ?, updated_at = ? WHERE id = ?', pinned ? 1 : 0, now, id);
    return this.get(id);
  }

  delete(id: string): boolean {
    if (!this.get(id)) return false;
    this.store.run('DELETE FROM todos WHERE id = ?', id);
    return true;
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npm test -- src/store/todos.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/store/todos.ts src/store/todos.test.ts
git commit -m "Store: add TodosRepo"
```

---

### Task 8: Server routes for ToDos

**Files:**
- Modify: `src/routes/workspace.ts` (same file that registers `/api/prompts` — add alongside, it already imports `PromptsRepo` the same way and is named generically for "the control center's own data")

**Interfaces:**
- Consumes: `TodosRepo` (Task 7).
- Produces:
  - `GET /api/todos?sessionId=` → `{ todos: Todo[] }`
  - `POST /api/todos` body `{ sessionId, text }` → `201 { todo: Todo }`
  - `PUT /api/todos/:id` body `{ done?: boolean; pinned?: boolean }` → `{ todo: Todo }` or 404
  - `DELETE /api/todos/:id` → `{ ok: true }` or 404
  Task 9's client functions call these exact paths/shapes.

- [ ] **Step 1: Import `TodosRepo` and instantiate it**

In `src/routes/workspace.ts`, add to the imports (next to `PromptsRepo`):
```typescript
import { TodosRepo } from '../store/todos.js';
```
In `registerWorkspaceRoutes`, next to `const prompts = new PromptsRepo(ctx.store);` (line 41):
```typescript
  const todos = new TodosRepo(ctx.store);
```

- [ ] **Step 2: Add the schemas**

Next to `promptInputSchema`:
```typescript
const todoCreateSchema = z.object({
  sessionId: z.string().trim().min(1),
  text: z.string().trim().min(1).max(2000),
});

const todoUpdateSchema = z.object({
  done: z.boolean().optional(),
  pinned: z.boolean().optional(),
});
```

- [ ] **Step 3: Add the routes**

Add after the `/api/prompts/:id/use` handler (after line 83), before the "Workflows" section comment:

```typescript
  // --- ToDos -----------------------------------------------------------------

  app.get('/api/todos', async (request, reply) => {
    const query = request.query as { sessionId?: string } | undefined;
    const sessionId = query?.sessionId?.trim();
    if (!sessionId) return reply.code(400).send({ error: 'missing_session_id' });
    return { todos: todos.listForSession(sessionId) };
  });

  app.post('/api/todos', async (request, reply) => {
    const parsed = todoCreateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_todo',
        message: parsed.error.issues[0]?.message ?? 'invalid request',
      });
    }
    return reply
      .code(201)
      .send({ todo: todos.create(parsed.data.sessionId, { text: parsed.data.text }) });
  });

  app.put('/api/todos/:id', async (request, reply) => {
    const parsed = todoUpdateSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: 'invalid_todo',
        message: parsed.error.issues[0]?.message ?? 'invalid request',
      });
    }
    const { id } = request.params as { id: string };
    let updated = null;
    if (parsed.data.done !== undefined) updated = todos.setDone(id, parsed.data.done);
    if (parsed.data.pinned !== undefined) updated = todos.setPinned(id, parsed.data.pinned);
    if (!updated) return reply.code(404).send({ error: 'not_found' });
    return { todo: updated };
  });

  app.delete('/api/todos/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!todos.delete(id)) return reply.code(404).send({ error: 'not_found' });
    return { ok: true };
  });
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add src/routes/workspace.ts
git commit -m "Todos: add CRUD routes"
```

---

### Task 9: Frontend API client and types for ToDos

**Files:**
- Modify: `web/src/lib/hermesTypes.ts` (add `Todo`/`TodoInput` next to `Prompt`/`PromptInput`)
- Modify: `web/src/lib/api.ts` (add client functions + `queryKeys.todos`)

**Interfaces:**
- Consumes: nothing new.
- Produces: `getTodos(sessionId)`, `createTodo(sessionId, text)`, `setTodoDone(id, done)`, `setTodoPinned(id, pinned)`, `deleteTodo(id)`, `queryKeys.todos(sessionId)` — Task 10's `TodosPanel.tsx` calls all of these exactly as named.

- [ ] **Step 1: Add the types**

In `web/src/lib/hermesTypes.ts`, right after the `PromptInput` interface (line 225):

```typescript
export interface Todo {
  id: string;
  sessionId: string;
  text: string;
  done: boolean;
  pinned: boolean;
  createdAt: number;
  updatedAt: number;
}
```

- [ ] **Step 2: Add the API client functions**

In `web/src/lib/api.ts`, right after `recordPromptUse` (line 443), add:

```typescript
export const getTodos = (sessionId: string): Promise<{ todos: Todo[] }> =>
  apiRequest<{ todos: Todo[] }>(`/todos?sessionId=${encodeURIComponent(sessionId)}`);

export const createTodo = (sessionId: string, text: string): Promise<{ todo: Todo }> =>
  apiRequest<{ todo: Todo }>('/todos', { method: 'POST', ...jsonBody({ sessionId, text }) });

export const setTodoDone = (id: string, done: boolean): Promise<{ todo: Todo }> =>
  apiRequest<{ todo: Todo }>(`/todos/${encodeURIComponent(id)}`, {
    method: 'PUT',
    ...jsonBody({ done }),
  });

export const setTodoPinned = (id: string, pinned: boolean): Promise<{ todo: Todo }> =>
  apiRequest<{ todo: Todo }>(`/todos/${encodeURIComponent(id)}`, {
    method: 'PUT',
    ...jsonBody({ pinned }),
  });

export const deleteTodo = (id: string): Promise<{ ok: boolean }> =>
  apiRequest<{ ok: boolean }>(`/todos/${encodeURIComponent(id)}`, { method: 'DELETE' });
```

In the multi-line `import type { ... } from './hermesTypes';` block at the top of `api.ts` (lines 3-32), change:
```typescript
  Prompt,
  PromptInput,
```
to:
```typescript
  Prompt,
  PromptInput,
  Todo,
```

- [ ] **Step 3: Add the query key**

In the `queryKeys` object (next to `prompts: ['prompts'] as const,` at line 747):

```typescript
  todos: (sessionId: string) => ['todos', sessionId] as const,
```

- [ ] **Step 4: Typecheck**

Run: `npm run typecheck`
Expected: no errors.

- [ ] **Step 5: Commit**

```bash
git add web/src/lib/hermesTypes.ts web/src/lib/api.ts
git commit -m "Todos: add frontend API client and types"
```

---

### Task 10: `TodosPanel.tsx`

**Files:**
- Create: `web/src/components/TodosPanel.tsx`
- Modify: `web/src/lib/i18n/{de,en,fa}.ts`

**Interfaces:**
- Consumes: `getTodos`/`createTodo`/`setTodoDone`/`setTodoPinned`/`deleteTodo`/`queryKeys.todos` (Task 9).
- Produces: `<TodosPanel sessionId={string} />` — Task 11 mounts it inside `ChatSidebar.tsx`. Exports a `TodosPanelHandle` ref type with `prefillAndFocus(text: string): void`, used by Task 15's message→ToDo action.

- [ ] **Step 1: Write the component**

```typescript
import { forwardRef, useImperativeHandle, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Pin, Plus, Trash2 } from 'lucide-react';
import {
  createTodo,
  deleteTodo,
  getTodos,
  queryKeys,
  setTodoDone,
  setTodoPinned,
} from '@/lib/api';
import { SkeletonText } from '@/components/Skeleton';
import { useToast } from '@/components/Toast';
import { useI18n } from '@/lib/i18n';

export interface TodosPanelHandle {
  /** Fills the quick-add field with the given text and focuses it, without saving. */
  prefillAndFocus: (text: string) => void;
}

export const TodosPanel = forwardRef<TodosPanelHandle, { sessionId: string | null }>(
  function TodosPanel({ sessionId }, ref) {
    const { t } = useI18n();
    const toast = useToast();
    const queryClient = useQueryClient();
    const [draft, setDraft] = useState('');
    const inputRef = useRef<HTMLInputElement | null>(null);

    useImperativeHandle(ref, () => ({
      prefillAndFocus: (text: string) => {
        setDraft(text.length > 200 ? `${text.slice(0, 200)}…` : text);
        inputRef.current?.focus();
      },
    }));

    const todos = useQuery({
      queryKey: queryKeys.todos(sessionId ?? ''),
      queryFn: () => getTodos(sessionId ?? ''),
      enabled: sessionId !== null,
    });

    const invalidate = () =>
      queryClient.invalidateQueries({ queryKey: queryKeys.todos(sessionId ?? '') });
    const fail = (error: Error) =>
      toast.push({ tone: 'error', title: t('todos.actionFailed'), description: error.message });

    const add = useMutation({
      mutationFn: (text: string) => createTodo(sessionId ?? '', text),
      onSuccess: async () => {
        setDraft('');
        await invalidate();
      },
      onError: fail,
    });

    const toggleDone = useMutation({
      mutationFn: ({ id, done }: { id: string; done: boolean }) => setTodoDone(id, done),
      onSuccess: invalidate,
      onError: fail,
    });

    const togglePinned = useMutation({
      mutationFn: ({ id, pinned }: { id: string; pinned: boolean }) => setTodoPinned(id, pinned),
      onSuccess: invalidate,
      onError: fail,
    });

    const remove = useMutation({
      mutationFn: (id: string) => deleteTodo(id),
      onSuccess: invalidate,
      onError: fail,
    });

    if (sessionId === null) {
      return <p className="p-3 text-xs text-[var(--color-ink-muted)]">{t('todos.needsSession')}</p>;
    }

    const list = todos.data?.todos ?? [];

    return (
      <div className="flex h-full flex-col p-3">
        <form
          className="flex items-center gap-1.5"
          onSubmit={(event) => {
            event.preventDefault();
            const text = draft.trim();
            if (text === '' || add.isPending) return;
            add.mutate(text);
          }}
        >
          <input
            ref={inputRef}
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder={t('todos.quickAddPlaceholder')}
            className="min-w-0 flex-1 rounded-lg border border-[var(--color-hairline)] bg-[var(--color-base)] px-2 py-1.5 text-xs outline-none focus-visible:border-[var(--color-accent)]"
          />
          <button
            type="submit"
            disabled={draft.trim() === '' || add.isPending}
            aria-label={t('todos.add')}
            className="shrink-0 rounded-lg border border-[var(--color-accent)]/40 bg-[var(--color-accent)]/10 p-1.5 text-[var(--color-accent)] disabled:opacity-40"
          >
            <Plus size={13} aria-hidden />
          </button>
        </form>

        <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
          {todos.isPending ? (
            <SkeletonText lines={4} />
          ) : list.length === 0 ? (
            <p className="px-1 text-xs text-[var(--color-ink-faint)]">{t('todos.empty')}</p>
          ) : (
            <ul className="space-y-1">
              {list.map((todo) => (
                <li key={todo.id} className="group flex items-start gap-1.5">
                  <input
                    type="checkbox"
                    checked={todo.done}
                    onChange={(event) => toggleDone.mutate({ id: todo.id, done: event.target.checked })}
                    className="mt-1 size-3.5 shrink-0"
                  />
                  <span
                    className={`min-w-0 flex-1 text-xs ${
                      todo.done ? 'text-[var(--color-ink-faint)] line-through' : 'text-[var(--color-ink)]'
                    }`}
                  >
                    {todo.text}
                  </span>
                  <button
                    type="button"
                    onClick={() => togglePinned.mutate({ id: todo.id, pinned: !todo.pinned })}
                    title={todo.pinned ? t('todos.unpin') : t('todos.pin')}
                    aria-label={todo.pinned ? t('todos.unpin') : t('todos.pin')}
                    className={`shrink-0 rounded p-0.5 ${
                      todo.pinned
                        ? 'text-[var(--color-accent)]'
                        : 'text-[var(--color-ink-faint)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-ink)]'
                    }`}
                  >
                    <Pin size={11} aria-hidden fill={todo.pinned ? 'currentColor' : 'none'} />
                  </button>
                  <button
                    type="button"
                    onClick={() => remove.mutate(todo.id)}
                    title={t('common.delete')}
                    aria-label={`${t('common.delete')} ${todo.text}`}
                    className="shrink-0 rounded p-0.5 text-[var(--color-ink-faint)] opacity-0 group-hover:opacity-100 hover:text-[var(--color-danger)]"
                  >
                    <Trash2 size={11} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    );
  },
);
```

- [ ] **Step 2: Add i18n keys**

`de.ts`:
```typescript
  'todos.quickAddPlaceholder': 'ToDo hinzufügen …',
  'todos.add': 'Hinzufügen',
  'todos.empty': 'Noch keine ToDos.',
  'todos.pin': 'Anpinnen',
  'todos.unpin': 'Lösen',
  'todos.actionFailed': 'Aktion fehlgeschlagen',
  'todos.needsSession': 'Erst eine Unterhaltung öffnen oder starten.',
```
`en.ts`:
```typescript
  'todos.quickAddPlaceholder': 'Add a to-do …',
  'todos.add': 'Add',
  'todos.empty': 'No to-dos yet.',
  'todos.pin': 'Pin',
  'todos.unpin': 'Unpin',
  'todos.actionFailed': 'Action failed',
  'todos.needsSession': 'Open or start a conversation first.',
```
`fa.ts`:
```typescript
  'todos.quickAddPlaceholder': 'افزودن کار جدید …',
  'todos.add': 'افزودن',
  'todos.empty': 'هنوز کاری ثبت نشده.',
  'todos.pin': 'سنجاق کردن',
  'todos.unpin': 'برداشتن سنجاق',
  'todos.actionFailed': 'عملیات ناموفق بود',
  'todos.needsSession': 'اول یک گفتگو را باز یا شروع کنید.',
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: no errors (this component isn't mounted anywhere yet, so no visual check possible until Task 11).

- [ ] **Step 4: Commit**

```bash
git add web/src/components/TodosPanel.tsx web/src/lib/i18n/de.ts web/src/lib/i18n/en.ts web/src/lib/i18n/fa.ts
git commit -m "Todos: add the TodosPanel component"
```

---

### Task 11: `ChatSidebar.tsx` shell and wiring into `ChatsPage.tsx`

**Files:**
- Create: `web/src/components/ChatSidebar.tsx`
- Modify: `web/src/pages/ChatsPage.tsx` (layout, around lines 461-463 and 654-817)
- Modify: `web/src/lib/i18n/{de,en,fa}.ts`

**Interfaces:**
- Consumes: `TodosPanel`/`TodosPanelHandle` (Task 10). `WorkspaceBrowser` (Task 12 — until that task lands, render a placeholder `<div>` for the Workspace tab; Task 13 replaces it).
- Produces: `<ChatSidebar sessionId={string | null} todosPanelRef={Ref<TodosPanelHandle>} />` with its own open/collapsed and active-tab state persisted to `localStorage`. Task 15 reads `todosPanelRef` to prefill a ToDo from a message.

- [ ] **Step 1: Write `ChatSidebar.tsx`** (Workspace tab is a placeholder until Task 13)

```typescript
import { useState, type Ref } from 'react';
import { ChevronLeft, ChevronRight, FolderOpen, ListTodo } from 'lucide-react';
import { TodosPanel, type TodosPanelHandle } from '@/components/TodosPanel';
import { useI18n } from '@/lib/i18n';

type SidebarTab = 'todos' | 'workspace';

const OPEN_KEY = 'hcc.chatSidebar.open';
const TAB_KEY = 'hcc.chatSidebar.tab';

function readStoredOpen(): boolean {
  return localStorage.getItem(OPEN_KEY) !== 'false';
}

function readStoredTab(): SidebarTab {
  return localStorage.getItem(TAB_KEY) === 'workspace' ? 'workspace' : 'todos';
}

export function ChatSidebar({
  sessionId,
  todosPanelRef,
}: {
  sessionId: string | null;
  todosPanelRef: Ref<TodosPanelHandle>;
}) {
  const { t } = useI18n();
  const [open, setOpen] = useState(readStoredOpen);
  const [tab, setTab] = useState<SidebarTab>(readStoredTab);

  const setOpenPersist = (value: boolean) => {
    setOpen(value);
    localStorage.setItem(OPEN_KEY, String(value));
  };
  const setTabPersist = (value: SidebarTab) => {
    setTab(value);
    localStorage.setItem(TAB_KEY, value);
  };

  if (!open) {
    return (
      <div className="flex w-10 shrink-0 flex-col items-center gap-2 pt-1">
        <button
          type="button"
          onClick={() => setOpenPersist(true)}
          title={t('chatSidebar.expand')}
          aria-label={t('chatSidebar.expand')}
          className="rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
        >
          <ChevronLeft size={14} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            setTabPersist('todos');
            setOpenPersist(true);
          }}
          title={t('chatSidebar.todos')}
          aria-label={t('chatSidebar.todos')}
          className="rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
        >
          <ListTodo size={16} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            setTabPersist('workspace');
            setOpenPersist(true);
          }}
          title={t('chatSidebar.workspace')}
          aria-label={t('chatSidebar.workspace')}
          className="rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
        >
          <FolderOpen size={16} aria-hidden />
        </button>
      </div>
    );
  }

  return (
    <aside className="hidden w-72 shrink-0 flex-col rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-base)] lg:flex">
      <div className="flex items-center gap-1 border-b border-[var(--color-hairline)] p-2">
        <button
          type="button"
          onClick={() => setTabPersist('todos')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors ${
            tab === 'todos'
              ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
              : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
          }`}
        >
          <ListTodo size={13} aria-hidden />
          {t('chatSidebar.todos')}
        </button>
        <button
          type="button"
          onClick={() => setTabPersist('workspace')}
          className={`flex flex-1 items-center justify-center gap-1.5 rounded-lg px-2 py-1.5 text-xs transition-colors ${
            tab === 'workspace'
              ? 'bg-[var(--color-accent)]/10 text-[var(--color-accent)]'
              : 'text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]'
          }`}
        >
          <FolderOpen size={13} aria-hidden />
          {t('chatSidebar.workspace')}
        </button>
        <button
          type="button"
          onClick={() => setOpenPersist(false)}
          title={t('chatSidebar.collapse')}
          aria-label={t('chatSidebar.collapse')}
          className="shrink-0 rounded-lg p-1.5 text-[var(--color-ink-faint)] hover:text-[var(--color-ink)]"
        >
          <ChevronRight size={14} aria-hidden />
        </button>
      </div>
      <div className="min-h-0 flex-1">
        {tab === 'todos' ? (
          <TodosPanel ref={todosPanelRef} sessionId={sessionId} />
        ) : (
          <div className="p-3 text-xs text-[var(--color-ink-muted)]">
            {/* Placeholder — replaced by WorkspaceBrowser in Task 13. */}
            {t('chatSidebar.workspaceComingSoon')}
          </div>
        )}
      </div>
    </aside>
  );
}
```

- [ ] **Step 2: Mount it in `ChatsPage.tsx`**

Add the import: `import { ChatSidebar } from '@/components/ChatSidebar';` and `import type { TodosPanelHandle } from '@/components/TodosPanel';` and `useRef` is already imported.

Add a ref next to `threadRef`/`inputRef` (around line 98):
```typescript
  const todosPanelRef = useRef<TodosPanelHandle>(null);
```

Change the outer layout `<div className="flex h-[calc(100vh-11rem)] gap-4">` (line 463) to close after the thread `<div>` and add the sidebar as a third flex child. Concretely, find the closing of the thread column:

```tsx
        </div>
      </div>
    </PageShell>
  );
```

(the end of the component, lines 816-819) and change it to:

```tsx
        </div>

        <ChatSidebar sessionId={sessionId} todosPanelRef={todosPanelRef} />
      </div>
    </PageShell>
  );
```

- [ ] **Step 3: Add i18n keys**

`de.ts`:
```typescript
  'chatSidebar.todos': 'ToDos',
  'chatSidebar.workspace': 'Workspace',
  'chatSidebar.collapse': 'Seitenleiste einklappen',
  'chatSidebar.expand': 'Seitenleiste ausklappen',
  'chatSidebar.workspaceComingSoon': 'Wird noch angebunden.',
```
`en.ts`:
```typescript
  'chatSidebar.todos': 'ToDos',
  'chatSidebar.workspace': 'Workspace',
  'chatSidebar.collapse': 'Collapse sidebar',
  'chatSidebar.expand': 'Expand sidebar',
  'chatSidebar.workspaceComingSoon': 'Not wired up yet.',
```
`fa.ts`:
```typescript
  'chatSidebar.todos': 'کارها',
  'chatSidebar.workspace': 'فضای کاری',
  'chatSidebar.collapse': 'جمع کردن نوار کناری',
  'chatSidebar.expand': 'باز کردن نوار کناری',
  'chatSidebar.workspaceComingSoon': 'هنوز متصل نشده.',
```

- [ ] **Step 4: i18n parity check, then full gate**

Run both commands from Global Constraints.
Expected: all green.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ChatSidebar.tsx web/src/pages/ChatsPage.tsx web/src/lib/i18n/de.ts web/src/lib/i18n/en.ts web/src/lib/i18n/fa.ts
git commit -m "Chat: add the collapsible sidebar shell with a working ToDos tab"
```

- [ ] **Step 6: Deploy and manually verify**

Confirm: sidebar collapses/expands and remembers state across a reload; ToDos tab adds, checks off, pins, and deletes items scoped to the open conversation; opening a different conversation shows that conversation's own ToDos.

---

## Phase 4: Workspace tab

### Task 12: Extract `WorkspaceBrowser.tsx` from `WorkspacePage.tsx`

**Files:**
- Create: `web/src/components/WorkspaceBrowser.tsx`
- Modify: `web/src/pages/WorkspacePage.tsx` (becomes a thin wrapper)

**Interfaces:**
- Consumes: everything `WorkspacePage.tsx` already imports from `@/lib/api` (`createWorkspaceDirectory`, `deleteWorkspaceEntry`, `getWorkspaceRoot`, `listWorkspace`, `queryKeys`, `readWorkspaceFile`, `writeWorkspaceFile`) — no new API surface.
- Produces: `<WorkspaceBrowser compact={boolean} />`. `compact` collapses the two-pane grid (list + file editor side by side) into a single pane that shows either the list or the open file, with a back button — a 22rem list pane doesn't fit a ~17rem sidebar tab. Task 13 renders `<WorkspaceBrowser compact />`; `WorkspacePage.tsx` renders `<WorkspaceBrowser compact={false} />` (unchanged visual behavior for the full page).

- [ ] **Step 1: Move the entire component body into the new file**

Copy `web/src/pages/WorkspacePage.tsx` verbatim into `web/src/components/WorkspaceBrowser.tsx`, then apply these changes to the copy:

1. Rename the exported function from `WorkspacePage` to `WorkspaceBrowser`, and change its props from none to `{ compact = false }: { compact?: boolean }`.
2. Remove the `<PageShell title={...} description={...} actions={...} wide>` wrapper and its matching closing `</PageShell>` — `WorkspaceBrowser` returns a `<div>` (or `<>...</>`) directly; move the "new file/folder" button (currently the `actions` prop of `PageShell`, lines 180-189) to sit above the file list instead, since there's no page header to attach it to in compact mode.
3. Replace the two-pane grid (`<div className="grid gap-4 lg:grid-cols-[22rem_1fr]">`, lines 264-419) with:

```tsx
      <div className={compact ? 'flex min-h-0 flex-1 flex-col' : 'grid gap-4 lg:grid-cols-[22rem_1fr]'}>
        {(!compact || openFile === null) && (
          <div className={compact ? 'min-h-0 flex-1 overflow-y-auto' : 'card p-2'}>
            {/* ...existing list <ul> block, unchanged... */}
          </div>
        )}

        {(!compact || openFile !== null) && (
          <div className={compact ? 'flex min-h-0 flex-1 flex-col p-2' : 'card min-h-[20rem] p-4'}>
            {compact && openFile !== null && (
              <button
                type="button"
                onClick={() => showFile(null)}
                className="mb-2 self-start text-xs text-[var(--color-ink-muted)] hover:text-[var(--color-ink)]"
              >
                ← {t('workspace.up')}
              </button>
            )}
            {/* ...existing file-view/editor block, unchanged... */}
          </div>
        )}
      </div>
```

   (The two `{/* ...unchanged... */}` markers above mean: paste the existing inner JSX for the list `<ul>` block and the file-view/editor block exactly as they are today — this step only changes the two wrapping `<div>`s and adds the compact-mode conditionals and back button around content that doesn't otherwise change.)

4. In compact mode the "new file/folder" `creating` panel and the root path bar (lines 192-202, 209-262) still render — keep them, just above the pane div from step 3, in both modes.

- [ ] **Step 2: Rewrite `WorkspacePage.tsx` as a thin wrapper**

Replace the entire contents of `web/src/pages/WorkspacePage.tsx` with:

```typescript
import { WorkspaceBrowser } from '@/components/WorkspaceBrowser';
import { PageShell } from '@/components/PageShell';
import { useI18n } from '@/lib/i18n';

export function WorkspacePage() {
  const { t } = useI18n();
  return (
    <PageShell title={t('nav.workspace')} description={t('page.workspace.desc')} wide>
      <WorkspaceBrowser />
    </PageShell>
  );
}
```

(The "new file/folder" button that used to live in `PageShell`'s `actions` prop now renders inside `WorkspaceBrowser` itself per Step 1.2 — visually it moves from the page header to just above the file list. This is a deliberate, minor layout change needed to make the component `PageShell`-independent; note it when verifying in Step 4.)

- [ ] **Step 3: Typecheck and full gate**

Run: `npm run typecheck && npm run lint && npm run format:check && npm test && npm run build`
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/WorkspaceBrowser.tsx web/src/pages/WorkspacePage.tsx
git commit -m "Workspace: extract WorkspaceBrowser so it can be reused in the chat sidebar"
```

- [ ] **Step 5: Deploy and manually verify**

Confirm the full Workspace page (`/workspace`) behaves exactly as before: browsing, opening a file, editing, saving, creating a file/folder, deleting — the only visible difference should be the "new file/folder" button moving from the page's top-right to just above the file list.

---

### Task 13: Wire `WorkspaceBrowser` into the sidebar's Workspace tab

**Files:**
- Modify: `web/src/components/ChatSidebar.tsx`
- Modify: `web/src/lib/i18n/{de,en,fa}.ts` (drop the now-unused `chatSidebar.workspaceComingSoon` key)

**Interfaces:**
- Consumes: `WorkspaceBrowser` (Task 12).
- Produces: nothing new consumed elsewhere.

- [ ] **Step 1: Replace the placeholder**

In `ChatSidebar.tsx`, add the import: `import { WorkspaceBrowser } from '@/components/WorkspaceBrowser';`. Replace:

```tsx
          <div className="p-3 text-xs text-[var(--color-ink-muted)]">
            {/* Placeholder — replaced by WorkspaceBrowser in Task 13. */}
            {t('chatSidebar.workspaceComingSoon')}
          </div>
```

with:

```tsx
          <WorkspaceBrowser compact />
```

- [ ] **Step 2: Remove the now-unused i18n key**

Delete the `'chatSidebar.workspaceComingSoon'` line from all three of `web/src/lib/i18n/{de,en,fa}.ts`.

- [ ] **Step 3: i18n parity check, then full gate**

Run both from Global Constraints.
Expected: all green.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/ChatSidebar.tsx web/src/lib/i18n/de.ts web/src/lib/i18n/en.ts web/src/lib/i18n/fa.ts
git commit -m "Chat: wire the real Workspace browser into the sidebar's second tab"
```

- [ ] **Step 5: Deploy and manually verify**

Confirm: Workspace tab lists the same root as `/workspace`; creating, editing, and deleting a file from the sidebar shows up if you separately open the full Workspace page (same backend, same root); the compact single-pane behavior (list ↔ file view with a back button) works at the sidebar's width.

---

## Phase 5: Extras

### Task 14: Auto-scroll lock

**Files:**
- Modify: `web/src/pages/ChatsPage.tsx` (the scroll effect around lines 100-103, the thread container around line 724)
- Modify: `web/src/lib/i18n/{de,en,fa}.ts`

**Interfaces:**
- Consumes: `threadRef` (already exists).
- Produces: nothing consumed elsewhere.

- [ ] **Step 1: Track whether the thread is scrolled to bottom**

Add state next to `[messages, setMessages]` (around line 46):

```typescript
  const [nearBottom, setNearBottom] = useState(true);
```

- [ ] **Step 2: Replace the unconditional auto-scroll effect**

Replace the existing effect (lines 100-103):

```typescript
  // Keep the newest message in view as tokens arrive.
  useEffect(() => {
    threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, streaming]);
```

with:

```typescript
  // Only follow new content when the user was already at the bottom — reading
  // older history should not get yanked to the newest message.
  useEffect(() => {
    if (nearBottom) threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight });
  }, [messages, streaming, nearBottom]);

  const handleThreadScroll = () => {
    const el = threadRef.current;
    if (!el) return;
    setNearBottom(el.scrollHeight - el.scrollTop - el.clientHeight < 80);
  };
```

- [ ] **Step 3: Add the scroll handler and the jump button**

Add `onScroll={handleThreadScroll}` to the thread `<div ref={threadRef} ...>` (line 724-727):

```tsx
              <div
                ref={threadRef}
                onScroll={handleThreadScroll}
                className="relative min-h-0 flex-1 space-y-3 overflow-y-auto rounded-2xl border border-[var(--color-hairline)] bg-[var(--color-base)] p-4"
              >
```

Add the jump button as the last child inside that same div, right before its closing `</div>` (around line 778):

```tsx
                {!nearBottom && messages.length > 0 && (
                  <button
                    type="button"
                    onClick={() => {
                      threadRef.current?.scrollTo({ top: threadRef.current.scrollHeight, behavior: 'smooth' });
                      setNearBottom(true);
                    }}
                    className="sticky bottom-2 left-1/2 -translate-x-1/2 rounded-full border border-[var(--color-hairline)] bg-[var(--color-raised)] px-3 py-1.5 text-xs text-[var(--color-ink-muted)] shadow-[var(--shadow-card)] hover:text-[var(--color-ink)]"
                  >
                    ↓ {t('chat.newMessageJump')}
                  </button>
                )}
```

- [ ] **Step 4: Add the i18n key**

`de.ts`: `'chat.newMessageJump': 'Neue Nachricht',`
`en.ts`: `'chat.newMessageJump': 'New message',`
`fa.ts`: `'chat.newMessageJump': 'پیام جدید',`

- [ ] **Step 5: i18n parity check, then full gate**

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/ChatsPage.tsx web/src/lib/i18n/de.ts web/src/lib/i18n/en.ts web/src/lib/i18n/fa.ts
git commit -m "Chat: stop yanking the scroll position when reading older messages"
```

- [ ] **Step 7: Deploy and manually verify**

Scroll up while a reply is streaming in — the view should stay put and a "New message" pill should appear; clicking it (or scrolling back down manually) should resume auto-follow.

---

### Task 15: Message → ToDo

**Files:**
- Modify: `web/src/pages/ChatsPage.tsx` (message bubble rendering, lines 744-777; pass `todosPanelRef` and sidebar-open/tab setters down — this requires lifting the sidebar's open/tab state up, see Step 1)
- Modify: `web/src/components/ChatSidebar.tsx` (expose an imperative `openTodosTab()` via `forwardRef`)
- Modify: `web/src/lib/i18n/{de,en,fa}.ts`

**Interfaces:**
- Consumes: `TodosPanelHandle.prefillAndFocus` (Task 10), `ChatSidebar` (Task 11/13).
- Produces: nothing consumed elsewhere — this is the last task.

- [ ] **Step 1: Give `ChatSidebar` an imperative handle to switch to ToDos and focus it**

In `ChatSidebar.tsx`, convert the component to `forwardRef` so `ChatsPage.tsx` can force the tab open:

```typescript
import { forwardRef, useImperativeHandle, useState, type Ref } from 'react';
```

Change the function signature:

```typescript
export interface ChatSidebarHandle {
  openTodosTab: () => void;
}

export const ChatSidebar = forwardRef<
  ChatSidebarHandle,
  { sessionId: string | null; todosPanelRef: Ref<TodosPanelHandle> }
>(function ChatSidebar({ sessionId, todosPanelRef }, ref) {
  const { t } = useI18n();
  const [open, setOpen] = useState(readStoredOpen);
  const [tab, setTab] = useState<SidebarTab>(readStoredTab);

  const setOpenPersist = (value: boolean) => {
    setOpen(value);
    localStorage.setItem(OPEN_KEY, String(value));
  };
  const setTabPersist = (value: SidebarTab) => {
    setTab(value);
    localStorage.setItem(TAB_KEY, value);
  };

  useImperativeHandle(ref, () => ({
    openTodosTab: () => {
      setTabPersist('todos');
      setOpenPersist(true);
    },
  }));

  // ...rest of the function body is unchanged (the `if (!open) {...}` branch
  // and the final `return (...)` below it stay exactly as they are)...
});
```

(Everything after the `useImperativeHandle` call — the collapsed-rail branch and the full `<aside>` return — is unchanged from Task 11/13; only the function declaration, the new `ChatSidebarHandle` interface, and the `useImperativeHandle` call are new.)

- [ ] **Step 2: Wire the ref in `ChatsPage.tsx`**

Add the import: `import { ChatSidebar, type ChatSidebarHandle } from '@/components/ChatSidebar';` (replacing the old plain import). Add a ref next to `todosPanelRef`:

```typescript
  const chatSidebarRef = useRef<ChatSidebarHandle>(null);
```

Pass it to the sidebar: change `<ChatSidebar sessionId={sessionId} todosPanelRef={todosPanelRef} />` to `<ChatSidebar ref={chatSidebarRef} sessionId={sessionId} todosPanelRef={todosPanelRef} />`.

Add a handler function near `send` (before the `return`):

```typescript
  const sendToTodos = (text: string) => {
    chatSidebarRef.current?.openTodosTab();
    // The panel only mounts its ToDos tab content once open — the ref call
    // above triggers that synchronously in React's commit phase, so this
    // runs after the tab (and thus the input) exists.
    requestAnimationFrame(() => todosPanelRef.current?.prefillAndFocus(text));
  };
```

- [ ] **Step 3: Add the hover button to each message bubble**

Modify the message-rendering block (lines 744-777). The bubble's outer `<div>` needs `group` added for hover-reveal, and a button needs to sit next to the bubble:

```tsx
                  messages.map((message, index) => {
                    const isUser = message.role === 'user';
                    const time = formatTime(message.timestamp);
                    return (
                      <div
                        key={index}
                        className={`group flex flex-col ${isUser ? 'items-end' : 'items-start'}`}
                      >
                        <div className="flex max-w-[80%] items-end gap-1.5">
                          {!isUser && (
                            <button
                              type="button"
                              onClick={() => sendToTodos(message.text)}
                              title={t('chat.addToTodos')}
                              aria-label={t('chat.addToTodos')}
                              className="mb-1 shrink-0 rounded-md p-1 text-[var(--color-ink-faint)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--color-accent)]"
                            >
                              <ListPlus size={12} aria-hidden />
                            </button>
                          )}
                          <div
                            className={`rounded-2xl px-3.5 py-2 text-sm ${
                              isUser
                                ? 'rounded-br-md bg-[var(--color-accent)]/15 text-[var(--color-ink)] whitespace-pre-wrap'
                                : 'rounded-bl-md border border-[var(--color-hairline)] bg-[var(--color-raised)] text-[var(--color-ink)]'
                            }`}
                          >
                            {message.text ? (
                              isUser ? (
                                message.text
                              ) : (
                                <ChatMarkdown text={message.text} />
                              )
                            ) : (
                              <TypingDots />
                            )}
                          </div>
                          {isUser && (
                            <button
                              type="button"
                              onClick={() => sendToTodos(message.text)}
                              title={t('chat.addToTodos')}
                              aria-label={t('chat.addToTodos')}
                              className="mb-1 shrink-0 rounded-md p-1 text-[var(--color-ink-faint)] opacity-0 transition-opacity group-hover:opacity-100 hover:text-[var(--color-accent)]"
                            >
                              <ListPlus size={12} aria-hidden />
                            </button>
                          )}
                        </div>
                        {time && (
                          <span className="mt-1 px-1 text-[0.65rem] text-[var(--color-ink-faint)]">
                            {time}
                          </span>
                        )}
                      </div>
                    );
                  })
```

In `ChatsPage.tsx`, change the `lucide-react` import line (as left by Task 5's edit) from:
```typescript
import { CheckSquare, MessagesSquare, Paperclip, Pin, Plus, Search, Send, Square, Trash2 } from 'lucide-react';
```
to:
```typescript
import { CheckSquare, ListPlus, MessagesSquare, Paperclip, Pin, Plus, Search, Send, Square, Trash2 } from 'lucide-react';
```

- [ ] **Step 4: Add the i18n key**

`de.ts`: `'chat.addToTodos': 'Als ToDo übernehmen',`
`en.ts`: `'chat.addToTodos': 'Add as a to-do',`
`fa.ts`: `'chat.addToTodos': 'افزودن به کارها',`

- [ ] **Step 5: i18n parity check, then full gate**

Expected: all green.

- [ ] **Step 6: Commit**

```bash
git add web/src/pages/ChatsPage.tsx web/src/components/ChatSidebar.tsx web/src/lib/i18n/de.ts web/src/lib/i18n/en.ts web/src/lib/i18n/fa.ts
git commit -m "Chat: add a hover action to turn a message into a ToDo"
```

- [ ] **Step 7: Deploy and manually verify — this closes out the whole feature batch**

Hover a message, click the new icon, confirm the sidebar opens (if collapsed) on the ToDos tab with the message text pre-filled and the input focused, edit it, press Enter, confirm it appears in the list scoped to that conversation.

---

## Final check across the whole batch

- [ ] Re-read the spec (`docs/superpowers/specs/2026-08-03-chat-area-optimizations-design.md`) once more against the five phases above — confirm every numbered section (1–4 plus the four extras) has a task.
- [ ] Run the full gate one last time from a clean checkout state: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`.
- [ ] Confirm `git log --oneline -20` shows one commit per task, nothing squashed or skipped.
