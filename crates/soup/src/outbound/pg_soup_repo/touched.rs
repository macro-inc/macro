//! The touched-by-me candidate query: one keyset-paginated page of entities
//! the user has mutated, newest own-mutation first, over the activity log.
//!
//! Every returned candidate is already gated on existence, deletion, access,
//! and the request's entity filters, so the page hydrates 1:1 — the service
//! builds the next cursor from this page's length, and a short page here
//! genuinely means the feed is exhausted.

use activity::VIEW_ACTION_TAGS;
use model_entity::EntityType;
use sqlx::{PgPool, Row};
use std::str::FromStr;

use crate::domain::models::{TouchedEntity, TouchedSoupRequest};
use crate::outbound::pg_soup_repo::candidate_gates::{
    channel_gate, chat_gate, document_gate, email_gate, includes_channels, includes_chats,
    includes_documents, includes_email_threads, includes_projects, project_gate,
};
use crate::outbound::pg_soup_repo::type_err;

/// The candidate row's entity id, as the gates see it.
const ID_SQL: &str = "ae.entity_id";

/// Renders [`VIEW_ACTION_TAGS`] as a SQL `IN`-list body, e.g. `'opened'`.
/// The tags are compile-time constants of this workspace, never user input.
fn view_tags_sql() -> String {
    VIEW_ACTION_TAGS
        .iter()
        .map(|tag| format!("'{tag}'"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Which entity types this request can include. A type drops when its own
/// filter can never match or when an active properties filter can never
/// match it. Channel and email filter trees never reach here — the domain
/// service rejects them up front ([`SoupErr::TouchedUnsupportedFilter`])
/// because their folds live in other domain crates' query builders.
///
/// [`SoupErr::TouchedUnsupportedFilter`]: crate::domain::models::SoupErr::TouchedUnsupportedFilter
fn included_types(req: &TouchedSoupRequest<'_>) -> Vec<&'static str> {
    let mut types = Vec::with_capacity(5);
    if includes_documents(req.filter) {
        types.push(EntityType::Document.into());
    }
    if includes_chats(req.filter) {
        types.push(EntityType::Chat.into());
    }
    if includes_projects(req.filter) {
        types.push(EntityType::Project.into());
    }
    if includes_channels(req.filter) {
        types.push(EntityType::Channel.into());
    }
    if includes_email_threads(req.filter, req.link_ids) {
        types.push(EntityType::EmailThread.into());
    }
    types
}

/// Fetches one page of touched-by-me candidates.
///
/// Shape: keyset scan of the user's mutation activity in `occurred_at DESC`
/// order, keeping only each entity's newest mutation (the `NOT EXISTS`
/// group-max), gated per entity type on existence/deletion/access/filters so
/// `LIMIT` lands after gating and pages come back full until the feed ends.
#[tracing::instrument(err, skip(db, req))]
pub(super) async fn touched_soup_page(
    db: &PgPool,
    req: TouchedSoupRequest<'_>,
) -> Result<Vec<TouchedEntity>, sqlx::Error> {
    let types = included_types(&req);
    if types.is_empty() {
        return Ok(Vec::new());
    }

    let view_tags = view_tags_sql();
    let sql = format!(
        r#"
        WITH user_source_ids AS (
            SELECT cp.channel_id::text as source_id FROM comms_channel_participants cp
                WHERE cp.user_id = $1 AND cp.left_at IS NULL
            UNION ALL
            SELECT t.team_id::text FROM team_user t
                WHERE t.user_id = $1
            UNION ALL
            SELECT $1
        )
        SELECT ae.entity_type, ae.entity_id, ae.occurred_at
        FROM activity_events ae
        WHERE ae.subject_id = $1
        AND ae.action NOT IN ({view_tags})
        AND ae.entity_type = ANY($2)
        AND ($3::timestamptz IS NULL OR (ae.occurred_at, ae.entity_id) < ($3, $4))
        AND NOT EXISTS (
            SELECT 1 FROM activity_events newer
            WHERE newer.subject_id = $1
            AND newer.entity_type = ae.entity_type
            AND newer.entity_id = ae.entity_id
            AND newer.action NOT IN ({view_tags})
            AND (newer.occurred_at, newer.id) > (ae.occurred_at, ae.id)
        )
        AND CASE ae.entity_type
            WHEN 'document' THEN {document_gate}
            WHEN 'chat' THEN {chat_gate}
            WHEN 'project' THEN {project_gate}
            WHEN 'channel' THEN {channel_gate}
            WHEN 'email_thread' THEN {email_gate}
            ELSE FALSE
        END
        ORDER BY ae.occurred_at DESC, ae.entity_id DESC
        LIMIT $6
        "#,
        document_gate = document_gate(ID_SQL, req.filter),
        chat_gate = chat_gate(ID_SQL, req.filter),
        project_gate = project_gate(ID_SQL, req.filter),
        channel_gate = channel_gate(ID_SQL, req.filter),
        email_gate = email_gate(ID_SQL, req.filter),
    );

    let after_ts = req.after.as_ref().map(|a| a.occurred_at);
    let after_id = req.after.map(|a| a.entity_id);

    sqlx::QueryBuilder::<sqlx::Postgres>::new(sql)
        .build()
        .bind(req.user_id.as_ref())
        .bind(&types)
        .bind(after_ts)
        .bind(after_id)
        .bind(req.link_ids)
        .bind(req.limit as i64)
        // Unnamed statement, same reasoning as the expanded dynamic query:
        // the SQL text varies per filter shape, so a cached prepared
        // statement is rarely reused but would flip to a generic plan.
        .persistent(false)
        .try_map(|row: sqlx::postgres::PgRow| {
            let entity_type: String = row.try_get("entity_type")?;
            let entity_id: String = row.try_get("entity_id")?;
            let occurred_at: chrono::DateTime<chrono::Utc> = row.try_get("occurred_at")?;
            let entity_type = EntityType::from_str(&entity_type).map_err(type_err)?;
            Ok(TouchedEntity {
                entity: entity_type.with_entity_string(entity_id),
                touched_at: occurred_at,
            })
        })
        .fetch_all(db)
        .await
}

#[cfg(test)]
mod test;
