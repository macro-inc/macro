# Agent folds

This directory contains the pure, deterministic folds used to turn agent
transcripts into messages for Macro. Keep filesystem tailing, process control,
transport, credentials, and session ownership in their adapters.

- `claude_fold`: Claude Code JSONL to ACP updates and turn facts.
- `codex_fold`: Codex rollout JSONL to ACP updates and turn facts.
- `agent_fold`: ACP protocol frames to Macro messages and lifecycle events.

Package names remain stable; only their workspace paths live under `folds/`.
Run each package's tests from the repository root.

Native folds implement `agent_fold::domain::transcript::Fold`. Their fixtures are
synthetic transcripts with pinned output snapshots. Runtime adapters consume the
same events; there is no separate parsing implementation in macrod.
