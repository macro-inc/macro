# task_dedup

## What it is

Part of the Projects/Tasks feature — detects duplicate tasks by embedding a
task, searching a pgvector corpus, and judging candidate duplicates with an
LLM.

## Start here

- `src/lib.rs`: `TaskDedupService<Embedder, VectorDb, Judge>` and the
  production `TaskDedup` type alias (OpenAI embeddings + Postgres/pgvector +
  Cohere reranker).
- `src/domain/service.rs`: the duplicate-detection workflow, generic over the
  embedding, vector-db, and judge ports.
- `src/outbound/{cohere,connection_gateway,judge,postgres}.rs`: concrete
  adapters for each port.
- `src/eval/corpus.rs`: labeled-corpus loading for the semantic eval.

## Scope

- Owns: the embed → search → rerank → judge pipeline and its Postgres/pgvector
  storage.
- Not here: the embedding provider implementation itself → `embedding` crate;
  task domain logic → `crates/documents`/wherever tasks are modeled.

## Boundaries

- Depends on: `agent`, `embedding`, `lexical_client`; `backfill`-feature-gated
  `macro_entrypoint`, `macro_aws_config`, `secretsmanager_client`.
- Used by: `services/document_storage_service`, `crates/documents`.

## Recipes

- Add a judge or embedding provider: implement the matching port in
  `src/domain/ports.rs` → new `src/outbound/<provider>.rs` → wire into the
  `TaskDedup` alias in `src/lib.rs`.
- Add an eval case: drop a file under `tests/eval/cases/` (auto-discovered by
  `tests/eval/main.rs`) → `just crates/task_dedup/eval [name]`.

Lexical client startup requires `LEXICAL_ROUTE_MODES`; see the
[route-switch configuration](../lexical_client/README.md).

## Checks

- `cargo test -p task_dedup` (`SQLX_OFFLINE` unset).
- `just crates/task_dedup/eval` — real OpenAI/Anthropic/Cohere calls against
  the labeled corpus; needs local MacroDB plus `OPENAI_API_KEY`,
  `ANTHROPIC_API_KEY`, `CEREBRAS_API_KEY`. Costs money and is noisy; read
  before running (see `justfile`).

## Related

- Rules: `.agents/rules/rust/architecture.md`

Lexical caller mode checks use hand-written `lexical_client/test-utils` boundaries;
verify HTTP call counts and independent raw-source reads in all three modes.
