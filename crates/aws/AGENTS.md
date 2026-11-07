# crates/aws

## What it is

AWS SDK adapters: one thin crate per AWS service the backend calls, plus `macro_aws_config` (shared SDK config) and `sqs_worker` (the SQS polling loop that queue consumers are built on).

Layer: `aws` in [`.config/layers.toml`](../../.config/layers.toml), which
lists what this group may depend on. `cargo x deps` reports edges that break it.

## Crates

| Crate | What it is |
| --- | --- |
| `dynamodb_client` |  |
| `lambda_client` |  |
| `macro_aws_config` |  |
| [`s3_client`](s3_client/AGENTS.md) | Part of shared infrastructure (cloud storage). |
| `secretsmanager_client` |  |
| [`ses_client`](ses_client/AGENTS.md) | Part of shared infrastructure (transactional email). |
| `sns_client` |  |
| [`sqs_client`](sqs_client/AGENTS.md) | Shared infrastructure — a thin SQS client plus one queue-specific enqueue module per consumer, gated behind Cargo features, used by any service or crate that produces or … |
| `sqs_worker` |  |

## Recipes

- Add a crate here: create `crates/aws/<name>` with its own `AGENTS.md`
  (from `.agents/templates/AGENTS.md`), add it to the root `members` and run
  `cargo x deps`, which adds its `[workspace.dependencies]` entry once
  something depends on it. Add it to the table above.
