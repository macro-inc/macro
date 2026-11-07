# Lexical conformance tooling

## What it is

Development-only recorder and JavaScript oracle for the Lexical v0.45.0 port.
The upstream source is downloaded by checksum into this worktree's `target/`.

## Start here

- `record/run.ts`: download, patch, dual-oracle recording and transparency comparison.
- `record/membrane.ts`: attribution, identity, callback tapes and commit capture.
- `record/replay-js.ts`: independent interpreter; never executes original test bodies.
- `record/schema.ts`: schema 2 shared with the Rust fixture reader.

## Boundaries

- Never import the recorder from shipped packages.
- Only `record/hooks.patch` modifies the disposable upstream source.
- A failed upstream test, transparency check or self-replay cannot become A-rec.
- Keep unsupported cases in `fixtures/index.json` with a reason; never silently omit them.

## Checks

- In this package: `bun install --frozen-lockfile`, `bunx tsc --noEmit`, `bun run test`.
- From the repository: `just lexical-fixtures --check` twice, then `just check`.

## Gotchas

- `--filter=<file>` is for recorder development only; release fixtures use the full suite.
- The upstream pin is independent of the app's patched npm packages.
- Entropy, node keys, handles and callback tapes reset for every test.
