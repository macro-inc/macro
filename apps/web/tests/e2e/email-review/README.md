# Recorded local email verification

This suite drives the mounted application in the shared Chrome instance, records
chaptered video, and asserts real local database/API effects. It complements the
fast feature tests and the independent renderer's Node/Chromium suites. The
coverage inventory is in [EMAIL_LOCAL_VERIFICATION.md](../../../../../docs/EMAIL_LOCAL_VERIFICATION.md).

Run from the repository root. Use a dedicated local stack and synthetic accounts:

```sh
nix develop --command just run_local --instance email-feature-eval \
  --port-base 24700 --no-doppler --with-chrome --no-build
```

`--no-build` assumes this worktree already has compatible local service binaries.
Omit it when building the stack for the first time. Keep that process running.
The app is at `http://localhost:24710/app`, API proxy at `24709`, and shared Chrome
at `9222`. The recorder owns Chrome interaction while it runs; other agents or
manual browsing should wait.

Generate and apply the seed in a second terminal:

```sh
python3 apps/web/tests/e2e/email-review/support/seed.py
nix develop --command just seed-scenario --instance email-feature-eval \
  --port-base 24700 apply --file /tmp/email-exhaustive-review/scenario.json
nix develop --command psql postgres://user:password@localhost:24700/macrodb \
  -X -v ON_ERROR_STOP=1 -f /tmp/email-exhaustive-review/seed-enrichment.sql
nix develop --command node apps/web/tests/e2e/email-review/support/login.cjs
nix develop --command node apps/web/tests/e2e/email-review/support/resources.cjs
```

The seed has three personas, four inboxes (including a delegated inbox), 17
threads, an eight-message conversation with a saved middle reply, a 120-message
conversation, HTML/calendar/Markdown fixtures, attachments with actual stored
bytes, a document mention target, a free account, a read-only share, a notification,
and a pending AI email tool output. Resource setup resets that AI output and its
notification; run it before a fresh recording. Generated IDs and auth state stay
under `/tmp/email-exhaustive-review`; auth files are mode `0600`. Reapplying the
scenario can reset its synthetic users, so log in again afterward.

Two local compatibility listeners are needed for this nondefault port window.
Start each in its own terminal if those ports are free:

```sh
python3 apps/web/tests/e2e/email-review/support/storage-port-forward.py
python3 apps/web/tests/e2e/email-review/support/local-cdn.py
```

They forward loopback `4566` to the instance's actual LocalStack at `24706` and
serve the default local CDN at `8100` from those real objects. The browser harness
also translates the Docker-only `localstack:4566` upload hostname to loopback.
These scripts deliberately use the fixed port window above; do not point them at
another stack. Stop them with Ctrl+C when finished.

```sh
nix develop --command node apps/web/tests/e2e/email-review/harness.cjs
```

A full run creates a fresh `results.json`, screenshots under `artifacts/`, and
one WebM per scene under `video/`. It returns nonzero if any scene or cleanup
fails. The installed Playwright build must support `page.screencast`; this review
uses that API over CDP. Videos include chapter labels and captions after successful
assertions. No credential or real mailbox data is part of the seed or recording.

For diagnosis, pass chapter names (`reading compose attachments resilience mobile
advanced integration`) and optionally `EMAIL_REVIEW_SCENES=14,30`. Set
`EMAIL_REVIEW_APPEND=1` only to aggregate diagnostic takes. Final evidence must
come from one complete run with a single source revision and diff hash; never
assemble stale passes from separate versions.

The harness exercises real local sends only with immediate Undo and finally
cancels any remaining scheduled message before deleting its newly created drafts.
All recipient addresses are synthetic. Failure scenes explicitly substitute
transport failures. The seeded Gmail accounts have no OAuth grants: health checks
and `needs_reauth` are held healthy in the browser so provider reconnection does
not obscure unrelated controls. The report and video introduction disclose this.
Provider delivery/sync, LLM generation, native WebView behavior, and a physical
on-screen keyboard require their own environments.

Use `render-video.cjs` after a successful full run to create the MP4, chapter
metadata, and an HTML player from exactly the scenes in `results.json`. It rejects
failed or mixed-run evidence.

If the recorder reports a redundant cleanup failure after the application already
deleted that exact draft successfully, `nix develop --command node
apps/web/tests/e2e/email-review/audit-cleanup.cjs` can verify its absence directly
in the dedicated local database. Run it only after the recorder exits. It refuses
application failures, failed schedule cancellation, missing successful deletion
evidence, or a draft still present in the database. It preserves the raw failing
results and original cleanup response, then appends an explicit readback audit.
This is a reconciled cleanup outcome, not a claim that the original recorder exit
was successful. The player links both reports.

For an HTTP player with working chapter seeks, run:

```sh
nix develop --command bun apps/web/tests/e2e/email-review/serve-video.cjs
```

Open `http://localhost:24891`. `EMAIL_REVIEW_VIDEO_PORT` selects another free
port. The server binds loopback and allows only published video/evidence and
synthetic screenshots, excluding auth files. Bun serves byte ranges required by
the player's seek buttons; a server without range support may restart playback
instead of seeking.
