# Releasing

Two separate things: publishing the source to GitHub, and running the control center on your own
server. Neither is automated here — both touch accounts and machines that only you control.

Everything below assumes the working tree is clean and the gate is green — the same five checks CI
runs, so a failure here is a failure there:

```bash
npm run lint && npm run format:check && npm run typecheck && npm test && npm run build
```

## 1. Publish to GitHub

There is no git remote configured yet, and no `gh` CLI on this machine — the commands below are
meant to be run by you, in this order.

Create the repository first at <https://github.com/new>, named `hermes-control-center` under
`tolouiluxury-creator`, **set to Private**, and **empty** — no README, no licence, no `.gitignore`,
because the repo already has all three and GitHub's copies would collide with the first push.

**Private first is deliberate.** It gives you a real clone-and-install rehearsal without an audience,
and it keeps `docs/HANDOFF.md` out of public view — that file names the server, its address and a
Telegram account (see [Before going public](#before-going-public)).

Copy-paste for the repository's own fields:

| Field | Value |
| --- | --- |
| Description | `A dashboard-first web control center for Hermes Agent — widgets, chat, and management pages over the dashboard your agent already runs.` |
| Website | leave empty for now |
| Topics | `hermes-agent` `ai-agent` `dashboard` `control-panel` `typescript` `react` `fastify` `self-hosted` `llm` `agent-management` |

Then:

```bash
git remote add origin git@github.com:tolouiluxury-creator/hermes-control-center.git
```

If you use HTTPS rather than SSH keys:

```bash
git remote add origin https://github.com/tolouiluxury-creator/hermes-control-center.git
```

Push the history and set the upstream:

```bash
git push -u origin main
```

Tag the release and push the tag:

```bash
git tag -a v0.1.0 -m "v0.1.0 — first release"
git push origin v0.1.0
```

The CI workflow in `.github/workflows/ci.yml` runs on push, so it starts checking with the first
push. It runs the gate above on Node 22 and 24, then smoke-tests the built CLI.

⚠️ **The README's CI badge stays broken while the repo is private.** shields.io fetches it
anonymously and gets a 404; you will see the result on the Actions tab regardless. It fixes itself
the moment the repo goes public — nothing to change in the README.

### Optional: the GitHub release entry

The tag alone is enough. To add release notes, copy the `[0.1.0]` section out of
[`CHANGELOG.md`](../CHANGELOG.md) into a new release at
<https://github.com/tolouiluxury-creator/hermes-control-center/releases/new>, choosing the `v0.1.0`
tag you just pushed.

### Optional: publish to npm

Only if you want `npx hermes-control-center` to work for other people. The package name is
unclaimed as of writing; check first, because the README promises that command.

```bash
npm whoami            # confirm you are logged in
npm publish --dry-run # lists exactly what would be uploaded
npm publish
```

The tarball is ~0.26 MB and contains `dist/`, `README.md`, `CHANGELOG.md` and `LICENSE` — no source,
no tests, no ESLint. Verified with `npm pack` and a clean install from the tarball.

If you do not publish to npm, drop the `npx` line from the README, or leave the note that says it is
not on npm yet.

## Before going public

Private is a decision to revisit, not a permanent state. Three things to settle first:

1. **`docs/HANDOFF.md` names your infrastructure** — the server's IP address, a Telegram account id,
   the hostname of a separate service, profile names and paths. Either replace those with
   placeholders, move the file to a private repository of its own, or stop tracking it. The file is
   worth keeping: it is the reason this project's decisions are reconstructable.
2. **Git history keeps what a later commit removes.** Cleaning the file in a new commit does not
   clean it out of the 100-odd commits behind it. Going public means either rewriting history
   (`git filter-repo`) or starting the public repository from a fresh initial commit.
3. **Test fixtures were already cleaned** — they carried a real Telegram id, an account name and the
   visible ends of a live bot token. Shapes kept, identities replaced. Worth re-checking with
   `git grep` before the switch in case new ones crept in.

## 2. Run it on your server

The control center needs the Hermes **dashboard** reachable, nothing else. On the server where
Hermes runs:

```bash
git clone https://github.com/tolouiluxury-creator/hermes-control-center.git
cd hermes-control-center
npm ci
npm run build
```

Set a password before it will listen on anything but localhost:

```bash
node dist/cli.js --set-password
```

Check what it found, without starting anything:

```bash
node dist/cli.js --doctor --profile sunrise
```

That should report the dashboard responding and the API server as an optional note. Then start it:

```bash
node dist/cli.js --host 0.0.0.0 --port 7777 --profile sunrise --no-open
```

**Name the profile.** Without `--profile sunrise` it reads the default profile, which is not the one
your agent runs under.

### As a systemd service

`/etc/systemd/system/hermes-cc.service`:

```ini
[Unit]
Description=Hermes Control Center
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=root
WorkingDirectory=/root/hermes-control-center
ExecStart=/usr/bin/node dist/cli.js --host 127.0.0.1 --port 7777 --profile sunrise --no-open
Restart=on-failure
RestartSec=5
Environment=NODE_ENV=production

[Install]
WantedBy=multi-user.target
```

```bash
systemctl daemon-reload
systemctl enable --now hermes-cc
systemctl status hermes-cc
journalctl -u hermes-cc -f
```

Bind to `127.0.0.1` in the unit and let Caddy terminate TLS in front of it, rather than exposing the
port directly.

### Behind Caddy

Add to your `Caddyfile`, on a hostname of its own:

```caddy
cc.your-domain.example {
    reverse_proxy 127.0.0.1:7777
}
```

```bash
caddy validate --config /etc/caddy/Caddyfile
systemctl reload caddy
```

**Leave the existing `hermes.your-domain.example:8787` WebUI alone** — it is a separate service on a separate
port, and nothing here touches it.

A password is the minimum, not the whole story. For something reachable from the open internet, put
an authenticating proxy in front as well (Cloudflare Access, Authelia, or Caddy's own
`basic_auth`), because this app can restart your gateway and write environment variables.

## 3. After the first release

Bump `version` in `package.json`, add a new section at the top of `CHANGELOG.md`, then tag with the
matching `vX.Y.Z`. The version the CLI reports comes from `package.json`, so those two must not
drift.
