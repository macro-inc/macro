# harnessd

## What it is

The agent sign-in daemon baked into the Macro computer image (computers).
It owns each agent's sign-in on the computer (today Claude, through
`claude setup-token`) and answers the JSONL protocol of
`crates/harnessd_protocol`. Tokens stay on the computer.

## How it works

- `harnessd serve --socket /run/harnessd/harnessd.sock --state-dir <dir>
  --claude <claude>` is a systemd service (user `macro`). It serves the JSONL
  loop per socket connection over shared adapters, so a `sign_in_cancel` on
  one connection interrupts a `sign_in_complete` waiting on another.
- `harnessd` alone is the client the control plane execs through
  `Fleet::exec`: stdin lines go to the socket, answers to stdout. With no
  daemon it answers each request `error/unavailable` and exits 1. By hand:
  `echo '{"command":"status","agent":"claude"}' | harnessd`.
- The Claude adapter runs `claude setup-token` (the four credential env vars
  removed) in a 500-column PTY rendered through `vt100`. Start reads the
  hard-wrapped URL; complete pastes the code, presses Enter and reads the
  `sk-ant-oat…` token, stored atomically at `<state>/claude/credential.json`
  (0600, directory 0700) with `expires_at` from the "valid for" text.

## Start here

- `src/auth.rs`: the `AgentAuth` port; `src/jsonl.rs`: the loop.
- `src/claude.rs`: sign-in state machine; `src/claude/screen.rs`: what the
  CLI's screens say, tested against raw captures in `src/claude/testdata`.

## Scope

- Owns: the daemon, the client, agent adapters, the credential file.
- Not here: the wire types → `crates/harnessd_protocol`; the image, unit and
  the `claude` wrapper → `nix/macro-box`; driving it →
  `services/agent_harness_service/src/computers`.

## Checks

- `cargo test -p harnessd`
- After a Claude Code upgrade (pin in `nix/macro-box/_claude-code.nix`):
  `cargo test -p harnessd -- --ignored` runs the real CLI
  (`HARNESSD_REAL_CLAUDE`, needs network): a URL, then `x#y` is `invalid_code`.

## Gotchas

- `credential_id` is `sha256:` + the first 32 hex digits of
  SHA-256(`"harnessd claude credential v1\0"` + token): a stable, non-secret
  stand-in for the account, which the token does not carry. Never log the
  token, the pasted code or the fingerprint input; Debug impls redact them.
- Any CLI answer to a code (success, rejection, timeout) ends that sign-in;
  a retried complete after success answers `signed_in` from the file.
- A start within 10 minutes of a waiting one returns its URL; an older one
  is killed and replaced.
- Read screens through the emulator, never by stripping escapes: the CLI
  uses cursor moves (`ESC[1C`) for spaces.
- Sessions get the token from the image's `claude` wrapper, which drops the
  Macro gateway env (`ANTHROPIC_BASE_URL`, `ANTHROPIC_AUTH_TOKEN`,
  `ANTHROPIC_API_KEY`, `CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC`) and sets
  `CLAUDE_CODE_OAUTH_TOKEN` only when the file has a token; an unreadable
  file or one without a token keeps the gateway env and warns on stderr.
  Never write Claude's own `~/.claude/.credentials.json`.
