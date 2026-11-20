# agent-session-view

## What it is

Part of agent sessions: a read-only CLI that renders one session's ACP log
(`agent_session_log`) as a self-contained HTML timeline of model rounds, tool
calls, gaps and failures, for finding out why a session was slow or wrong.

## Start here

- `agent-session-view`: the CLI (Python stdlib only). Fetches the session and
  its frames, or reads an export, and fills `template.html`.
- `template.html`: the viewer; the export is inlined as `__SESSION_JSON__`.
- `markdown_export.py`: `--markdown` and `--query` output, a dense summary
  per session (`<id>.md`), its uncut code and results (`<id>.full.md`), and a
  batch `index.md`.
- `test_agent_session_view.py`: the exporters' and CLI's unit tests.
- `datadog_spans.py`: `--datadog`, the session's `execute_tool` and
  `chat_streaming` spans: tool start and end, result size and cut flag, and
  one row per model call (timing, tokens, prompt part sizes, eager and loaded
  tool counts); each turn's `select_documentation` span; and the tool names
  on each `invoke_agent` span.
- `turn_context.py`: what the model had in each turn, joined from those
  spans: the SDK docs selection, eager, loaded and deferred tools, the
  largest prompt's parts, and flags (`no-sdk-index`, `guessed-sdk-methods`,
  `repeated-failure`, `failing-code`, ...). The viewer and the markdown both
  show it.
- `token_usage.py`: tokens and cost. The session's `ai_usage` rows (in the
  export as `usage`) reconciled with its `chat_streaming` spans: each span as
  uncached / cache read / cache write / output, rows matched to spans,
  per-model, per-turn and coverage totals, and which model call each
  thought, message and tool call streamed in (`frame_rounds`). The viewer
  and the markdown both show it.
- `reconstruct.py` and `asv_reconstruct.rs`: `--reconstruct`, the literal
  text of each turn's reproducible prompt parts (the `<macro_sdk>` docs, the
  preamble, the Macro prompt with its area guides, the identity and the
  connected-integrations line), rebuilt by the code of the commit that served
  the turn and checked against the span's bytes and hash.

## Recipes

- Prod session: `tooling/agent-session-view/agent-session-view <session-id>`;
  dev: add `--env dev`. Output lands in `~/.cache/agent-session-view/<id>.html`.
  The export includes the session's `ai_usage` rows; an export saved before
  that shows span tokens only, with "cost unknown".
- Re-render without a database: `--save-json` once, then `--from-json`.
- Open it from another machine: `--serve PORT` serves that one page on
  127.0.0.1 and prints the `tailscale serve` lines that put it on the tailnet
  over HTTPS (the skill has the recipe); `--bind` a tailnet IP for plain HTTP.
  The server has no auth and session logs are user content.
- Markdown for agents: `--markdown`; many sessions: `--query` with filters
  (`--help`). How to analyse them: the `agent-session-analysis` skill.
- True tool durations and the model-call lane: add `--datadog` with
  `DD_API_KEY` and `DD_APP_KEY` exported (Datadog us5; `DD_SITE` overrides).
  Spans are kept 15 days, so older sessions have none. The turn context
  comes with it; viewer keys: `n`/`p` failures, `j`/`k` turns.
- Literal prompt parts: add `--reconstruct` to a `--datadog` render (or to
  `--from-json` of an export with spans). It needs `gh`, AWS read access for
  `ecs describe-task-definition`, and a Rust build: the first run at a commit
  checks it out under `~/.cache/agent-session-view/src/<sha>`, builds that
  commit's `code-mode-assets` Nix package (the generated SDK docs; a
  checkout without a bun install can't make them) and then `ai_tools`,
  which takes long; later runs read
  `~/.cache/agent-session-view/reconstruct/<sha>/`. Set `ASV_BUILD_WRAPPER`
  to prefix the build (a build-slot queue, `nice`).

## Checks

- `python3 -m unittest discover tooling/agent-session-view` (stdlib only).
- After changing `asv_reconstruct.rs`, run `--reconstruct` on a recent prod
  session and see every rebuilt part "verified".
- Render one export with `--from-json --out <scratch>.html` and open it, and
  again with `--markdown`.
- `--query` against a local database holding a prompted session: load
  `agent-session-view` with `importlib` and call `export_batch(url, args)`.

## Gotchas

- Prod reads go to the read replica through an SSM port-forward via the
  in-VPC tunnel box; the replica endpoint and box are looked up by name at
  run time. Keep instance ids and RDS hostnames out of this public repo.
- Every query runs with `default_transaction_read_only=on`. Session logs are
  user content: keep exports out of the repository.
- Frame times come from each row's `id`, a UUIDv7 minted when the frame was
  appended, never `created_at`: frames are buffered up to 1.5 s
  (`LOG_FLUSH_INTERVAL` in `crates/agent_session/src/domain/service.rs`) and a
  flush stamps a batch together. A tool's frames still bracket streamed output
  around it; `--datadog` gives its span's start and end.
- `chat_streaming` and `select_documentation` spans carry no session id;
  they are found through the traces of the session's `execute_tool` and
  `invoke_agent` spans.
- No span names the eager tools, only their count and bytes
  (`macro.genai.prompt.tools.eager.*`). Names come from `EAGER_TOOLS`
  (`crates/ai_tools/src/lib.rs`) and `EAGER_INTERNAL_MCP_TOOLS`
  (`crates/agent_inmem/src/rig_engine.rs`) as checked out, kept where the
  session shows the tool. Fewer names than the span count is normal (code
  mode's own tools are not in those lists); a list that can't be read is the
  `eager-names-unknown` flag, and more names than the count is
  `eager-names-exceed-span`.
  Renaming either constant breaks this: update `EAGER_SOURCES` in
  `turn_context.py`.
- The deploy commit: no span carries a version. The span's ECS
  `task_family` tag names a task definition; the "Deploy Production Release"
  run that was running when it was registered has the commit, whatever the
  run's conclusion: one failed job (an unrelated worker) marks a run
  "failure" though the services deployed. Otherwise the newest release
  deployed before the turn (its run, or a re-run's first attempt, finished;
  with no run listed, it was published) is used and labelled "inferred" with
  the reason; dev sessions always get the last `main` commit before the turn.
- Reconstructed parts: "verified" means the span's SHA-256 prefix (or, with
  no hash, its byte count) matches; "mismatch" is shown in red and as the
  `reconstruction-mismatch` flag; memory, session instructions, the session
  note, the model id line and the opener note are not rebuilt (per user, or
  inline in private functions) and show their size only. Tool schemas are not
  rebuilt: Macro's own code-mode tools come from the MCP server, not the
  harness process. `asv_reconstruct.rs` must compile at old commits: use only
  long-lived public items, and when one moves, the run fails loudly at that
  commit rather than guessing.
- Tokens: `ai_usage` is the authority for totals and cost; span tokens are
  never added to them. Anthropic spans report input without cached tokens,
  Gemini and OpenAI spans include them (uncached = input − cache read).
  Billed output includes reasoning; Gemini spans' output does not, so a row
  matches its spans on the input counters with output at least theirs. Some
  calls are billed one row per model call (Opus), others one row per turn
  summing its rounds (Gemini, Sonnet), so those turns' cost is not split
  per call; matching handles both. Side
  rows (`feature` other than `agent_session`: activity summaries, renames)
  are listed apart. The opener is recognised by `OPENER_MODEL` with no tools
  and few output tokens: when `crates/agent_inmem/src/outbound/rig_engine/opener.rs`
  changes its `MODEL` or `MAX_TOKENS`, update `token_usage.py`
  (`OPENER_MODEL` is the name without its `openai/` prefix, as spans and
  `ai_usage` carry it). `ai_usage.model` is the price key, which can carry
  `:fast`, `:priority`, `:ultrafast` or `:long` suffixes
  (`crates/agent/src/model/metering/per_call.rs`); rows match spans on the
  bare model. A model's first call in a session is a cold cache write, not a
  miss. Matching
  windows are the named constants at the top of `token_usage.py`.
- `invoke_agent`'s `gen_ai.tool.definitions` is cut at about 25 KB, so the
  deferred list can be partial. Only names, counts and sizes are read from
  spans, never their prompt or message text.

## Related

- Docs: `crates/agent_session/README.md` (telemetry fields)
