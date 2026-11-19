# Handoff: routine webhooks, bearer only + server switch

PR: https://github.com/macro-inc/macro/pull/10862 (branch `synoet/routines-webhook`).
This `-wip` branch is the PR branch plus one commit holding this `handoff/`
folder. **Drop the handoff commit before pushing to the PR branch**:
`git push origin synoet/routines-webhook-wip~1:synoet/routines-webhook`, once
the steps under "Next" are done.

## Where it stands

The PR branch on GitHub is still at `c6c885dc28d` and conflicts with main.
Everything below is on this branch only, because the review skill had not run
on it when the session stopped.

On top of `c6c885dc28d`:

1. `fa32d4689f5` feat(routines)!: take a routine webhook's secret only as a bearer token
2. `7687128f405` feat(routines): switch routine webhooks per owner on the server
3. `338b160d08a` feat(routines): show a webhook's secret beside its URL, bearer only
4. `572bad5d261` feat(routines): follow the server's webhook switch in the routine editor
5. `24ab8333431` merge of origin/main `355e6cdc353` (sdk-mcp snapshots regenerated;
   webhook test fake follows main's `set_appearance -> AppearanceSet`)

The brief's changes:

- **Bearer only.** The delivery route is `POST /scheduled-action/hooks/{hook}`
  with `Authorization: Bearer <secret>`. `/hooks/{code}/` and
  `/hooks/{code}/{*rest}` are catch-alls answering the empty 404, so an old
  path-form secret never reaches a span (`redacted_path` records the route).
  Minting returns `{hookId, url, secret, createdAt}`, where the url holds the
  hook id only.
- **Server switch.** This is the per-owner PostHog flag `enable-routine-webhooks`,
  with the same key as the web flag (`domain/webhook_rollout.rs`). It was chosen
  because the feature-flags skill puts every backend gate in `feature_flags`,
  never a Doppler boolean, and main replaced PR 10108's `EVENT_ROUTINES_ENABLED`
  with PostHog `enable-event-routines` in the same way.
  - Management routes: off is 404, an unreadable flag is 503.
  - Delivery: the flag is read only after the secret matched and the hook's
    limit allowed it. Off is the empty 404, an error is 503.
  - Without PostHog configured, the flag is off for everyone.
  - The event-run worker again starts only where event intake runs, as on main.
    That is exactly when PostHog is configured.
  - **The PostHog flag must exist before shipping.** It was not created.
- **Web.**
  - The panel shows the URL and the secret as separate copy rows, shown once,
    with a curl example that sends a bearer header.
  - With the flag off, a saved webhook trigger's panel says webhooks aren't
    available and reads no URL. This was added beyond the brief, because the
    server now 404s.
  - The flag no longer defaults on in dev; it follows PostHog.
- **Docs.** Updated: `crates/scheduled_action/AGENTS.md`, `apps/web/AGENTS.md`,
  `docs/agent-guide/navigation.md`, `docs/agent-guide/ai-chat.md`, the SDK
  README and namespace docs, and `code_steps.md`. The wording now says
  "whoever holds the secret".

## Proven (on the commits named)

All of the following ran on the merged tree `24ab8333431` unless noted:

- `cargo test -p scheduled_action -p agent_correlation -p trigger_context`
  (private Postgres): 664 + 17 + 7 + 10 passed.
- `cargo test -p agent_harness_service --lib scheduling`: 30 passed. Run on the
  merged tree, but before the final `set_appearance` fix, which only touched a
  scheduled_action test.
- On the pre-merge head `572bad5d261` / its working tree:
  - `cargo check --tests -p agent_harness_service` was clean.
  - `cargo clippy --all-features -p scheduled_action -p agent_correlation
    -p agent_harness_service -- -D warnings -D clippy::disallowed_methods`
    (SQLX_OFFLINE, no `--tests`, as CI runs it) was clean.
  - `--tests` clippy fails only on files this PR doesn't touch (drafts,
    pg_draft_hand_backs, pg_suggestion_repo).
- The bearer-only commit `fa32d4689f5` was tested on its own in a temporary
  worktree: webhook tests 43/43, and agent_correlation checks.
- `the_secret_is_never_traced` was flaky: 6 of 20 parallel runs failed. Warming
  its callsites before `rebuild_interest_cache()` brought that to 0 of 30, and
  a planted `tracing::debug!(token = %secret)` was still caught 20 of 20 times.
- `a_secret_in_the_path_is_an_unknown_url` compares raw HTTP/1.1 answers over a
  real socket. Path forms, `NotFound` and `NotEnabled` are byte-identical to an
  unknown route, minus the date.
- Web, on the merged tree:
  - `bunx vitest run src/features/routines`: 608 passed.
  - Web `tsc`: clean.
  - Routines playwright (webhook e2e): 2 passed. Run before the merge.
- SDK: `bun run coverage` OK, `bun run check` OK, `bun test` 530 passed.
  code-mode-sdk and sdk-mcp tests passed.
- `just check`: OK, before the merge.

## Next

1. Run the `review` skill on `c6c885dc28d..HEAD` (no SQL changes), then the
   `audit` skill (auditor). Fix or justify the findings.
2. Re-run `just check` on the merged head. Then push to the PR branch, without
   the handoff commit, and add the `run-ci` label. `CI gate` must be green on
   the head.
3. Update the PR body. The live body is in `handoff/pr-body-live.md`.
   - Drop the path form from the diagram and the bullets.
   - Describe the switch, and say the PostHog flag must exist before shipping.
   - Replace "Finished event-run rows (with the body) stay until the routine is
     deleted" with: the body is stripped when a run finishes (`#- '{webhook,body}'`
     in `pg_event_run_repo` finalize/cancel/skip/reconcile); the run page
     keeps it.
   - Drop the "which forms to offer" and "no backend switch" follow-ups.
     Keep "limits are constants".
   - Add a follow-up: a delivery already queued still runs after the flag turns
     off, because dispatch doesn't recheck webhooks
     (`domain/event_runs/dispatch.rs:143-165`).
   - Don't mention security findings about code on main.
4. Re-record the proof on the final head, on a local stack with a PostHog stub
   reachable from containers (set `POSTHOG_HOST`/`POSTHOG_API_KEY`; the
   response is `{"flags":{"enable-routine-webhooks":{"key":…,"enabled":true,"variant":null}},"errorsWhileComputingFlags":false}`
   at `/flags/?v=2`). It should show:
   - the bearer flow end to end;
   - the old path form getting a 404;
   - the flag off, with management and delivery both getting a 404;
   - the web off notice.

   Notes for the proof:
   - The old driver is `handoff/proof/prove2.mjs`
     (`node prove2.mjs <out> <app origin> <email>`). Its curl calls still use
     the path form and must change to bearer.
   - The stack env file is `handoff/proof/local.env`.
   - The old page's HTML is `handoff/proof/old-page-index.html`.
   - The old Artifact is https://claude.ai/artifact/DnL6ydRi5ZnjGvnvp2ctjs.
   - Pages go under `proofs/routine-webhook/` on the proof server, linked from
     `proofs/index.html`.

## Traps

- Splitting commits: `webhook_router.rs` and its test mix bearer and switch
  hunks. The commits were built from staged intermediates, not `git add -p`.
- Regenerating: run `gen-api scheduled-action`, then sdk `sync-specs && generate`,
  then `gen-tools`, then the sdk-mcp snapshots. Run them with
  `CODE_MODE_ASSETS_DIR=<nix store code-mode-assets>` and `SQLX_OFFLINE=true`.
  - Revert the `packages/sdk/generated/*/core/serverSentEvents.gen.ts` changes
    afterwards: local node_modules lack the hey-api patch.
  - The "license must have required property" swagger warning is pre-existing.
- Web `bun run type-check` fails in a shallow clone at the icon check. Run the
  tsc line directly.
- The harness's event-run worker starting only with PostHog is deliberate.
  `scheduling/test.rs` is main's again.

## Skipped

- Old proof screenshots and the `walkthrough.webm` (4.3 MB): pre-change, to be
  re-recorded.
- The `proof/out*`, `site*` and `frames` directories, and build and regen logs.
