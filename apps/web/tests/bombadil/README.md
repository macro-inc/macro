# Bombadil: a loaded channel does not move by itself

[Bombadil](https://github.com/antithesishq/bombadil) (v0.7.10) explores the
channel timeline with random actions and checks one property,
`channelStaysPutAfterLoad` in `channel-stability.ts`: once a timeline is
positioned (`data-scroll-phase="ready"`), nothing but the reader moves it.

- **Pinned to the bottom:** it stays pinned.
- **Not pinned:** the message at the top of the view keeps its place, within 1 px.
- **Height:** the timeline keeps its height.

Movement right after input is excused for 150 ms, and longer while the scroll
is still moving. Resizes are excused for 800 ms after typing or a window
resize. A navigation starts over.

## How it checks

Bombadil captures state only when the page is quiet, so a jump the app fixes
a few frames later falls between two captures. The extractor installs a probe
in the page that compares every painted frame with the one before it. Each
capture reads the probe's running list of violations, and `checked` counts
the frames it actually compared.

## What it does

- Wheels over the timeline. Bombadil's default `scroll` only scrolls the window.
- Clicks inside the timeline.
- Opens channels and mid-history deep links.
- Another member posts, replies, reacts and edits through the API. Posts
  include long text, code, a link and an image.
- Types into the composer.
- Switches between phone and desktop widths.
- Goes back and forward, and waits.

## Running it

It needs a local E2E stack, a Chromium binary and a frontend built against
the stack with bearer-token auth.

```sh
# 1. Stack (one named instance; stop it when done).
tooling/scripts/run-local-e2e.sh --instance bombadil

# 2. Tokens for the seeded user and a second member.
cd apps/web
export LOCAL_E2E_ENV_FILE=../../infra/local/generated/bombadil/local.generated.env
TOKEN=$(bun scripts/generate-local-e2e-token.ts --expiry-seconds 86400)
PEER_TOKEN=$(bun scripts/generate-local-e2e-token.ts --email bob@example.com --expiry-seconds 86400)

# 3. A built frontend, served with vite preview.
MODE=development NODE_ENV=production VITE_LOCAL_SERVERS=ALL \
  VITE_LOCAL_BACKEND_ORIGIN=https://localhost:<proxy-port> VITE_LOCAL_ONLY=true \
  VITE_LOCAL_STACK=true VITE_ENABLE_BEARER_TOKEN_AUTH=true LOCAL_JWT=$TOKEN \
  bun run --bun build
bunx vite preview -c vite.config.ts --outDir dist --base /app --port <port>

# 4. Bombadil. CHROME must accept the stack's local certificate, e.g. a
#    wrapper that adds --ignore-certificate-errors.
BACKEND_ORIGIN=https://localhost:<proxy-port> PEER_TOKEN=$PEER_TOKEN CHROME=... \
  tests/bombadil/run.sh http://localhost:<port> --time-limit 10m
bunx @antithesishq/bombadil@0.7.10 browser inspect test-results/bombadil/channel-stability
```

Each run of the run script writes `local.json` (gitignored) for the spec.

Use a built bundle rather than the dev server: Bombadil instruments every
script for coverage, and the dev server's thousands of modules slow the page
to a few frames a second.

## What it found

When "Chat with Agent" opened a split beside a scrolled-up channel, the
channel painted the top of its loaded history for a frame before jumping
back. `Resize.Zone` detached and re-appended the main panel when the
navigation moved to an overlay. The Resize browser harness now covers this.
