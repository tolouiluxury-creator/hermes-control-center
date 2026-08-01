import type { McpServerInput } from '@/lib/api';

/**
 * What the MCP form holds while it is open.
 *
 * `transport` is the user's choice for a new server and a read-only fact for an
 * existing one — see `mcpUpdatePayload` for why it cannot be changed by an edit.
 */
export interface McpDraft {
  isNew: boolean;
  name: string;
  transport: 'http' | 'stdio';
  url: string;
  command: string;
  args: string;
  env: string;
  bearerToken: string;
}

/** Splits a command line into arguments. Quotes are honoured, nothing else. */
export function splitArgs(raw: string): string[] {
  return (raw.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((part) => part.replace(/^["']|["']$/g, ''));
}

/** Reads `KEY=value` lines. Blank lines and lines without `=` are skipped. */
export function parseEnv(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const line of raw.split('\n')) {
    const at = line.indexOf('=');
    if (at <= 0) continue;
    const key = line.slice(0, at).trim();
    if (key !== '') out[key] = line.slice(at + 1).trim();
  }
  return out;
}

/**
 * Build the body for `POST /api/hermes/mcp`.
 *
 * Hermes' own normalizer (`_normalize_mcp_server_create`) raises on a URL
 * server that carries `args` or `env` — "Arguments are only supported for stdio
 * MCP servers". So the two transports send disjoint fields rather than sending
 * everything the form happens to be holding: a user who typed a command line,
 * switched to HTTP and pressed save would otherwise get a 400 about arguments
 * they can no longer see.
 *
 * A bearer token is a one-time provisioning value. Hermes writes it into the
 * profile's `.env` and stores only an `${VAR}` header template in config.yaml,
 * which is why it travels here and never comes back on a read.
 */
export function mcpCreatePayload(draft: McpDraft): McpServerInput {
  if (draft.transport === 'http') {
    const token = draft.bearerToken.trim();
    return {
      name: draft.name.trim(),
      url: draft.url.trim(),
      ...(token !== '' ? { auth: 'header' as const, bearerToken: token } : {}),
    };
  }
  return {
    name: draft.name.trim(),
    command: draft.command.trim(),
    args: splitArgs(draft.args),
    env: parseEnv(draft.env),
  };
}

/**
 * Build the patch for `PUT /api/hermes/mcp/:name`, which deep-merges into
 * config.yaml.
 *
 * The merge can set and replace, never remove — so an edit stays inside the
 * transport the server already has. Writing `url` onto a stdio server would
 * leave `command` behind, and Hermes decides transport by key presence
 * (`_is_http` is `"url" in config`): the old command would simply be ignored,
 * or in the other direction a new command would be, with nothing but a warning
 * in the agent log. The form locks the switch and says so.
 *
 * Only env lines the user actually typed travel; every unmentioned variable
 * keeps the real value this page is never allowed to read back.
 */
export function mcpUpdatePayload(draft: McpDraft): {
  url?: string;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
} {
  if (draft.transport === 'http') {
    return { url: draft.url.trim() };
  }
  const env = parseEnv(draft.env);
  return {
    command: draft.command.trim(),
    args: splitArgs(draft.args),
    ...(Object.keys(env).length > 0 ? { env } : {}),
  };
}
