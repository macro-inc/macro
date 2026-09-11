//! Agent session leg of the PostgreSQL Soup repository.
//!
//! Agent sessions live in MacroDB and are authorized through `entity_access`
//! like chats, but they are **opt-in**: a query that says nothing about them
//! (no `agent_session_filter` in its AST) gets none. This mirrors reminders,
//! so adding sessions to Soup did not change what pre-existing views return.

use chrono::{DateTime, Utc};
use filter_ast::Expr;
use item_filters::ast::{
    agent_session::AgentSessionLiteral,
    properties::{PropertiesLiteral, properties_filter_matches_propertyless},
};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use model_entity::EntityType;
use models_pagination::{Query, SimpleSortMethod};
use models_soup::{agent_session::SoupAgentSession, item::SoupItem};
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::domain::models::{AdvancedSortParams, SimpleSortQuery, SimpleSortRequest};

#[cfg(test)]
mod test;

#[derive(FromRow)]
struct AgentSessionRow {
    id: Uuid,
    name: String,
    owner_id: String,
    bot_id: Uuid,
    thread_id: Option<Uuid>,
    status: String,
    status_event_name: Option<String>,
    created_at: DateTime<Utc>,
    modified_at: DateTime<Utc>,
    viewed_at: Option<DateTime<Utc>>,
}

struct CursorParts {
    sort: SimpleSortMethod,
    id: Option<Uuid>,
    timestamp: Option<DateTime<Utc>>,
    filter: Option<Expr<AgentSessionLiteral>>,
    property_filter: Option<Expr<PropertiesLiteral>>,
}

/// Whether the filter opts the query into agent sessions at all: an explicit
/// `Include`, or naming specific ids/owners. Fails closed on shapes that only
/// negate (`Not(Include)` is not an opt-in).
pub(super) fn opted_in(expr: &Expr<AgentSessionLiteral>) -> bool {
    /// Outcome of walking an `AgentSessionLiteral` AST for the opt-in decision.
    #[derive(Default)]
    struct OptIn {
        include: bool,
        named: bool,
    }

    fn walk(expr: &Expr<AgentSessionLiteral>, out: &mut OptIn) {
        match expr {
            Expr::Literal(AgentSessionLiteral::Include) => out.include = true,
            Expr::Literal(AgentSessionLiteral::Id(_) | AgentSessionLiteral::Owner(_)) => {
                out.named = true
            }
            Expr::And(a, b) | Expr::Or(a, b) => {
                walk(a, out);
                walk(b, out);
            }
            Expr::Not(_) => {}
        }
    }
    let mut out = OptIn::default();
    walk(expr, &mut out);
    out.include || out.named
}

pub(super) async fn cursor_soup(
    db: &PgPool,
    req: SimpleSortRequest<'_>,
) -> Result<Vec<SoupItem<()>>, sqlx::Error> {
    let parts = cursor_parts(req.cursor);
    let Some(filter) = parts.filter.as_ref().filter(|filter| opted_in(filter)) else {
        return Ok(Vec::new());
    };
    // Agent sessions carry no properties, so a property constraint that a
    // property-less item can never satisfy removes the leg.
    if parts
        .property_filter
        .as_ref()
        .is_some_and(|filter| !properties_filter_matches_propertyless(filter))
    {
        return Ok(Vec::new());
    }

    let sort = sort_sql(parts.sort);
    let mut query = QueryBuilder::<Postgres>::new(SELECT_SQL);
    // `$1` is the requesting user for every clause in this query: the source
    // id CTE, the history join, and any `Owner` literal that binds it again.
    query.push_bind(req.user_id.as_ref().to_string());
    query.push(ACCESS_SQL);
    query.push(" AND (");
    push_filter(&mut query, filter);
    query.push(")");
    if let (Some(timestamp), Some(id)) = (parts.timestamp, parts.id) {
        query.push(format!(" AND ({sort}, s.id) < ("));
        query.push_bind(timestamp);
        query.push(", ");
        query.push_bind(id);
        query.push(")");
    }
    query.push(format!(" ORDER BY {sort} DESC, s.id DESC LIMIT "));
    query.push_bind(i64::from(req.limit));

    query
        .build_query_as::<AgentSessionRow>()
        .fetch_all(db)
        .await?
        .into_iter()
        .map(row_to_item)
        .collect()
}

pub(super) async fn by_ids(
    db: &PgPool,
    req: AdvancedSortParams<'_>,
) -> Result<Vec<SoupItem<()>>, sqlx::Error> {
    let ids = req
        .entities
        .iter()
        .filter(|entity| entity.entity_type == EntityType::AgentSession)
        .filter_map(|entity| entity.entity_id.parse::<Uuid>().ok())
        .collect::<Vec<_>>();
    if ids.is_empty() {
        return Ok(Vec::new());
    }

    let mut query = QueryBuilder::<Postgres>::new(SELECT_SQL);
    query.push_bind(req.user_id.as_ref().to_string());
    query.push(ACCESS_SQL);
    query.push(" AND s.id = ANY(");
    query.push_bind(ids);
    query.push(") ORDER BY s.modified_at DESC, s.id DESC");
    query
        .build_query_as::<AgentSessionRow>()
        .fetch_all(db)
        .await?
        .into_iter()
        .map(row_to_item)
        .collect()
}

fn cursor_parts(cursor: SimpleSortQuery) -> CursorParts {
    match cursor {
        // No AST means the query never mentioned agent sessions: opt-out.
        SimpleSortQuery::NoFilter(query) => parts_from_query(&query, None, None),
        SimpleSortQuery::FilterFrecency(query) => parts_from_query(&query, None, None),
        SimpleSortQuery::ItemsFilter(query) => {
            let ast = query.filter();
            parts_from_query(
                &query,
                ast.agent_session_filter.as_deref().cloned(),
                ast.properties_filter.as_deref().cloned(),
            )
        }
        SimpleSortQuery::ItemsAndFrecencyFilter(query) => {
            let ast = &query.filter().1;
            parts_from_query(
                &query,
                ast.agent_session_filter.as_deref().cloned(),
                ast.properties_filter.as_deref().cloned(),
            )
        }
    }
}

fn parts_from_query<F>(
    query: &Query<Uuid, SimpleSortMethod, F>,
    filter: Option<Expr<AgentSessionLiteral>>,
    property_filter: Option<Expr<PropertiesLiteral>>,
) -> CursorParts {
    let (id, timestamp) = query.vals();
    CursorParts {
        sort: *query.sort_method(),
        id: id.copied(),
        timestamp: timestamp.copied(),
        filter,
        property_filter,
    }
}

/// Selects the row shape and joins the requesting user's view history. Ends
/// right before the first bind so `$1` is the user id.
const SELECT_SQL: &str = r#"
    WITH user_source_ids AS (
        SELECT cp.channel_id::text AS source_id
        FROM comms_channel_participants cp
        WHERE cp.user_id = "#;

/// Continues [`SELECT_SQL`] after the user id bind: the remaining source-id
/// arms, the row projection, the history join, and the access predicate.
/// Every `$1` here refers back to that same bind.
const ACCESS_SQL: &str = r#" AND cp.left_at IS NULL
        UNION ALL
        SELECT t.team_id::text FROM team_user t WHERE t.user_id = $1
        UNION ALL
        SELECT $1
    )
    SELECT
        s.id,
        s.name,
        s.owner_id,
        s.bot_id,
        s.thread_id,
        s.status,
        s.status_event_name,
        s.created_at,
        s.modified_at,
        uh."updatedAt"::timestamptz AS viewed_at
    FROM agent_session s
    LEFT JOIN "UserHistory" uh
        ON uh."itemId" = s.id::text
        AND uh."itemType" = 'agent_session'
        AND uh."userId" = $1
    WHERE EXISTS (
        SELECT 1 FROM entity_access ea
        WHERE ea.entity_id = s.id
            AND ea.entity_type = 'agent_session'
            AND ea.source_id IN (SELECT source_id FROM user_source_ids)
    )"#;

fn sort_sql(sort: SimpleSortMethod) -> &'static str {
    match sort {
        SimpleSortMethod::CreatedAt => "s.created_at",
        SimpleSortMethod::UpdatedAt => "s.modified_at",
        SimpleSortMethod::ViewedAt => {
            r#"COALESCE(uh."updatedAt", '1970-01-01 00:00:00+00')::timestamptz"#
        }
        SimpleSortMethod::ViewedUpdated => {
            r#"COALESCE(uh."updatedAt", s.modified_at)::timestamptz"#
        }
    }
}

fn push_filter(builder: &mut QueryBuilder<'_, Postgres>, expression: &Expr<AgentSessionLiteral>) {
    match expression {
        Expr::And(left, right) => {
            builder.push("(");
            push_filter(builder, left);
            builder.push(" AND ");
            push_filter(builder, right);
            builder.push(")");
        }
        Expr::Or(left, right) => {
            builder.push("(");
            push_filter(builder, left);
            builder.push(" OR ");
            push_filter(builder, right);
            builder.push(")");
        }
        Expr::Not(inner) => {
            builder.push("NOT (");
            push_filter(builder, inner);
            builder.push(")");
        }
        // Include only opts the leg in; it constrains nothing.
        Expr::Literal(AgentSessionLiteral::Include) => {
            builder.push("TRUE");
        }
        Expr::Literal(AgentSessionLiteral::Id(id)) => {
            builder.push("s.id = ");
            builder.push_bind(*id);
        }
        Expr::Literal(AgentSessionLiteral::Owner(owner)) => {
            builder.push("s.owner_id = ");
            builder.push_bind(owner.as_ref().to_string());
        }
    }
}

fn row_to_item(row: AgentSessionRow) -> Result<SoupItem<()>, sqlx::Error> {
    let owner_id = MacroUserIdStr::parse_from_str(&row.owner_id)
        .map_err(super::type_err)?
        .into_owned();
    // Mirror `agent_session::domain::model::SessionStatus`'s wire shape: the
    // event name is the status once one has arrived.
    let status = match row.status.as_str() {
        "event" => row.status_event_name.unwrap_or(row.status),
        _ => row.status,
    };
    Ok(SoupItem::AgentSession(SoupAgentSession {
        id: row.id,
        name: row.name,
        owner_id,
        bot_id: row.bot_id,
        thread_id: row.thread_id,
        status,
        created_at: row.created_at,
        updated_at: row.modified_at,
        viewed_at: row.viewed_at,
        extra: (),
    }))
}
