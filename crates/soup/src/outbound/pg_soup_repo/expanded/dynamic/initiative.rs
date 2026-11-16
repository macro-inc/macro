//! Initiative SQL clauses for the shared flat and grouped Soup queries.

use chrono::{DateTime, Utc};
use filter_ast::Expr;
use item_filters::ast::initiative::InitiativeLiteral;
use models_pagination::SimpleSortMethod;
use recursion::CollapsibleExt;
use system_properties::SystemPropertyKey;

use super::{build_notification_state_clause, sql_string_literal, top_needs_user_history};
use crate::outbound::pg_soup_repo::candidate_gates::PER_CANDIDATE;

/// The initiative listing policy: explicit grants and the owner's team link.
/// Public links do not enumerate otherwise undiscovered initiatives.
///
/// This per-row form gates initiatives whose ids are already known (feed
/// candidates, by-id reads, listings that name their ids): both checks run per
/// initiative against sources collected once into an array, so cost follows
/// the candidate count. Other listings use [`INITIATIVE_LISTING_ACCESS`], the
/// same policy as a set.
pub(in crate::outbound::pg_soup_repo) fn initiative_access_clause() -> String {
    format!(
        r#"(EXISTS (
        SELECT 1 FROM entity_access ea
        WHERE ea.entity_id = i.id AND ea.entity_type = 'initiative'
        AND ea.source_id = ANY(ARRAY(SELECT source_id FROM user_source_ids))
        {PER_CANDIDATE}
    ) OR EXISTS (
        SELECT 1 FROM "SharePermission" sp
        JOIN team_user owner_team ON owner_team.user_id = i.owner_user_id
        WHERE sp.id = i.share_permission_id AND sp."linkShare" = 'TEAM'
        AND owner_team.team_id::text = ANY(ARRAY(SELECT source_id FROM user_source_ids))
    ))"#
    )
}

/// [`initiative_access_clause`] as the set of initiatives the caller can list,
/// so a listing starts from the caller's grants and team instead of testing
/// every initiative in the table. Building the set costs one index descent per
/// source, so a listing that names its ids keeps the per-row form
/// ([`names_initiative_ids`]).
///
/// The grant leg is one `(source_id, entity_type, entity_id)` index descent per
/// source, returning only that source's initiative grants. The team link leg
/// reads the initiatives owned by the caller's teammates, found through the
/// caller's own `team_user` rows (the team ids among their sources), and
/// checks each one's link, so it costs what the team owns, not the page.
/// Matching `team_id::text` against the source array instead reads all of
/// `team_user`.
///
/// Both the set and the owners are collected into arrays, so `initiative` is
/// reached by its primary key and owner index whatever the statistics say:
/// with stale ones, a plain `IN` or join was planned as sequential scans of
/// `initiative` and `"SharePermission"`.
const INITIATIVE_LISTING_ACCESS: &str = r#"i.id = ANY(ARRAY(
        SELECT ea.entity_id FROM entity_access ea
        WHERE ea.entity_type = 'initiative'
        AND ea.source_id = ANY(ARRAY(SELECT source_id FROM user_source_ids))
        UNION
        SELECT owned.id FROM initiative owned
        JOIN "SharePermission" sp ON sp.id = owned.share_permission_id AND sp."linkShare" = 'TEAM'
        WHERE owned.owner_user_id = ANY(ARRAY(
            SELECT owner_team.user_id FROM team_user viewer_team
            JOIN team_user owner_team ON owner_team.team_id = viewer_team.team_id
            WHERE viewer_team.user_id = $1
        ))
    ))"#;

pub(in crate::outbound::pg_soup_repo) use item_filters::ast::initiative::initiatives_requested as initiative_opted_in;

/// Whether `filter` admits only initiatives it names by id: GraphQL hydrates
/// through the listing that way, and names the nil id to rule initiatives out.
/// Those rows are known before access is checked, so they are checked one by
/// one instead of building the caller's whole accessible set.
fn names_initiative_ids(filter: Option<&Expr<InitiativeLiteral>>) -> bool {
    filter.is_some_and(|expr| {
        expr.collapse_frames(|frame| match frame {
            filter_ast::ExprFrame::And(a, b) => a || b,
            filter_ast::ExprFrame::Or(a, b) => a && b,
            filter_ast::ExprFrame::Not(_) => false,
            filter_ast::ExprFrame::Literal(InitiativeLiteral::Id(_)) => true,
            filter_ast::ExprFrame::Literal(_) => false,
        })
    })
}

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
            Expr::Literal(InitiativeLiteral::NotificationState(state)) => {
                build_notification_state_clause("i.id", "initiative", *state)
            }
        }
    }
    fn due_date_filter(operator: &str, date: &DateTime<Utc>) -> String {
        let value = super::property_date_expression("ep_due");
        format!(
            "EXISTS (SELECT 1 FROM entity_properties ep_due WHERE ep_due.entity_id = i.id::text AND ep_due.entity_type = 'INITIATIVE' AND ep_due.property_definition_id = '{}' AND {value} {operator} '{}'::timestamptz)",
            SystemPropertyKey::DUE_DATE_UUID,
            date.to_rfc3339(),
        )
    }
    filter
        .map(|expr| format!(" AND ({})", fold(expr)))
        .unwrap_or_default()
}

pub(super) fn initiative_top_clause(
    sort: SimpleSortMethod,
    grouped: bool,
    property_sort: bool,
    name_sort: bool,
    filter: Option<&Expr<InitiativeLiteral>>,
) -> String {
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
    } else if property_sort {
        ", 'INITIATIVE'::property_entity_type as property_entity_type"
    } else {
        ""
    };
    let history_join = if top_needs_user_history(sort) {
        r#"LEFT JOIN "UserHistory" uh ON uh."itemId" = i.id::text AND uh."itemType" = 'initiative' AND uh."userId" = $1"#
    } else {
        ""
    };
    let access = if names_initiative_ids(filter) {
        initiative_access_clause()
    } else {
        INITIATIVE_LISTING_ACCESS.to_owned()
    };
    let name_column = super::name_sort_column(name_sort, "i.name");
    format!(
        r#"SELECT 'initiative'::text as item_type, i.id::text as id,
        {sort_ts}::timestamptz as sort_ts {group_columns}{name_column}
        FROM initiative i
        {history_join}
        WHERE {access}"#
    )
}
