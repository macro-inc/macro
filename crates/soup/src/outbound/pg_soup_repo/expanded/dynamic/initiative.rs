//! Initiative SQL clauses for the shared flat and grouped Soup queries.

use chrono::{DateTime, Utc};
use filter_ast::Expr;
use item_filters::ast::initiative::InitiativeLiteral;
use models_pagination::SimpleSortMethod;
use system_properties::SystemPropertyKey;

use super::{SOURCE_IDS_SQL, access_semi_join, sql_string_literal, top_needs_user_history};

/// The initiative listing policy: explicit grants and the owner's team link.
/// Public links do not enumerate otherwise undiscovered initiatives.
pub(in crate::outbound::pg_soup_repo) fn initiative_access_clause(source_ids_sql: &str) -> String {
    format!(
        r#"({} OR EXISTS (
        SELECT 1 FROM "SharePermission" sp
        JOIN team_user owner_team ON owner_team.user_id = i.owner_user_id
        WHERE sp.id = i.share_permission_id AND sp."linkShare" = 'TEAM'
        AND owner_team.team_id::text = ANY({source_ids_sql})
    ))"#,
        access_semi_join("i.id::text", "initiative", source_ids_sql)
    )
}

pub(in crate::outbound::pg_soup_repo) use item_filters::ast::initiative::initiatives_requested as initiative_opted_in;

pub(in crate::outbound::pg_soup_repo) fn build_initiative_filter(
    filter: Option<&Expr<InitiativeLiteral>>,
) -> String {
    fn fold(expr: &Expr<InitiativeLiteral>) -> String {
        match expr {
            Expr::And(a, b) => format!("({} AND {})", fold(a), fold(b)),
            Expr::Or(a, b) => format!("({} OR {})", fold(a), fold(b)),
            Expr::Not(a) => format!("NOT ({})", fold(a)),
            Expr::Literal(InitiativeLiteral::Include) => "TRUE".into(),
            Expr::Literal(InitiativeLiteral::Id(id)) => format!("i.id = '{id}'"),
            Expr::Literal(InitiativeLiteral::Owner(owner)) => format!(
                "i.owner_user_id = {}",
                sql_string_literal(&owner.to_string())
            ),
            Expr::Literal(InitiativeLiteral::NameContains(name)) => format!(
                "strpos(lower(i.name), lower({})) > 0",
                sql_string_literal(name)
            ),
            Expr::Literal(InitiativeLiteral::DueBefore(date)) => due_date_filter("<=", date),
            Expr::Literal(InitiativeLiteral::DueAfter(date)) => due_date_filter(">=", date),
        }
    }
    fn due_date_filter(operator: &str, date: &DateTime<Utc>) -> String {
        format!(
            "EXISTS (SELECT 1 FROM entity_properties ep_due WHERE ep_due.entity_id = i.id::text AND ep_due.entity_type = 'INITIATIVE' AND ep_due.property_definition_id = '{}' AND (ep_due.values->>'value')::timestamptz {operator} '{}'::timestamptz)",
            SystemPropertyKey::DUE_DATE_UUID,
            date.to_rfc3339()
        )
    }
    filter
        .map(|expr| format!(" AND ({})", fold(expr)))
        .unwrap_or_default()
}

pub(super) fn initiative_top_clause(sort: SimpleSortMethod, grouped: bool) -> String {
    let sort_ts = match sort {
        SimpleSortMethod::CreatedAt => "i.created_at",
        SimpleSortMethod::UpdatedAt => "i.updated_at",
        SimpleSortMethod::ViewedAt => {
            "COALESCE(uh.\"updatedAt\"::timestamptz, '1970-01-01'::timestamptz)"
        }
        SimpleSortMethod::ViewedUpdated => "COALESCE(uh.\"updatedAt\"::timestamptz, i.updated_at)",
    };
    let group_columns = if grouped {
        ", NULL::text as project_id, 'INITIATIVE'::property_entity_type as property_entity_type"
    } else {
        ""
    };
    let history_join = if top_needs_user_history(sort) {
        r#"LEFT JOIN "UserHistory" uh ON uh."itemId" = i.id::text AND uh."itemType" = 'initiative' AND uh."userId" = $1"#
    } else {
        ""
    };
    format!(
        r#"SELECT 'initiative'::text as item_type, i.id::text as id,
        {sort_ts}::timestamptz as sort_ts {group_columns}
        FROM initiative i
        {history_join}
        WHERE {}"#,
        initiative_access_clause(SOURCE_IDS_SQL)
    )
}
