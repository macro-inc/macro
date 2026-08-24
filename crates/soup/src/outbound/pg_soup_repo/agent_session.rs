//! The agent-session leg of a Soup query.
//!
//! Modeled on the calendar-event leg: a small standalone query whose rows are
//! extended into the main query's results. Unlike calendar events — and like
//! reminders — agent sessions are **opt-in**: a query whose filter says
//! nothing about them gets none, so adding them to Soup changed nothing about
//! existing views.

use chrono::{DateTime, Utc};
use filter_ast::Expr;
use item_filters::ast::{
    agent_session::AgentSessionLiteral, properties::properties_filter_matches_propertyless,
};
use model_entity::EntityType;
use models_pagination::SimpleSortMethod;
use models_soup::{
    agent_session::{SoupAgentSession, SoupAgentSessionStatusKind},
    item::SoupItem,
};
use sqlx::{FromRow, PgPool, Postgres, QueryBuilder};
use uuid::Uuid;

use crate::domain::models::{AdvancedSortParams, SimpleSortQuery, SimpleSortRequest};

#[cfg(test)]
mod test;

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

pub(super) async fn cursor_soup(
    db: &PgPool,
    req: SimpleSortRequest<'_>,
) -> Result<Vec<SoupItem<()>>, sqlx::Error> {
    // Frecency has no agent-session scoring, and both no-filter paths carry
    // no filter to opt in with, so only the filtered cursors can ask.
    let (sort, id, timestamp, filter, property_filter) = match req.cursor {
        SimpleSortQuery::NoFilter(_) | SimpleSortQuery::FilterFrecency(_) => return Ok(Vec::new()),
        SimpleSortQuery::ItemsFilter(query) => {
            let ast = query.filter();
            let filter = ast.agent_session_filter.as_deref().cloned();
            let property_filter = ast.properties_filter.as_deref().cloned();
            let (id, timestamp) = query.vals();
            (
                *query.sort_method(),
                id.copied(),
                timestamp.copied(),
                filter,
                property_filter,
            )
        }
        SimpleSortQuery::ItemsAndFrecencyFilter(query) => {
            let ast = &query.filter().1;
            let filter = ast.agent_session_filter.as_deref().cloned();
            let property_filter = ast.properties_filter.as_deref().cloned();
            let (id, timestamp) = query.vals();
            (
                *query.sort_method(),
                id.copied(),
                timestamp.copied(),
                filter,
                property_filter,
            )
        }
    };

    // Absent filter means the query never mentioned agent sessions, which is
    // the opt-out. Every pre-existing Soup view lands here.
    let Some(filter) = filter else {
        return Ok(Vec::new());
    };
    if !opts_in(&filter) {
        return Ok(Vec::new());
    }
    // Clients that exclude entity types by nil-id (`defineQueryFilters`)
    // produce a tree that can never match; skip the round trip.
    if filter_is_impossible(&filter) {
        return Ok(Vec::new());
    }

    // Sessions carry no properties, so an active properties filter that
    // cannot match a propertyless item skips the leg — the same gate
    // channels and foreign entities use.
    if property_filter
        .as_ref()
        .is_some_and(|expr| !properties_filter_matches_propertyless(expr))
    {
        return Ok(Vec::new());
    }

    let sort = sort_sql(sort);
    let mut query = QueryBuilder::<Postgres>::new(select_sql());
    query.push(" WHERE ");
    push_access_clause(&mut query, req.user_id.as_ref());
    query.push(" AND (");
    push_filter(&mut query, &filter);
    query.push(")");
    if let (Some(timestamp), Some(id)) = (timestamp, id) {
        query.push(format!(" AND ({sort}, session.id) < ("));
        query.push_bind(timestamp);
        query.push(", ");
        query.push_bind(id);
        query.push(")");
    }
    query.push(format!(" ORDER BY {sort} DESC, session.id DESC LIMIT "));
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

    let mut query = QueryBuilder::<Postgres>::new(select_sql());
    query.push(" WHERE ");
    push_access_clause(&mut query, req.user_id.as_ref());
    query.push(" AND session.id = ANY(");
    query.push_bind(ids);
    query.push(") ORDER BY session.modified_at DESC, session.id DESC");
    query
        .build_query_as::<AgentSessionRow>()
        .fetch_all(db)
        .await?
        .into_iter()
        .map(row_to_item)
        .collect()
}

/// Whether the tree provably matches nothing — a nil-id literal, or a
/// conjunction containing one. The same shape as the calendar leg's
/// impossibility check.
fn filter_is_impossible(expr: &Expr<AgentSessionLiteral>) -> bool {
    match expr {
        Expr::And(a, b) => filter_is_impossible(a) || filter_is_impossible(b),
        Expr::Or(a, b) => filter_is_impossible(a) && filter_is_impossible(b),
        Expr::Not(_) => false,
        Expr::Literal(AgentSessionLiteral::Id(id)) => id.is_nil(),
        Expr::Literal(_) => false,
    }
}

/// Whether the filter asked for agent sessions at all. They are off unless
/// an `Include` or `Id` literal appears outside a negation.
fn opts_in(expr: &Expr<AgentSessionLiteral>) -> bool {
    match expr {
        Expr::Literal(AgentSessionLiteral::Include | AgentSessionLiteral::Id(_)) => true,
        Expr::Literal(AgentSessionLiteral::Owner(_)) => false,
        Expr::And(a, b) | Expr::Or(a, b) => opts_in(a) || opts_in(b),
        // Opting in under a negation is asking for everything *but* those
        // sessions, which is not opting in.
        Expr::Not(_) => false,
    }
}

fn select_sql() -> &'static str {
    r#"
    SELECT
        session.id,
        session.owner_id,
        session.title,
        session.model,
        session.harness,
        session.repo_url,
        session.status,
        session.status_event_name,
        session.pending_permission_count,
        session.pr_url,
        (SELECT channel_id FROM comms_messages WHERE id = session.thread_id)
            AS thread_channel_id,
        session.created_at,
        session.modified_at
    FROM agent_session session
    "#
}

fn sort_sql(sort: SimpleSortMethod) -> &'static str {
    match sort {
        SimpleSortMethod::CreatedAt => "session.created_at",
        SimpleSortMethod::UpdatedAt | SimpleSortMethod::ViewedUpdated => "session.modified_at",
        // Sessions record no per-user views yet.
        SimpleSortMethod::ViewedAt => "'1970-01-01 00:00:00+00'::timestamptz",
    }
}

/// The access gate: a session is visible when one of its `entity_access`
/// rows matches one of the user's sources — the user themselves, a channel
/// they are still in, or a team they belong to. The same source expansion the
/// dynamic query's `user_source_ids` CTE performs, inlined because this leg
/// runs standalone.
fn push_access_clause(query: &mut QueryBuilder<'_, Postgres>, user_id: &str) {
    query.push(
        r#"session.id IN (
            SELECT ea.entity_id
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
        Expr::Literal(AgentSessionLiteral::Include) => {
            builder.push("TRUE");
        }
        Expr::Literal(AgentSessionLiteral::Id(id)) => {
            builder.push("session.id = ");
            builder.push_bind(*id);
        }
        Expr::Literal(AgentSessionLiteral::Owner(owner)) => {
            builder.push("session.owner_id = ");
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
            return Err(sqlx::Error::Decode(
                std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("unknown agent_session status {other:?}"),
                )
                .into(),
            ));
        }
    };

    Ok(SoupItem::AgentSession(SoupAgentSession {
        id: row.id,
        owner_id: row.owner_id,
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
