//! Database row items in search results. Rows are found through the
//! `database_rows` index, but every field here is read from Postgres when the
//! search runs: the index only proposes rows.

use chrono::{DateTime, Utc};
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;
use uuid::Uuid;

/// A database row matching a search.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize, ToSchema, JsonSchema)]
pub struct DatabaseRowSearchResponseItem {
    /// The database holding the row.
    pub database_id: Uuid,
    /// The table holding the row.
    pub table_id: Uuid,
    /// The row.
    pub row_id: Uuid,
    /// The database's name.
    pub database_name: String,
    /// The table's name.
    pub table_name: String,
    /// The row's title: its primary column, or its first column when the
    /// table has none, as plain text. Empty when that cell is empty.
    pub title: String,
    /// The matching passage of one of the row's cells, matched words wrapped
    /// in `<macro_em>…</macro_em>`. Absent when only the title matched.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub snippet: Option<String>,
    /// When the row was last written.
    pub updated_at: DateTime<Utc>,
}
