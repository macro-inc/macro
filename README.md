# Channels local sync: working notes

Kept outside the product branches so they survive a machine change. Nothing here is built or shipped.

- `harness/`: measurement and proof scripts, their logs, and result files (`results/`, `parity/`, `flake830/`, `suite-runs/`).
- `scratchpad/`: helper scripts, PR body drafts, check logs and the page source from the working session.
- `proofs/`: the proof pages as served.
- `messages-proofs/`: the query plan, latency and admission scripts and result files that were under `crates/messages/proofs/` on the change sequence branch (as of `3d4498c36f0`). Run them from a checkout of that branch with the folder copied back to `crates/messages/proofs/`.
