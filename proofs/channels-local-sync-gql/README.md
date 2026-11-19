# Channel GraphQL preservation archive

Preserved on 2026-11-19 from implementation head
`fe958645209323b3ec9b8f5951397e9f12c3f570`. This is a migration snapshot,
not a new validation run or a claim that deferred checks passed.

- `../../REPORT.md` records the implementation, test counts, query plans,
  measurements and the deferred SQLx/offline/trace checks.
- `artifacts/` contains the recorded test/check output, audits, query plans,
  SQL, helper scripts and notes previously held under `/tmp/channels-*`.
- `fixture/` preserves the synthetic 50,000-message performance fixture;
  CSV files use deterministic gzip. Decompress them before loading.
- `manifest.json` lists preserved files and SHA256 checksums. CSV checksums
  refer to decompressed, sanitized bytes.

All artifacts were scanned as text before compression. Non-placeholder email
addresses were replaced consistently with hash-derived `example.com` fixture
addresses. Credential-bearing URL authority components were redacted, terminal
escape sequences/NULs removed, author lines redacted, and original home/worktree
paths normalized. The original fixture manifest records pre-sanitization hashes;
use this archive's manifest for preserved-byte checksums. Query timings and test
counts are historical and unchanged by this sanitation.

The old scripts are preserved as evidence, not newly tested portability helpers.
They refer to historical Nix store paths, `/tmp` files and a local performance
configuration. Recreate those inputs with local credentials before execution;
no credentials, `.env` files or private performance configuration are included.
The private PostgreSQL cluster, build outputs and caches are not archived.

Only the `synoet-channels-local-sync-gql` worktree was used by this worker.
Other worktrees listed by Git belong to other sessions and were not modified.
The recovery branch uses the `-wip` suffix because the original report explicitly
leaves SQLx preparation, offline validation and served trace checks to integration.
