//! The touched-by-me candidate query: one keyset-paginated page of entities
//! the user has mutated, newest own-mutation first, over the activity log.
//!
//! Every returned candidate is already gated on existence, deletion, access,
//! and the request's entity filters, so the page hydrates 1:1 — the service
//! builds the next cursor from this page's length, and a short page here
//! genuinely means the feed is exhausted.

use activity::VIEW_ACTION_TAGS;
use item_filters::ast::properties::{PropertyEntityType, properties_filter_matches_propertyless};
use model_entity::EntityType;
use sqlx::{PgPool, Row};
use std::str::FromStr;
use system_properties::SystemPropertyKey;

use crate::domain::models::{TouchedEntity, TouchedSoupRequest};
use crate::outbound::pg_soup_repo::expanded::dynamic::{
    access_semi_join, build_chat_filter, build_document_filter, build_project_filter,
    build_properties_filter, chat_filter_is_impossible, document_filter_is_impossible,
    document_filter_needs_task_property_joins, project_filter_is_impossible,
    properties_filter_can_apply_to,
};
use crate::outbound::pg_soup_repo::type_err;

/// Renders [`VIEW_ACTION_TAGS`] as a SQL `IN`-list body, e.g. `'opened'`.
/// The tags are compile-time constants of this workspace, never user input.
fn view_tags_sql() -> String {
    VIEW_ACTION_TAGS
        .iter()
        .map(|tag| format!("'{tag}'"))
        .collect::<Vec<_>>()
        .join(", ")
}

/// The per-type `EXISTS` gate for documents: exists, not deleted, accessible,
/// and matching the request's document + properties filters.
fn document_gate(req: &TouchedSoupRequest<'_>) -> String {
    let doc_filter = req.filter.and_then(|f| f.document_filter.as_deref());
    let props_filter = req.filter.and_then(|f| f.properties_filter.as_deref());
    // Importance / IncludeCbmAtmNc literals predicate on the dt/ep_assignees/
    // ep_status aliases, so those joins ride along only when referenced.
    let task_joins = if document_filter_needs_task_property_joins(doc_filter) {
        format!(
            r#"
                LEFT JOIN document_sub_type dt ON dt.document_id = d.id
                LEFT JOIN entity_properties ep_assignees
                    ON dt.sub_type = 'task'
                    AND ep_assignees.entity_id = d.id
                    AND ep_assignees.entity_type = 'TASK'
                    AND ep_assignees.property_definition_id = '{assignees}'
                LEFT JOIN entity_properties ep_status
                    ON dt.sub_type = 'task'
                    AND ep_status.entity_id = d.id
                    AND ep_status.entity_type = 'TASK'
                    AND ep_status.property_definition_id = '{status}'
"#,
            assignees = SystemPropertyKey::ASSIGNEES_UUID,
            status = SystemPropertyKey::STATUS_UUID,
        )
    } else {
        String::new()
    };
    format!(
        r#"EXISTS (
                SELECT 1 FROM "Document" d
                {task_joins}
                WHERE d.id = ae.entity_id
                AND d."deletedAt" IS NULL
                AND {access}
                {doc_fold}
                {props_fold}
            )"#,
        access = access_semi_join("d.id", "document"),
        doc_fold = build_document_filter(doc_filter),
        props_fold = build_properties_filter(props_filter, "d.id"),
    )
}

fn chat_gate(req: &TouchedSoupRequest<'_>) -> String {
    let chat_filter = req.filter.and_then(|f| f.chat_filter.as_deref());
    let props_filter = req.filter.and_then(|f| f.properties_filter.as_deref());
    format!(
        r#"EXISTS (
                SELECT 1 FROM "Chat" c
                WHERE c.id = ae.entity_id
                AND c."deletedAt" IS NULL
                AND {access}
                {chat_fold}
                {props_fold}
            )"#,
        access = access_semi_join("c.id", "chat"),
        chat_fold = build_chat_filter(chat_filter),
        props_fold = build_properties_filter(props_filter, "c.id"),
    )
}

fn project_gate(req: &TouchedSoupRequest<'_>) -> String {
    let project_filter = req.filter.and_then(|f| f.project_filter.as_deref());
    let props_filter = req.filter.and_then(|f| f.properties_filter.as_deref());
    format!(
        r#"EXISTS (
                SELECT 1 FROM "Project" p
                WHERE p.id = ae.entity_id
                AND p."deletedAt" IS NULL
                AND {access}
                {project_fold}
                {props_fold}
            )"#,
        access = access_semi_join("p.id", "project"),
        project_fold = build_project_filter(project_filter),
        props_fold = build_properties_filter(props_filter, "p.id"),
    )
}

/// Guards a gate whose body casts `ae.entity_id::uuid`: a malformed id in
/// the unconstrained TEXT column must drop that one row, not abort the whole
/// page with a cast error. Nested CASE because SQL `AND` does not guarantee
/// evaluation order, but CASE arms do.
fn uuid_guarded(gate: String) -> String {
    format!(
        "CASE WHEN ae.entity_id ~ '^[0-9a-fA-F]{{8}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{12}}$' THEN {gate} ELSE FALSE END"
    )
}

/// Channels are participant-gated, not `entity_access` rows, are never
/// soft-deleted (purges delete their activity instead), and carry no
/// properties — a properties filter is settled type-wide in
/// [`included_types`], not per row.
fn channel_gate() -> String {
    uuid_guarded(
        r#"EXISTS (
                SELECT 1 FROM comms_channel_participants cp
                WHERE cp.channel_id = ae.entity_id::uuid
                AND cp.user_id = $1
                AND cp.left_at IS NULL
            )"#
        .to_string(),
    )
}

/// Email threads are inbox-scoped: visible iff the thread belongs to one of
/// the caller's readable links (own + delegated).
fn email_gate(req: &TouchedSoupRequest<'_>) -> String {
    let props_filter = req.filter.and_then(|f| f.properties_filter.as_deref());
    uuid_guarded(format!(
        r#"EXISTS (
                SELECT 1 FROM email_threads et
                WHERE et.id = ae.entity_id::uuid
                AND et.link_id = ANY($5)
                {props_fold}
            )"#,
        props_fold = build_properties_filter(props_filter, "et.id::text"),
    ))
}

/// Which entity types this request can include. A type drops when its own
/// filter can never match or when an active properties filter can never
/// match it. Channel and email filter trees never reach here — the domain
/// service rejects them up front ([`SoupErr::TouchedUnsupportedFilter`])
/// because their folds live in other domain crates' query builders.
///
/// [`SoupErr::TouchedUnsupportedFilter`]: crate::domain::models::SoupErr::TouchedUnsupportedFilter
fn included_types(req: &TouchedSoupRequest<'_>) -> Vec<&'static str> {
    let props = req.filter.and_then(|f| f.properties_filter.as_deref());
    let mut types = Vec::with_capacity(5);
    if !document_filter_is_impossible(req.filter.and_then(|f| f.document_filter.as_deref()))
        && properties_filter_can_apply_to(
            props,
            &[PropertyEntityType::Document, PropertyEntityType::Task],
        )
    {
        types.push(EntityType::Document.into());
    }
    if !chat_filter_is_impossible(req.filter.and_then(|f| f.chat_filter.as_deref()))
        && properties_filter_can_apply_to(props, &[PropertyEntityType::Chat])
    {
        types.push(EntityType::Chat.into());
    }
    if !project_filter_is_impossible(req.filter.and_then(|f| f.project_filter.as_deref()))
        && properties_filter_can_apply_to(props, &[PropertyEntityType::Project])
    {
        types.push(EntityType::Project.into());
    }
    // Channels carry no properties, so the filter is settled here for the
    // whole type: include channels only when a propertyless entity can
    // satisfy the tree (the same gate the simple path's channel leg uses).
    if props.is_none_or(properties_filter_matches_propertyless) {
        types.push(EntityType::Channel.into());
    }
    if properties_filter_can_apply_to(props, &[PropertyEntityType::Thread])
        && !req.link_ids.is_empty()
    {
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
        document_gate = document_gate(&req),
        chat_gate = chat_gate(&req),
        project_gate = project_gate(&req),
        channel_gate = channel_gate(),
        email_gate = email_gate(&req),
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
