use filter_ast::Expr;
use serde::{Deserialize, Serialize};
use uuid::Uuid;

/// A database row filter literal. Rows are off by default: only an explicit
/// include or naming a table or row opts a query into them.
#[derive(Debug, Serialize, Deserialize, Clone, PartialEq, Eq)]
pub enum DatabaseRowLiteral {
    /// Opt into accessible rows of every table.
    #[serde(rename = "inc")]
    Include,
    /// Rows of this table.
    #[serde(rename = "t")]
    TableId(Uuid),
    /// This row.
    #[serde(rename = "id")]
    Id(Uuid),
}

/// Whether the expression asks for rows at all: an include, table or row
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
