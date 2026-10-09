//! A webhook, and what creating and calling one answers.

use chrono::{DateTime, Utc};
use databases::domain::models::DatabaseError;
use models_databases::{DatabaseId, RowId, TableId};
use uuid::Uuid;

/// A webhook's id.
pub type WebhookId = Uuid;

/// A webhook: a secret URL whose calls insert rows into one table.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DatabaseWebhook {
    /// Identifier.
    pub id: WebhookId,
    /// The database the table belongs to.
    pub database_id: DatabaseId,
    /// The table its calls insert rows into.
    pub table_id: TableId,
    /// Who created it; its writes act with their access.
    pub created_by: String,
    /// The token's first characters, to tell webhooks apart.
    pub token_prefix: String,
    /// Creation time.
    pub created_at: DateTime<Utc>,
}

/// A webhook as it is stored: the token only as its hash.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewWebhook {
    /// Identifier.
    pub id: WebhookId,
    /// The database the table belongs to.
    pub database_id: DatabaseId,
    /// The table its calls insert rows into.
    pub table_id: TableId,
    /// Who created it.
    pub created_by: String,
    /// SHA-256 of the token.
    pub token_hash: [u8; 32],
    /// The token's first characters.
    pub token_prefix: String,
}

/// A new webhook and its token, which is shown this once and never again.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct CreatedWebhook {
    /// The webhook.
    pub webhook: DatabaseWebhook,
    /// The secret its URL carries.
    pub token: String,
}

/// What a call to a webhook inserted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Delivery {
    /// The database.
    pub database_id: DatabaseId,
    /// The table.
    pub table_id: TableId,
    /// The new rows, in the order the payload sent them.
    pub rows: Vec<RowId>,
}

/// One thing wrong with a payload.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PayloadProblem {
    /// The row's index when the payload is an array of rows.
    pub row: Option<usize>,
    /// The key at fault, when one is.
    pub field: Option<String>,
    /// What is wrong.
    pub message: String,
}

/// Why a webhook use case failed.
#[derive(Debug, thiserror::Error)]
pub enum DatabaseWebhookError {
    /// No such webhook, table or database, or none the caller can see.
    #[error("not found")]
    NotFound,
    /// The caller may not do this.
    #[error("{0}")]
    Forbidden(&'static str),
    /// The payload does not fit the table; nothing was written.
    #[error("the payload does not fit the table")]
    InvalidPayload(Vec<PayloadProblem>),
    /// The databases service refused or failed.
    #[error("{0}")]
    Database(DatabaseError),
    /// Persistence failure.
    #[error("repository error: {0}")]
    Repository(rootcause::Report),
}
