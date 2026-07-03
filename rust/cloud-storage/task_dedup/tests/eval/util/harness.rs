//! Building the real dedup service (OpenAI embedder + Anthropic judge) and the
//! environment it needs.

use std::sync::Arc;

use async_trait::async_trait;
use embedding::embedding_provider::openai::{DIMS, TextEmbedding3Small};
use sqlx::PgPool;
use task_dedup::domain::ports::TaskDedupNotifier;
use task_dedup::outbound::judge::AgentDuplicateJudge;
use task_dedup::outbound::postgres::{PgTaskMatchRepo, PgTaskVectorDb};
use task_dedup::{TaskDedupConfig, TaskDedupService};

use super::rerank::NoOpReranker;

/// The service shape the evals run: the production embedder, store, and judge,
/// but the test-only [`NoOpReranker`] so measurements isolate embedding + judge
/// quality (production `PgTaskDedupService` runs the Cohere reranker).
pub type EvalDedupService =
    TaskDedupService<DIMS, TextEmbedding3Small, PgTaskVectorDb, NoOpReranker>;

/// Concurrency for the parallel measurement loops. The heavy work is network
/// (OpenAI / Anthropic) and DB connections are released across awaits, so a
/// handful of in-flight pairs keeps well within the test pool.
pub const EVAL_CONCURRENCY: usize = 6;

macro_env_var::env_var! {
    /// Env read directly by the eval (the embedder key). The judge reads its own
    /// keys through the agent router.
    struct EvalVars {
        OpenaiApiKey,
    }
}

/// The OpenAI key for the embedder, with a clear message when it is missing.
pub fn openai_key() -> String {
    EvalVars::new()
        .expect(
            "OPENAI_API_KEY must be set to run the semantic eval; \
             export it (and ANTHROPIC_API_KEY / CEREBRAS_API_KEY for the judge) first",
        )
        .openai_api_key
        .as_ref()
        .to_string()
}

macro_env_var::env_var! {
    /// Env read only by the rerank-floor eval, which runs the production Cohere
    /// reranker instead of [`NoOpReranker`](super::rerank::NoOpReranker).
    struct CohereVars {
        CohereApiKey,
    }
}

/// The Cohere key for the production reranker, with a clear message when it is
/// missing.
pub fn cohere_key() -> String {
    CohereVars::new()
        .expect(
            "COHERE_API_KEY must be set to run the rerank-floor eval \
             (it scores with the production Cohere reranker); export it first",
        )
        .cohere_api_key
        .as_ref()
        .to_string()
}

/// Notifier that drops live-update notifications (irrelevant to the eval).
struct NoopNotifier;

#[async_trait]
impl TaskDedupNotifier for NoopNotifier {
    async fn notify_matches_updated(&self, _document_id: &str) -> anyhow::Result<()> {
        Ok(())
    }
}

/// Builds the eval service (real embedder + judge, no-op reranker) over `pool`
/// with the given config. The judge records usage into the ephemeral db's
/// ai_usage table.
pub fn build_service(pool: &PgPool, config: TaskDedupConfig) -> EvalDedupService {
    TaskDedupService::with_config(
        config,
        TextEmbedding3Small::new(openai_key()),
        PgTaskVectorDb::new(pool.clone()),
        NoOpReranker,
        Arc::new(AgentDuplicateJudge::new(ai_usage::pg_recorder(
            pool.clone(),
        ))),
        Arc::new(NoopNotifier),
        Arc::new(PgTaskMatchRepo::new(pool.clone())),
    )
}
