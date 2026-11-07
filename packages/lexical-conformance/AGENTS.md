# Lexical conformance tooling

## What it is

Development-only recorder and JavaScript oracle for the Lexical v0.45.0 port.
The upstream source is downloaded by checksum into this worktree's `target/`.

## Start here

- `record/run.ts`: download, patch, dual-oracle recording and transparency comparison.
- `record/membrane.ts`: attribution, identity, callback tapes and commit capture.
- `record/replay-js.ts`: independent interpreter; never executes original test bodies.
- `record/schema.ts`: schema 2 shared with the Rust fixture reader.
- `record/initial.ts`: partial-state key layout and selection restoration.
- `record/inventory.json`: S4 per-file expected counts; mixed files have no exact case labels.

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
- Macro tests run separately with markdown indent 2; upstream fixtures keep indent 4.
- `--filter=macro:<file>` selects the worktree lexical-core pool.
- Regenerate the full corpus after changing copied Macro or Loro source.
- Review fixtures for account identities beyond the machine privacy scanner.
- Entropy, node keys, handles and callback tapes reset for every test.
