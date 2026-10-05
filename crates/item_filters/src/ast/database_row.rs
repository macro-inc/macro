use filter_ast::Expr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A database row filter literal. Rows are off by default: only naming a
/// table or a row opts a query into them, so Home, Search and Recent never list them.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub enum DatabaseRowLiteral {
    /// Rows of this table.
    #[serde(rename = "t")]
    TableId(Uuid),
    /// This row.
    #[serde(rename = "id")]
    Id(Uuid),
}

/// Whether the expression asks for rows at all: some table or row is named
/// outside a `NOT`. A missing filter or a solely negative one keeps rows out.
pub fn database_rows_requested(filter: Option<&Expr<DatabaseRowLiteral>>) -> bool {
    match filter {
        Some(Expr::Literal(_)) => true,
        Some(Expr::And(a, b) | Expr::Or(a, b)) => {
            database_rows_requested(Some(a)) || database_rows_requested(Some(b))
        }
        Some(Expr::Not(_)) | None => false,
    }
}
