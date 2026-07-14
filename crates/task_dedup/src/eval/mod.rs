//! Semantic-evaluation harness for task duplicate detection.
//!
//! Task dedup quality can only be judged against realistic, *labeled* data: the
//! in-memory service tests exercise the pipeline's wiring, but say nothing about
//! whether the embeddings + judge actually separate duplicates from
//! non-duplicates. This module holds the shared corpus schema those measurements
//! run against — a set of tasks plus hand-labeled pairs tagged with the case
//! they exercise (rephrasing, same-project-different-action, etc.).
//!
//! The corpus is produced two ways and merged:
//! - a committed snapshot of real production tasks created by Macro employees
//!   (pulled read-only by the `pull_task_corpus` binary), and
//! - hand-authored synthetic pairs that pin down the canonical cases from the
//!   dedup spec.
//!
//! The measurement itself (embedding + judge accuracy, precision/recall) lives
//! in the `semantic_eval` integration test, which loads a corpus, seeds it into
//! an ephemeral database, and runs the real pipeline against it. Keeping only
//! the data model here lets both the puller and the test share one schema
//! without pulling the test's heavy dependencies into normal builds.

pub mod corpus;

pub use corpus::{CorpusTask, EvalCorpus, LabeledPair, PairCase, TaskSource};
