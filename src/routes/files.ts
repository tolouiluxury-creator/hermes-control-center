import type { FastifyInstance, FastifyReply } from 'fastify';
import { z } from 'zod';
import type { AppContext } from '../context.js';
import { UpstreamError } from '../hermes/client.js';
import {
  detectWorkspaceRoot,
  displayPath,
  OutsideWorkspaceError,
  resolveInsideRoot,
} from './workspaceRoot.js';

/**
 * The workspace area: browsing and managing files on the Hermes host, confined
 * to one directory.
 *
 * The confinement is the feature. Hermes' managed-file endpoints accept any
 * path when their own `locked_root` is unset, which is the stock state — so
 * without the check in `workspaceRoot.ts` this would be a delete-capable file
 * browser over the entire server, reachable from a browser tab.
 *
 * With no root configured the whole area answers 409 rather than defaulting to
 * something. A default here would be a guess about which of somebody's
 * directories is safe to expose, and there is no safe guess.
 */

const pathSchema = z.object({ path: z.string().max(4096).optional() });
const mkdirSchema = z.object({ path: z.string().min(1).max(4096) });
const setRootSchema = z.object({ path: z.string().min(1).max(4096) });
/** 8 MiB is Hermes' own ceiling (`_FS_TEXT_WRITE_MAX_BYTES`); it answers 413 above it. */
const writeSchema = z.object({
  path: z.string().min(1).max(4096),
  content: z.string().max(8 * 1024 * 1024),
});
const deleteSchema = z.object({
  path: z.string().min(1).max(4096),
  recursive: z.boolean().optional(),
});

/** Text is decoded here so the browser never handles a data URL it must trust. */
function textFromDataUrl(dataUrl: string | null | undefined): string | null {
  if (!dataUrl) return null;
  const comma = dataUrl.indexOf(',');
  if (comma < 0) return null;
  const meta = dataUrl.slice(0, comma);
  const payload = dataUrl.slice(comma + 1);
  if (!meta.includes(';base64')) return null;
  try {
    return Buffer.from(payload, 'base64').toString('utf8');
  } catch {
    return null;
  }
}

/** Whether the bytes look like text at all — a binary preview helps nobody. */
function looksBinary(text: string): boolean {
  // A NUL byte never appears in text this page should try to render.
  return text.includes('\u0000');
}

export async function registerFileRoutes(app: FastifyInstance, ctx: AppContext): Promise<void> {
  /**
   * Resolve the request's path, or answer for it.
   *
   * Returns null when it has already sent a reply — either because no root is
   * configured, or because the path pointed outside it.
   *
   * Reads the root fresh from `ctx` on every call rather than capturing it once
   * at startup, so setting it through the web UI opens the area immediately —
   * see `PUT /api/workspace/root` below.
   */
  const inside = (reply: FastifyReply, requested?: string | null): string | null => {
    const workspace = ctx.getWorkspaceRoot();
    if (!workspace) {
      void reply.code(409).send({
        error: 'workspace_not_configured',
        message: 'No workspace root is configured. Set "workspaceRoot" in the config file.',
      });
      return null;
    }
    try {
      return resolveInsideRoot(workspace, requested);
    } catch (error) {
      if (error instanceof OutsideWorkspaceError) {
        void reply
          .code(403)
          .send({ error: 'outside_workspace', message: 'Path is outside the workspace root.' });
        return null;
      }
      throw error;
    }
  };

  const guard = async <T>(reply: FastifyReply, work: () => Promise<T>): Promise<T | undefined> => {
    try {
      return await work();
    } catch (error) {
      if (error instanceof UpstreamError) {
        void reply.code(error.clientStatus).send(error.toJSON());
        return undefined;
      }
      throw error;
    }
  };

  /** What the page needs before it can render anything: is there a root at all? */
  app.get('/api/workspace/root', async () => {
    const workspace = ctx.getWorkspaceRoot();
    return { configured: workspace !== null, root: workspace?.root ?? null };
  });

  /*
   * Sets the root through the web UI instead of hand-editing the config file —
   * takes effect immediately (see AppContext.setWorkspaceRoot) and creates the
   * folder if it does not exist yet (Hermes' own mkdir is idempotent, so
   * pointing at an existing folder is just as fine as a brand new one).
   */
  app.put('/api/workspace/root', async (request, reply) => {
    const body = setRootSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    const detected = detectWorkspaceRoot(body.data.path);
    return guard(reply, async () => {
      await ctx.dashboard.createDirectory(detected.root);
      ctx.setWorkspaceRoot(detected);
      return { configured: true, root: detected.root };
    });
  });

  app.get('/api/workspace/list', async (request, reply) => {
    const query = pathSchema.safeParse(request.query ?? {});
    const target = inside(reply, query.success ? query.data.path : undefined);
    if (target === null) return reply;
    const workspace = ctx.getWorkspaceRoot()!;
    return guard(reply, async () => {
      const listing = await ctx.dashboard.listFiles(target);
      return {
        path: target,
        // The root reads as "/" so nobody has to think about where it sits.
        display: displayPath(workspace, target),
        atRoot: target === workspace.root,
        entries: listing.entries,
        /** Null means Hermes confines nothing and only this control center does. */
        hermesLockedRoot: listing.hermesLockedRoot,
      };
    });
  });

  app.get('/api/workspace/read', async (request, reply) => {
    const query = pathSchema.safeParse(request.query ?? {});
    const requested = query.success ? query.data.path : undefined;
    if (!requested) return reply.code(400).send({ error: 'missing_path' });
    const target = inside(reply, requested);
    if (target === null) return reply;
    return guard(reply, async () => {
      const file = await ctx.dashboard.readFile(target);
      const text = textFromDataUrl(file.data_url);
      return {
        name: file.name ?? '',
        path: target,
        size: file.size ?? null,
        mimeType: file.mime_type ?? null,
        // Binary content is reported as absent rather than as mojibake.
        text: text !== null && !looksBinary(text) ? text : null,
        binary: text === null || looksBinary(text),
      };
    });
  });

  /*
   * Hermes caps the payload at 8 MiB and answers 413 above it; rejecting here
   * keeps a pointless megabyte off the wire. Its own docstring puts freshness on
   * the client: "Stale-on-disk detection is the client's job (re-read before
   * save)" — the page re-reads after every write for that reason.
   */
  app.put('/api/workspace/file', async (request, reply) => {
    const body = writeSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    const target = inside(reply, body.data.path);
    if (target === null) return reply;
    return guard(reply, () => ctx.dashboard.writeTextFile(target, body.data.content));
  });

  app.post('/api/workspace/mkdir', async (request, reply) => {
    const body = mkdirSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    const target = inside(reply, body.data.path);
    if (target === null) return reply;
    return guard(reply, () => ctx.dashboard.createDirectory(target));
  });

  app.delete('/api/workspace/file', async (request, reply) => {
    const body = deleteSchema.safeParse(request.body);
    if (!body.success) return reply.code(400).send({ error: 'invalid_request' });
    const target = inside(reply, body.data.path);
    if (target === null) return reply;
    // Deleting the root would empty the workspace in one click.
    if (target === ctx.getWorkspaceRoot()?.root) {
      return reply
        .code(400)
        .send({ error: 'cannot_delete_root', message: 'The workspace root cannot be deleted.' });
    }
    return guard(reply, () => ctx.dashboard.deleteFile(target, body.data.recursive === true));
  });
}
