#![deny(missing_docs)]
//! Task duplicate detection.
//!
//! The crate keeps the duplicate-detection workflow behind ports so the judge,
//! match persistence, and live-update transport can be swapped independently.
//! Embedding, reranking, and vector storage are provided by the [`embedding`]
//! crate's traits and injected as generic parameters into [`TaskDedupService`].

pub mod domain;
pub mod outbound;

use embedding::embedding_provider::openai::{DIMS, TextEmbedding3Small};

pub use domain::models::{
    JudgeResult, NewTask, TaskDedupError, TaskDuplicate, TaskSearchParameters, TaskSimilarityResult,
};
pub use domain::service::{TaskDedupConfig, TaskDedupService};
use outbound::postgres::PgTaskVectorDb;
use outbound::reranker::NoOpReranker;

/// The production task-dedup service: OpenAI `text-embedding-3-small` embeddings,
/// a Postgres/pgvector store, and the no-op reranker. Consumers depend on this
/// concrete type so the generic [`TaskDedupService`] parameters do not leak into
/// axum state and handler signatures.
pub type PgTaskDedupService =
    TaskDedupService<DIMS, TextEmbedding3Small, PgTaskVectorDb, NoOpReranker>;
