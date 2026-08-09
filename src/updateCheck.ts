import { describeError, log } from './log.js';
import { pkg } from './util/pkg.js';

/**
 * "Is a newer release out on GitHub" — the only update channel this project
 * actually has (see `docs/RELEASE.md`: no npm publish yet). Polled by the
 * topbar so a user notices without having to remember to check.
 */

const REPO = 'tolouiluxury-creator/hermes-control-center';
// GitHub's unauthenticated rate limit is 60 requests/hour per IP — cached
// well under that even with several browser tabs open.
const CHECK_TTL_MS = 60 * 60_000;
const FAILURE_TTL_MS = 5 * 60_000;

export interface UpdateCheckResult {
  currentVersion: string;
  latestVersion: string | null;
  updateAvailable: boolean;
  releaseUrl: string | null;
}

interface ParsedVersion {
  major: number;
  minor: number;
  patch: number;
  pre: string | null;
  preNum: number;
}

const VERSION_RE = /^v?(\d+)\.(\d+)\.(\d+)(?:-([a-zA-Z]+)\.(\d+))?/;

function parseVersion(raw: string): ParsedVersion {
  const match = VERSION_RE.exec(raw.trim());
  if (!match) return { major: 0, minor: 0, patch: 0, pre: null, preNum: 0 };
  return {
    major: Number(match[1]),
    minor: Number(match[2]),
    patch: Number(match[3]),
    pre: match[4] ?? null,
    preNum: match[5] ? Number(match[5]) : 0,
  };
}

/**
 * Only handles this project's own scheme (`X.Y.Z` or `X.Y.Z-channel.N`) — not
 * a general semver comparator. A release with no prerelease suffix always
 * beats one with any suffix; two different prerelease channels (`beta` vs.
 * some future `rc`) are treated as equal rather than guessed at.
 */
export function isNewerVersion(latest: string, current: string): boolean {
  const a = parseVersion(latest);
  const b = parseVersion(current);
  if (a.major !== b.major) return a.major > b.major;
  if (a.minor !== b.minor) return a.minor > b.minor;
  if (a.patch !== b.patch) return a.patch > b.patch;
  if (a.pre === null && b.pre !== null) return true;
  if (a.pre !== null && b.pre === null) return false;
  if (a.pre !== b.pre) return false;
  return a.preNum > b.preNum;
}

interface LatestRelease {
  tag: string;
  url: string;
}

/** The slice of `fetch` this needs, kept structural so tests never hit the real network. */
export type FetchLike = (url: string, init?: RequestInit) => Promise<Response>;

async function fetchLatestRelease(fetchImpl: FetchLike): Promise<LatestRelease | null> {
  const response = await fetchImpl(`https://api.github.com/repos/${REPO}/releases`, {
    headers: {
      accept: 'application/vnd.github+json',
      'user-agent': 'hermes-control-center-update-check',
    },
  });
  if (!response.ok) throw new Error(`GitHub API responded ${response.status}`);
  // `/releases` (not `/releases/latest`) — this project ships pre-releases,
  // which `/releases/latest` deliberately excludes. Ordered newest-first.
  const releases = (await response.json()) as { tag_name?: unknown; html_url?: unknown }[];
  const latest = releases[0];
  if (typeof latest?.tag_name !== 'string') return null;
  return {
    tag: latest.tag_name,
    url:
      typeof latest.html_url === 'string' ? latest.html_url : `https://github.com/${REPO}/releases`,
  };
}

/** Caches the GitHub lookup itself, not just the comparison — one instance lives on `AppContext`. */
export class UpdateChecker {
  private cached: { value: UpdateCheckResult; expiresAt: number } | null = null;
  private inflight: Promise<UpdateCheckResult> | null = null;

  constructor(
    private readonly fetchImpl: FetchLike = fetch,
    private readonly currentVersion: string = pkg.version,
  ) {}

  async check(now = Date.now()): Promise<UpdateCheckResult> {
    if (this.cached && this.cached.expiresAt > now) return this.cached.value;
    if (this.inflight) return this.inflight;

    const noUpdate: UpdateCheckResult = {
      currentVersion: this.currentVersion,
      latestVersion: null,
      updateAvailable: false,
      releaseUrl: null,
    };

    this.inflight = (async () => {
      try {
        const release = await fetchLatestRelease(this.fetchImpl);
        const result: UpdateCheckResult = release
          ? {
              currentVersion: this.currentVersion,
              latestVersion: release.tag.replace(/^v/, ''),
              updateAvailable: isNewerVersion(release.tag, this.currentVersion),
              releaseUrl: release.url,
            }
          : noUpdate;
        this.cached = { value: result, expiresAt: now + CHECK_TTL_MS };
        return result;
      } catch (error) {
        log.debug(`update check failed: ${describeError(error)}`);
        // Cached briefly too, so a flaky network doesn't retry on every request.
        this.cached = { value: noUpdate, expiresAt: now + FAILURE_TTL_MS };
        return noUpdate;
      }
    })().finally(() => {
      this.inflight = null;
    });

    return this.inflight;
  }
}
