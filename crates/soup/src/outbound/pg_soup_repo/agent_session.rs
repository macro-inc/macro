//! The agent session leg of a Soup query.
//!
//! Modeled on the calendar-event leg: a standalone cursor query over the
//! `agent_session` table, merged into the main query's results at the extend
//! sites in `pg_soup_repo`. Unlike calendar events, agent sessions are
//! **opt-in** the way reminders are: a query that says nothing about them
//! gets none, so adding sessions to Soup changed no existing view.

use chrono::{DateTime, Utc};
use filter_ast::Expr;
use item_filters::ast::{
    agent_session::AgentSessionLiteral,
    properties::{PropertiesLiteral, properties_filter_matches_propertyless},
};
use model_entity::EntityType;
use models_pagination::{Query, SimpleSortMethod};
use models_soup::{
    agent_session::{SoupAgentSession, SoupAgentSessionStatusKind},
    item::SoupItem,
};
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::domain::models::{AdvancedSortParams, SimpleSortQuery, SimpleSortRequest};

#[derive(FromRow)]
struct AgentSessionRow {
    id: Uuid,
    owner_id: String,
    title: Option<String>,
    model: String,
    harness: String,
    repo_url: Option<String>,
    status: String,
    status_event_name: Option<String>,
    pending_permission_count: i32,
    pr_url: Option<String>,
    thread_channel_id: Option<Uuid>,
    created_at: DateTime<Utc>,
    modified_at: DateTime<Utc>,
}

struct CursorParts {
    sort: SimpleSortMethod,
    id: Option<Uuid>,
    timestamp: Option<DateTime<Utc>>,
    filter: Option<Expr<AgentSessionLiteral>>,
    property_filter: Option<Expr<PropertiesLiteral>>,
}

pub(super) async fn cursor_soup(
    db: &PgPool,
    req: SimpleSortRequest<'_>,
) -> Result<Vec<SoupItem<()>>, sqlx::Error> {
    let parts = cursor_parts(req.cursor);
    // Absent filter means the query never mentioned agent sessions, which is
    // the opt-out. Every pre-existing Soup view lands here.
    let Some(filter) = &parts.filter else {
        return Ok(Vec::new());
    };
    if !opts_in(filter) {
        return Ok(Vec::new());
    }
    // Sessions carry no properties, so a properties filter that cannot match
    // a propertyless item skips the leg — the gate channels and reminders use.
    if parts
        .property_filter
        .as_ref()
        .is_some_and(|filter| !properties_filter_matches_propertyless(filter))
    {
        return Ok(Vec::new());
    }

    let sort = sort_sql(parts.sort);
    let mut query = QueryBuilder::<Postgres>::new(format!("{} WHERE ", select_sql()));
    push_access_clause(&mut query, req.user_id.as_ref());
    query.push(" AND (");
    push_filter(&mut query, filter);
    query.push(")");
    if let (Some(timestamp), Some(id)) = (parts.timestamp, parts.id) {
        query.push(format!(" AND ({sort}, sess.id) < ("));
        query.push_bind(timestamp);
        query.push(", ");
        query.push_bind(id);
        query.push(")");
    }
    query.push(format!(" ORDER BY {sort} DESC, sess.id DESC LIMIT "));
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

    let mut query = QueryBuilder::<Postgres>::new(format!("{} WHERE ", select_sql()));
    push_access_clause(&mut query, req.user_id.as_ref());
    query.push(" AND sess.id = ANY(");
    query.push_bind(ids);
    query.push(") ORDER BY sess.modified_at DESC, sess.id DESC");
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
        // Only a filter can opt sessions in, so the unfiltered and frecency
        // paths carry none and return nothing.
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

#[cfg(test)]
mod test;

/// Whether the filter tree asks for agent sessions at all. Mirrors the
/// reminder leg's opt-in: an `Include` or an id anywhere positive in the tree
/// counts; a tree that only constrains (owner, negations) does not.
fn opts_in(expression: &Expr<AgentSessionLiteral>) -> bool {
    match expression {
        Expr::Literal(AgentSessionLiteral::Include | AgentSessionLiteral::Id(_)) => true,
        Expr::Literal(AgentSessionLiteral::Owner(_)) => false,
        Expr::And(left, right) | Expr::Or(left, right) => opts_in(left) || opts_in(right),
        // Fail closed: a negated include would widen the result set.
        Expr::Not(_) => false,
    }
}

fn select_sql() -> &'static str {
    r#"
    SELECT
        sess.id,
        sess.owner_id,
        sess.title,
        sess.model,
        sess.harness,
        sess.repo_url,
        sess.status,
        sess.status_event_name,
        sess.pending_permission_count,
        sess.pr_url,
        (SELECT channel_id FROM comms_messages WHERE id = sess.thread_id) AS thread_channel_id,
        sess.created_at,
        sess.modified_at
    FROM agent_session sess
    "#
}

/// The standard access gate: an `entity_access` row for the session must
/// match one of the user's sources (themselves, a channel they are in, or a
/// team they belong to). Sessions write their rows at creation — the owner as
/// owner and the originating channel as editor — so this is the same
/// semi-join the dynamic query applies per arm, inlined because this leg
/// runs standalone.
fn push_access_clause(query: &mut QueryBuilder<'_, Postgres>, user_id: &str) {
    query.push(
        r#"sess.id::text IN (
            SELECT ea.entity_id::text
            FROM entity_access ea
            WHERE ea.entity_type = 'agent_session'
              AND ea.source_id IN (
                SELECT cp.channel_id::text FROM comms_channel_participants cp
                    WHERE cp.user_id = "#,
    );
    query.push_bind(user_id.to_string());
    query.push(
        r#" AND cp.left_at IS NULL
                UNION ALL
                SELECT t.team_id::text FROM team_user t
                    WHERE t.user_id = "#,
    );
    query.push_bind(user_id.to_string());
    query.push(
        r#"
                UNION ALL
                SELECT "#,
    );
    query.push_bind(user_id.to_string());
    query.push(
        r#"
              )
        )"#,
    );
}

fn sort_sql(sort: SimpleSortMethod) -> &'static str {
    match sort {
        SimpleSortMethod::CreatedAt => "sess.created_at",
        // Sessions record no per-user views, so viewed-flavored sorts fall
        // back the same way calendar events do.
        SimpleSortMethod::UpdatedAt | SimpleSortMethod::ViewedUpdated => "sess.modified_at",
        SimpleSortMethod::ViewedAt => "'1970-01-01 00:00:00+00'::timestamptz",
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
        // Include is the opt-in gate, checked before the query is built; as a
        // predicate it constrains nothing.
        Expr::Literal(AgentSessionLiteral::Include) => {
            builder.push("TRUE");
        }
        Expr::Literal(AgentSessionLiteral::Id(id)) => {
            builder.push("sess.id = ");
            builder.push_bind(*id);
        }
        Expr::Literal(AgentSessionLiteral::Owner(owner)) => {
            builder.push("sess.owner_id = ");
            builder.push_bind(owner.clone());
        }
    }
}

fn row_to_item(row: AgentSessionRow) -> Result<SoupItem<()>, sqlx::Error> {
    let status_kind = match row.status.as_str() {
        "no_messages" => SoupAgentSessionStatusKind::NoMessages,
        "event" => SoupAgentSessionStatusKind::Event,
        "disconnected" => SoupAgentSessionStatusKind::Disconnected,
        other => {
            return Err(super::type_err(format!(
                "unknown agent session status {other:?}"
            )));
        }
    };

    Ok(SoupItem::AgentSession(SoupAgentSession {
        id: row.id,
        owner_id: macro_user_id::user_id::MacroUserIdStr::try_from(row.owner_id)
            .map_err(super::type_err)?,
        title: row.title,
        model: row.model,
        harness: row.harness,
        repo_url: row.repo_url,
        status_kind,
        status_event_name: row.status_event_name,
        pending_permission_count: row.pending_permission_count,
        pr_url: row.pr_url,
        thread_channel_id: row.thread_channel_id,
        created_at: row.created_at,
        modified_at: row.modified_at,
        extra: (),
    }))
}
