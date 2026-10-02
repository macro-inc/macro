# Agent folds

This directory contains the pure, deterministic folds used to turn agent
transcripts into messages for Macro. Keep filesystem tailing, process control,
transport, credentials, and session ownership in their adapters.

- `agent_fold`: ACP protocol frames to Macro messages and lifecycle events.

Package names remain stable; only their workspace paths live under `folds/`.
Run each package's tests from the repository root.
