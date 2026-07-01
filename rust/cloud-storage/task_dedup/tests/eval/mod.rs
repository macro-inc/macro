//! Shared support for the semantic-eval test binaries.
//!
//! Each measurement lives in its own top-level test file (`eval_*.rs`) and pulls
//! this module in with `mod eval;`. It is split by concern so no single file is a
//! grab-bag:
//! - [`corpus`] — load the labeled corpus and per-task helpers,
//! - [`seed`] — insert the DB rows a measurement needs,
//! - [`harness`] — build the real service (OpenAI embedder + Anthropic judge),
//! - [`metrics`] — confusion matrix + text report.
//!
//! `#![allow(dead_code)]` because each test binary uses only the slice of this
//! module it needs; items unused by a given binary would otherwise warn.
#![allow(dead_code)]

pub mod corpus;
pub mod harness;
pub mod metrics;
pub mod seed;
