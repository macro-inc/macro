//! Shared support for the semantic-eval tests.
//!
//! Each measurement lives in its own file under `cases/`, auto-discovered by
//! `automod` in `main.rs`, and reaches this module as `crate::util`. It is
//! split by concern so no single file is a grab-bag:
//! - [`corpus`] — load the labeled corpus and per-task helpers,
//! - [`seed`] — insert the DB rows a measurement needs,
//! - [`harness`] — build the real service (OpenAI embedder + Anthropic judge),
//! - [`metrics`] — confusion matrix + text report,
//! - [`rerank`] — the test-only no-op reranker the eval services run with.
//!
//! `#![allow(dead_code)]` because each measurement uses only the slice of this
//! module it needs; items unused by a given measurement would otherwise warn.
#![allow(dead_code)]

pub mod corpus;
pub mod harness;
pub mod metrics;
pub mod rerank;
pub mod seed;
