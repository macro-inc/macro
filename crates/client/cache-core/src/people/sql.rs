//! Scoped local SQL over the existing normalized contact records.

pub mod projection;
use crate::engine::HydrationScope;
pub use database_sql_engine::Outcome;
pub use database_sql_engine::local_people::{
    MAX_PEOPLE_SQL_BYTES, PeopleSqlPlan, SqlParameter, SqlScalar,
};
use serde::{Deserialize, Serialize};

/// A read-only SQL request or the identities needed by a bounded join.
#[derive(Clone, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
pub enum PeopleSqlInput {
    /// A SELECT over `macro.people`; physical cache tables are not addressable.
    Statement {
        /// SQL in the shared database grammar.
        sql: String,
    },
    /// A bounded keyed join; an empty list never means the entire directory.
    Identities {
        /// Explicit user identities, not display-name aliases.
        #[cfg_attr(any(test, feature = "schema"), schemars(length(max = 500)))]
        ids: Vec<String>,
    },
}

/// The account and storage generation that own this read.
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
pub struct PeopleSqlRequest {
    /// Admission fence checked under the host's engine lock.
    pub scope: HydrationScope,
    /// Read-only statement or bounded identity request.
    pub input: PeopleSqlInput,
}

/// A local answer is not a claim that directory synchronization has completed.
/// Callers must check the current generation's complete backfill checkpoint.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
#[cfg_attr(any(test, feature = "schema"), derive(schemars::JsonSchema))]
pub enum PeopleSqlResult {
    /// This storage does not execute SQL. Never replace this with a directory fold.
    Unsupported,
    /// Some stored membership could not be projected safely.
    Incomplete,
    /// The selected text exceeds the byte budget; narrow the query or its limit.
    ResultTooLarge,
    /// Filtering, aggregation, ordering and limiting ran in local storage.
    Result {
        /// At most 500 final rows and no directory-sized intermediate relation.
        outcome: Outcome,
    },
}
