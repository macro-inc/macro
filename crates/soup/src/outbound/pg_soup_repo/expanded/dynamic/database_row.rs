//! Database row clauses for the flat and grouped Soup queries: a row is visible
//! when its database is untrashed and the viewer holds a grant on it.

use filter_ast::Expr;
use item_filters::ast::database_row::DatabaseRowLiteral;
use models_pagination::SimpleSortMethod;

use super::access_semi_join;

pub(in crate::outbound::pg_soup_repo) use item_filters::ast::database_row::database_rows_requested as database_row_opted_in;

pub(in crate::outbound::pg_soup_repo) fn build_database_row_filter(
    filter: Option<&Expr<DatabaseRowLiteral>>,
) -> String {
    fn fold(expr: &Expr<DatabaseRowLiteral>) -> String {
        match expr {
            Expr::And(a, b) => format!("({} AND {})", fold(a), fold(b)),
            Expr::Or(a, b) => format!("({} OR {})", fold(a), fold(b)),
            Expr::Not(a) => format!("NOT ({})", fold(a)),
            Expr::Literal(DatabaseRowLiteral::TableId(id)) => format!("r.table_id = '{id}'"),
            Expr::Literal(DatabaseRowLiteral::Id(id)) => format!("r.id = '{id}'"),
        }
    }
    filter
        .map(|expr| format!(" AND ({})", fold(expr)))
        .unwrap_or_default()
}

/// Rows are never viewed on their own: `ViewedAt` sorts them last and `ViewedUpdated`
/// uses `updated_at`, matching [`models_soup::item::SoupItem`]'s cursor.
pub(super) fn database_row_top_clause(sort: SimpleSortMethod, grouped: bool) -> String {
    let sort_ts = match sort {
        SimpleSortMethod::CreatedAt => "r.created_at",
        SimpleSortMethod::ViewedAt => "'1970-01-01 00:00:00+00'",
        SimpleSortMethod::UpdatedAt | SimpleSortMethod::ViewedUpdated => "r.updated_at",
    };
    let group_columns = if grouped {
        ", NULL::text as project_id, 'DATABASE_ROW'::property_entity_type as property_entity_type"
    } else {
        ""
    };
    format!(
        r#"SELECT 'database_row'::text as item_type, r.id::text as id,
        {sort_ts}::timestamptz as sort_ts {group_columns}
        FROM database_rows r
        JOIN database_tables row_table ON row_table.id = r.table_id
        JOIN databases row_database ON row_database.id = row_table.database_id
        WHERE row_database.trashed_at IS NULL AND {}"#,
        access_semi_join("row_database.id::text", "database")
    )
}
