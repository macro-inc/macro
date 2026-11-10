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
  one row per model call (timing, tokens, prompt part sizes).

## Recipes

- Prod session: `tooling/agent-session-view/agent-session-view <session-id>`;
  dev: add `--env dev`. Output lands in `~/.cache/agent-session-view/<id>.html`.
- Re-render without a database: `--save-json` once, then `--from-json`.
- Open it from another machine: `--serve PORT --bind 0.0.0.0` (or the
  tailnet IP). `--serve` alone listens on 127.0.0.1 only: the server has no
  auth and session logs are user content.
- Markdown for agents: `--markdown`; many sessions: `--query` with filters
  (`--help`). How to analyse them: the `agent-session-analysis` skill.
- True tool durations and the model-call lane: add `--datadog` with
  `DD_API_KEY` and `DD_APP_KEY` exported (Datadog us5; `DD_SITE` overrides).
  Spans are kept 15 days, so older sessions have none.

## Checks

- `python3 -m unittest discover tooling/agent-session-view` (stdlib only).
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
- `chat_streaming` spans carry no session id; they are found through the
  traces of the session's `execute_tool` and `invoke_agent` spans.

## Related

- Docs: `crates/agent_session/README.md` (telemetry fields)
