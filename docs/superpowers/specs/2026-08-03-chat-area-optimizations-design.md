# Chat area optimizations — design

**Status:** approved, pending implementation plan
**Scope:** `web/src/pages/ChatsPage.tsx` and its supporting server routes/store only. The Telegram page's chat view is explicitly out of scope for this round.

## Why

The Chats page has been functionally complete for a while (session list, live streaming, markdown rendering, timestamps), but three gaps came up in use:

1. No way to give the agent a file to look at — every other Hermes web UI supports this.
2. The conversation list is a flat list with only hover states; nothing groups or separates entries, so a long history reads as one undifferentiated column.
3. There's no quick place to jot a note or reach into the workspace without leaving the chat — both require a full page navigation today.

## Out of scope (explicit)

- The Telegram page's "continue here" chat view keeps its current layout. Same sidebar could be added later as its own change.
- `/api/files/upload` / `/api/files/download` (the general workspace upload/download pair) remain unused, per the earlier decision in `docs/HANDOFF.md` §24. This spec does not touch that decision — file attachments here use a different, chat-native Hermes mechanism (see below).
- Message-level hover actions (copy, regenerate) — considered, not selected for this round.

## 1. File attachments

### Mechanism

Hermes's gateway exposes a JSON-RPC method, `file.attach`, purpose-built for this (verified in `/usr/local/lib/hermes-agent/tui_gateway/server.py`):

```
file.attach params:
  session_id (str, required) — the LIVE session id (prompt.submit's id, not the stored row id)
  path (str, optional)       — client/host path, used for naming
  data_url (str)             — "data:<mime>;base64,<b64>" — required when the browser
                                is the only place the bytes exist (always true for us)
  name (str, optional)       — preferred filename

returns:
  { attached: true, name, path, ref_path, ref_text: "@file:<ref_path>" }
```

The server stages the bytes into the session's `.hermes/desktop-attachments/` directory and hands back a `@file:` token. Embedding that token in the next `prompt.submit` text is what makes the agent's file tools (and `agent.context_references`) pick it up — this is the same path Hermes's own desktop client uses, not a new integration surface.

Only works once a session has a live id (i.e., after the first message in a conversation resumes/creates it on the gateway) — matches the existing constraint that `prompt.submit` itself has.

### Server

New route, `POST /api/chat/attach`:
- body: `{ liveId: string, dataUrl: string, name: string }`
- calls `ctx.gateway.request('file.attach', { session_id: liveId, data_url: dataUrl, name })`
- returns `{ name, refText }` (the two fields the frontend needs)
- Errors (no live session, oversized payload, gateway timeout) surface the same way other gateway-backed routes already do (`UpstreamError` → `gateway_error` JSON).

Size limit: reject anything above 10 MB client-side before encoding (matches Fastify's default body limit headroom) with a toast — no server-side streaming upload needed at this scale.

### Frontend

- Paperclip button in the compose row + drag-and-drop onto the message thread.
- Selecting/dropping a file adds a **chip** above the textarea: filename, size, a remove (×) button. Multiple chips stack; no attachment preview thumbnails (keeps this simple — the agent, not the browser, is the audience).
- On send: for each pending chip, call `/api/chat/attach`, collect the returned `ref_text`s, prepend them to the outgoing prompt text (one line per attachment, then a blank line, then the user's typed text) before calling the existing send path. Chips clear after a successful send; a failed attach keeps the chip and shows a toast, message is not sent.
- Requires a live session — if none exists yet (brand new, unsent conversation), the attach call waits for the same resume-on-first-send flow `send()` already does, then proceeds. If that resume fails, the attachment error surfaces the same as a send failure.

## 2. Conversation list — grouping and separation

- Sessions grouped into **Heute / Gestern / Diese Woche / Älter** (existing `startedAt`/`lastActive` timestamp, compared against local midnight boundaries — reuse `formatRelativeTime`'s locale handling for consistency, add a small `groupByRecency()` pure function, unit-tested).
- Each group gets a small sticky-ish label (`text-[0.65rem] uppercase text-[var(--color-ink-faint)]`, matching the existing faint-label convention elsewhere in the app) and a bit more vertical gap between groups than between items within a group (tight within, generous between — the project's own spacing principle already documented in HANDOFF for other areas).
- Search field above the list, filters the already-loaded session list client-side by title/preview substring (no new endpoint — the data's already fetched). Empty-result state reuses the existing empty-state pattern (icon + one line).

## 3. Right sidebar

New component `web/src/components/shell/ChatSidebar.tsx` (or under `web/src/pages/` alongside ChatsPage — final placement is an implementation-plan call, not a design one). Collapsible: a slim rail with two icon tabs when collapsed, full ~18rem panel with tab content when open. State (`open: boolean`, `activeTab: 'todos' | 'workspace'`) persisted in `localStorage` (matches how other UI prefs — theme, language — already persist), not in the URL.

### Tab: ToDos

- New store table, following `src/store/prompts.ts`'s exact pattern (own SQLite table, since "Hermes has no such thing"), added as the next entry in `src/store/migrations.ts` (versioned migrations, `PRAGMA user_version` — same mechanism every existing table went through, not an ad-hoc `CREATE TABLE IF NOT EXISTS`):

```sql
CREATE TABLE todos (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,   -- the STORED session id, not the live one
  text TEXT NOT NULL,
  done INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX todos_session_idx ON todos(session_id);
```

- CRUD routes mirroring the prompts routes: `GET /api/todos?sessionId=`, `POST /api/todos`, `PUT /api/todos/:id` (text/done/pinned), `DELETE /api/todos/:id`.
- UI: single-line quick-add input at the top: Enter creates. List below: pinned items first, then the rest by `created_at`. Checkbox toggles done (struck-through, not hidden — same "show, don't hide" instinct as the rest of the app). Pin icon toggles pinned. No editing of existing text in v1 — delete and re-add covers it; a full edit form is more chrome than a quick-note feature needs.

### Tab: Workspace

- Extract the file/folder tree, create/rename/delete/edit actions from `WorkspacePage.tsx` into a shared component (`web/src/components/WorkspaceBrowser.tsx`) parameterized by a `compact` prop (denser rows, no page chrome). `WorkspacePage.tsx` itself becomes a thin wrapper around it — this is a refactor-while-touching, not a detour: without it, create/delete/edit logic would exist twice and drift, which the brainstorming skill's own guidance flags as worth fixing inline.
- Same backend API, same sandboxed root (`src/routes/workspaceRoot.ts`) — nothing new server-side beyond what the Workspace page already calls.
- No drag-to-attach integration in v1 (i.e., dragging a workspace file into the chip tray) — worth a follow-up, not this round.

## 4. Extras

- **Auto-scroll lock**: track whether the thread's scroll position is within ~50px of the bottom. Only auto-scroll-to-bottom on new content when it was already there; otherwise show a small floating "↓ Neue Nachricht" button over the thread that scrolls to bottom and dismisses itself on click or on reaching bottom manually.
- **Message → ToDo**: hovering an assistant (or user) message reveals a small icon-only button; clicking it opens the ToDos tab (switching it if Workspace was active) and pre-fills the quick-add input with the message text truncated to a sane length (~200 chars), letting the user edit before confirming rather than silently creating a giant todo.

## Sequencing note

The four pieces above are independent of each other (attachments touch the compose row and a new route; the list grouping touches only the session list rendering; the sidebar is new surface area; the extras are small, separate additions). The implementation plan should sequence them as separately shippable phases rather than one large change — each can be gated, tested, and deployed on its own, matching how every other feature this session has gone out (small commit, full gate, redeploy, verify, next).

## Testing

- Unit tests (Vitest, matching existing coverage style): `groupByRecency()`, the new todos store CRUD (mirroring `prompts.test.ts`), the ref-text-prepending logic for outgoing attachments.
- File attachment end-to-end and the gateway `file.attach` call are not mockable meaningfully (real WebSocket, real Hermes) — verified manually against the live server, GET-only where possible, actual send confirmed by the user per this project's established practice for anything that writes to the real agent.
- Gate before shipping: `npm run lint && npm run format:check && npm run typecheck && npm test && npm run build`, plus the i18n key-parity check (new UI strings land in all three dictionaries).
