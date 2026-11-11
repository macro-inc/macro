//! The SQL subset agents and the console use to read and write Macro
//! databases.
//!
//! The grammar is the contract: only statements this crate can carry all the
//! way to a GraphQL query and a row fold are parseable, so nothing is accepted
//! here and rejected later. The pipeline is
//!
//! ```text
//! sql string ── parse ──▶ subset AST ── resolve ──▶ (catalog-bound query)
//!            ── split ──▶ one GraphQL query per table + post-processing
//!            ── engine ──▶ fetch requests, one at a time ── fold ──▶ rows
//!                      └──▶ for a write, one batch of ops ──▶ what it did
//! ```
//!
//! This crate compiles natively and to `wasm32`; keep it free of native-only
//! dependencies.
#![deny(missing_docs)]

pub mod catalog;
pub mod engine;
pub mod fold;
pub mod formula;
pub mod parse;
pub mod resolve;
pub mod run;
pub mod split;
#[cfg(test)]
mod test_support;
pub mod view;
#[cfg(target_arch = "wasm32")]
pub mod wasm;
mod write;

pub use catalog::Catalog;
pub use engine::{Engine, Request, Step};
pub use fold::{Bin, Cell, Row, Table, fold_bins, fold_relations};
pub use parse::{ParseError, parse};
pub use resolve::{CompileError, Query, ResolveError, compile, resolve};
pub use run::{
    AlteredColumn, Answer, EngineError, Input, OpResultKind, OpsSink, Outcome, OutcomeColumn,
    OutcomeKind, Page, RowSource, RunError, RunFailure, SentOp, result_columns, run,
};
pub use split::{
    GqlQuery, JoinPlan, KeyHint, MAX_KEY_HINT_VALUES, Plan, Propf, PropfLiteral, PropfValue,
    RelationPlan, Shape, split,
};
pub use view::{Board, BoardLane, board, compile_table_query, compile_view};
