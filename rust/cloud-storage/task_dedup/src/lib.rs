#![deny(missing_docs)]
//! Task duplicate detection.
//!
//! The crate keeps the duplicate-detection workflow behind domain ports so the
//! embedding model, candidate retrieval, judge, persistence repo, and live
//! update transport can be swapped independently.

pub mod domain;
pub mod outbound;

pub use domain::models::{
    JudgeResult, NewTask, TaskDedupError, TaskDuplicate, TaskDuplicateCandidate,
    TaskSimilarityResult,
};
pub use domain::service::{TaskDedupConfig, TaskDedupService};
