//! Per-type `EXISTS` gates shared by the candidate queries (touched-by-me and
//! notified-at): does the candidate's entity exist, is it undeleted, can the
//! user see it, and does it satisfy the request's soup-owned filters.
//!
//! Every gate renders against `id_sql`, the SQL expression yielding the
//! candidate's entity id as TEXT (`ae.entity_id` for the activity log, the
//! `notified` CTE's derived key for notifications). Both candidate queries
//! bind the user id as `$1` and the caller's inbox link ids as `$5`, which
//! the gates reference directly.

use filter_ast::Expr;
use item_filters::ast::EntityFilterAst;
use item_filters::ast::channel::{ChannelLiteral, ChannelThreadLiteral};
use item_filters::ast::email::EmailLiteral;
use item_filters::ast::properties::{PropertyEntityType, properties_filter_matches_propertyless};
use system_properties::SystemPropertyKey;
use uuid::Uuid;

use crate::outbound::pg_soup_repo::expanded::dynamic::{
    NotificationPredicate, access_semi_join, build_chat_filter, build_document_filter,
    build_notification_done_clause, build_notification_exists_clause,
    build_notification_seen_clause, build_project_filter, build_properties_filter,
    chat_filter_is_impossible, document_filter_is_impossible,
    document_filter_needs_task_property_joins, project_filter_is_impossible,
    properties_filter_can_apply_to,
};

/// Literals reachable through `And` alone: conditions the whole tree implies,
/// so applying them as a pre-filter can never drop a row the tree's full fold
/// would admit. `Or` and `Not` subtrees contribute nothing.
fn and_conjuncts<'a, T>(expr: &'a Expr<T>, out: &mut Vec<&'a T>) {
    match expr {
        Expr::And(a, b) => {
            and_conjuncts(a, out);
            and_conjuncts(b, out);
        }
        Expr::Literal(literal) => out.push(literal),
        Expr::Or(..) | Expr::Not(..) => {}
    }
}

/// Renders the implied conjuncts of `tree` that `fold` knows how to express
/// as ` AND ...` clauses, in tree order.
pub(super) fn implied_conjuncts_sql<T>(
    tree: Option<&Expr<T>>,
    fold: impl Fn(&T) -> Option<String>,
) -> String {
    let Some(tree) = tree else {
        return String::new();
    };
    let mut literals = Vec::new();
    and_conjuncts(tree, &mut literals);
    literals
        .into_iter()
        .filter_map(|literal| fold(literal).map(|sql| format!(" AND {sql}")))
        .collect()
}

/// The per-type `EXISTS` gate for documents: exists, not deleted, accessible,
/// and matching the request's document + properties filters.
pub(super) fn document_gate(id_sql: &str, filter: Option<&EntityFilterAst>) -> String {
    let doc_filter = filter.and_then(|f| f.document_filter.as_deref());
    let props_filter = filter.and_then(|f| f.properties_filter.as_deref());
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
                WHERE d.id = {id_sql}
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

pub(super) fn chat_gate(id_sql: &str, filter: Option<&EntityFilterAst>) -> String {
    let chat_filter = filter.and_then(|f| f.chat_filter.as_deref());
    let props_filter = filter.and_then(|f| f.properties_filter.as_deref());
    format!(
        r#"EXISTS (
                SELECT 1 FROM "Chat" c
                WHERE c.id = {id_sql}
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

pub(super) fn project_gate(id_sql: &str, filter: Option<&EntityFilterAst>) -> String {
    let project_filter = filter.and_then(|f| f.project_filter.as_deref());
    let props_filter = filter.and_then(|f| f.properties_filter.as_deref());
    format!(
        r#"EXISTS (
                SELECT 1 FROM "Project" p
                WHERE p.id = {id_sql}
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

/// Guards a gate whose body casts `{id_sql}::uuid`: a malformed id in the
/// unconstrained TEXT column must drop that one row, not abort the whole
/// page with a cast error. Nested CASE because SQL `AND` does not guarantee
/// evaluation order, but CASE arms do.
pub(super) fn uuid_guarded(id_sql: &str, gate: String) -> String {
    format!(
        "CASE WHEN {id_sql} ~ '^[0-9a-fA-F]{{8}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{4}}-[0-9a-fA-F]{{12}}$' THEN {gate} ELSE FALSE END"
    )
}

/// Channels are participant-gated, not `entity_access` rows, are never
/// soft-deleted (purges delete their activity instead), and carry no
/// properties — a properties filter is settled type-wide in
/// [`includes_channels`], not per row.
///
/// The channel tree folds in the channels crate, which hydration applies in
/// full; the notification-state conjuncts it implies are pre-applied here so
/// a feed of done channels does not spend candidate slots on rows hydration
/// is about to drop. Only channel-level notifications count: mentions and
/// thread replies name a message as their secondary item and belong to that
/// thread's row, so a live mention must not keep a channel whose own
/// notifications are all done in the feed.
pub(super) fn channel_gate(id_sql: &str, filter: Option<&EntityFilterAst>) -> String {
    let implied = implied_conjuncts_sql(
        filter.and_then(|f| f.channel_filter.as_deref()),
        |literal| {
            let predicate = match literal {
                ChannelLiteral::NotificationDone(done) => NotificationPredicate::Done(*done),
                ChannelLiteral::NotificationSeen(seen) => NotificationPredicate::Seen(*seen),
                _ => return None,
            };
            Some(build_notification_exists_clause(
                "cp.channel_id",
                "channel",
                &format!(
                    "{} AND n.secondary_event_item_type IS DISTINCT FROM 'channel_message'",
                    predicate.sql()
                ),
            ))
        },
    );
    uuid_guarded(
        id_sql,
        format!(
            r#"EXISTS (
                SELECT 1 FROM comms_channel_participants cp
                WHERE cp.channel_id = {id_sql}::uuid
                AND cp.user_id = $1
                AND cp.left_at IS NULL
                {implied}
            )"#
        ),
    )
}

/// Channel-thread rows are root messages; one is visible iff it is undeleted
/// and the caller is an active participant of its channel. The thread tree
/// folds in the channels crate, which hydration applies in full; the
/// notification-state conjuncts it implies are pre-applied here over the
/// thread's own notifications (the channel notifications naming this root
/// as their secondary item, the same rows the channels fold predicates on).
pub(super) fn channel_thread_gate(id_sql: &str, filter: Option<&EntityFilterAst>) -> String {
    let implied = implied_conjuncts_sql(
        filter.and_then(|f| f.channel_thread_filter.as_deref()),
        |literal| {
            let predicate = match literal {
                ChannelThreadLiteral::NotificationDone(done) => NotificationPredicate::Done(*done),
                ChannelThreadLiteral::NotificationSeen(seen) => NotificationPredicate::Seen(*seen),
                _ => return None,
            };
            Some(build_notification_exists_clause(
                "m.channel_id",
                "channel",
                &format!(
                    "n.secondary_event_item_type = 'channel_message' AND n.secondary_event_item_id = m.id::text AND {}",
                    predicate.sql()
                ),
            ))
        },
    );
    uuid_guarded(
        id_sql,
        format!(
            r#"EXISTS (
                SELECT 1 FROM comms_messages m
                JOIN comms_channel_participants cp
                    ON cp.channel_id = m.channel_id
                    AND cp.user_id = $1
                    AND cp.left_at IS NULL
                WHERE m.id = {id_sql}::uuid
                AND m.thread_id IS NULL
                AND m.deleted_at IS NULL
                {implied}
            )"#
        ),
    )
}

/// Email threads are inbox-scoped: visible iff the thread belongs to one of
/// the caller's readable links (own + delegated).
///
/// The email tree folds in the email crate, which hydration applies in full;
/// the importance and notification-state conjuncts it implies are
/// pre-applied here (same predicates as the email fold's `t.is_signal` and
/// notification `EXISTS`) so noise or done threads do not spend candidate
/// slots on rows hydration is about to drop.
pub(super) fn email_gate(id_sql: &str, filter: Option<&EntityFilterAst>) -> String {
    let props_filter = filter.and_then(|f| f.properties_filter.as_deref());
    let implied = implied_conjuncts_sql(
        filter.and_then(|f| f.email_filter.tree.as_deref()),
        |literal| match literal {
            EmailLiteral::Importance(true) => Some("et.is_signal".to_string()),
            EmailLiteral::Importance(false) => Some("NOT et.is_signal".to_string()),
            EmailLiteral::NotificationDone(done) => Some(build_notification_done_clause(
                "et.id",
                "email_thread",
                *done,
            )),
            EmailLiteral::NotificationSeen(seen) => Some(build_notification_seen_clause(
                "et.id",
                "email_thread",
                *seen,
            )),
            _ => None,
        },
    );
    uuid_guarded(
        id_sql,
        format!(
            r#"EXISTS (
                SELECT 1 FROM email_threads et
                WHERE et.id = {id_sql}::uuid
                AND et.link_id = ANY($5)
                {implied}
                {props_fold}
            )"#,
            props_fold = build_properties_filter(props_filter, "et.id::text"),
        ),
    )
}

/// Documents drop when their own filter can never match or when an active
/// properties filter can never match a document or task.
pub(super) fn includes_documents(filter: Option<&EntityFilterAst>) -> bool {
    !document_filter_is_impossible(filter.and_then(|f| f.document_filter.as_deref()))
        && properties_filter_can_apply_to(
            filter.and_then(|f| f.properties_filter.as_deref()),
            &[PropertyEntityType::Document, PropertyEntityType::Task],
        )
}

pub(super) fn includes_chats(filter: Option<&EntityFilterAst>) -> bool {
    !chat_filter_is_impossible(filter.and_then(|f| f.chat_filter.as_deref()))
        && properties_filter_can_apply_to(
            filter.and_then(|f| f.properties_filter.as_deref()),
            &[PropertyEntityType::Chat],
        )
}

pub(super) fn includes_projects(filter: Option<&EntityFilterAst>) -> bool {
    !project_filter_is_impossible(filter.and_then(|f| f.project_filter.as_deref()))
        && properties_filter_can_apply_to(
            filter.and_then(|f| f.properties_filter.as_deref()),
            &[PropertyEntityType::Project],
        )
}

/// Channels carry no properties, so the filter is settled here for the whole
/// type: include channels only when a propertyless entity can satisfy the
/// tree (the same gate the simple path's channel leg uses).
pub(super) fn includes_channels(filter: Option<&EntityFilterAst>) -> bool {
    filter
        .and_then(|f| f.properties_filter.as_deref())
        .is_none_or(properties_filter_matches_propertyless)
}

/// Email threads need at least one readable inbox and a properties filter
/// that can match a thread.
pub(super) fn includes_email_threads(filter: Option<&EntityFilterAst>, link_ids: &[Uuid]) -> bool {
    !link_ids.is_empty()
        && properties_filter_can_apply_to(
            filter.and_then(|f| f.properties_filter.as_deref()),
            &[PropertyEntityType::Thread],
        )
}
