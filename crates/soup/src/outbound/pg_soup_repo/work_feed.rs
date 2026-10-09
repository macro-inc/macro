//! The work feed candidate query: one keyset-paginated page merging the
//! viewer's attention (live notifications, at least one not done) with their
//! own work (latest activity that counts as work), newest first.
//!
//! An item's place in the feed is `sort_at = max(attention_at, touched_at)`.
//! The query runs two streams, each ordered by its own timestamp: the
//! attention stream keeps a candidate only when its own work is not newer,
//! and the own-work stream only when its attention is not at least as new.
//! Every candidate is therefore emitted by exactly one stream, at its
//! `sort_at`, so merging the two ordered streams and taking the first `limit`
//! rows is the page — no candidate repeats across pages and none is skipped.
//!
//! Both streams share the notified-at feed's keying (thread-scoped channel
//! notifications become `channel_message` candidates on their thread root)
//! and its per-type gates. One condition is specific to the work feed: an
//! email thread's attention lasts only while the thread is in the inbox
//! (mail's own notion of done).
//!
//! Like the notified-at feed, channel, channel-thread, email and
//! foreign-entity filter trees fold in their own domains, so the service
//! drops candidates their hydration legs reject and refills from the next
//! page; a short page here still means the feed is exhausted.

use activity::Action;
use cowlike::CowLike;
use model_entity::EntityType;
use sqlx::{PgPool, Row};
use std::str::FromStr;

use crate::domain::models::{
    NotifiedSoupRequest, WorkFeedCandidate, WorkFeedCandidateRequest, WorkFeedSoupMode,
};
use crate::outbound::pg_soup_repo::candidate_gates::{
    channel_gate, channel_thread_gate, chat_gate, document_gate, email_gate, initiative_gate,
    project_gate, uuid_guarded,
};
use crate::outbound::pg_soup_repo::notified::{
    ID_SQL, agent_session_gate, calendar_event_gate, foreign_entity_gate, included_types,
};
use crate::outbound::pg_soup_repo::touched::view_tags_sql;
use crate::outbound::pg_soup_repo::type_err;

/// Every type the work feed can surface, in the order the notified-at feed
/// decides them.
fn requested_types<'a>(req: &WorkFeedCandidateRequest<'a>) -> Vec<&'static str> {
    let notified = NotifiedSoupRequest {
        user_id: req.user_id.copied(),
        limit: req.limit,
        after: None,
        filter: req.filter,
        link_ids: req.link_ids,
        foreign_entity_sources: req.foreign_entity_sources,
        hydratable: req.hydratable,
    };
    let requested: Vec<&'static str> = req.types.iter().map(|t| (*t).into()).collect();
    included_types(&notified)
        .into_iter()
        .filter(|entity_type| requested.contains(entity_type))
        .collect()
}

/// An email thread's attention lasts while the thread is in the inbox: mail
/// done is archive, independent of the thread's notification states.
fn email_inbox_gate() -> String {
    uuid_guarded(
        ID_SQL,
        format!(
            r#"EXISTS (
                SELECT 1 FROM email_threads inbox
                WHERE inbox.id = {ID_SQL}::uuid
                AND inbox.inbox_visible
            )"#
        ),
    )
}

/// The viewer's live notifications keyed to the candidate at `alias`, with
/// `predicate` applied. Own-work candidates are never thread rows, so a
/// channel candidate keeps only its channel-level notifications.
fn keyed_notifications(alias: &str, predicate: &str) -> String {
    format!(
        r#"EXISTS (
            SELECT 1
            FROM notification n
            JOIN user_notification un ON un.notification_id = n.id
            WHERE un.user_id = $1
            AND un.deleted_at IS NULL
            AND n.event_item_type = {alias}.entity_type
            AND n.event_item_id = {alias}.entity_id
            AND ({alias}.entity_type <> 'channel'
                OR n.secondary_event_item_type IS DISTINCT FROM 'channel_message')
            AND {predicate}
        )"#
    )
}

/// The attention timestamp of an own-work row, computed exactly as the
/// attention stream would: the newest live notification, when one is not
/// done and (for email) the thread is in the inbox.
fn own_attention_at() -> String {
    r#"(
        SELECT max(un.created_at) AT TIME ZONE 'UTC'
        FROM notification n
        JOIN user_notification un ON un.notification_id = n.id
        WHERE un.user_id = $1
        AND un.deleted_at IS NULL
        AND n.event_item_type = o.entity_type
        AND n.event_item_id = o.entity_id
        AND (o.entity_type <> 'channel'
            OR n.secondary_event_item_type IS DISTINCT FROM 'channel_message')
        AND (o.entity_type <> 'email_thread' OR EXISTS (
            SELECT 1 FROM email_threads inbox
            WHERE inbox.id::text = o.entity_id
            AND inbox.inbox_visible
        ))
        HAVING bool_or(un.state <> 'done')
    )"#
    .to_string()
}

/// Whether the `activity_events` row aliased `alias` is the viewer's own work:
/// any action but a view, except that an email thread is only worked on by
/// sending from it. Archiving, starring, labeling and moving a thread record
/// edits, and done itself archives, so counting them would bring every
/// completed email back as own work.
fn own_work(alias: &str) -> String {
    let sent: &'static str = Action::Sent.into();
    format!(
        "{alias}.action NOT IN ({views}) \
         AND ({alias}.entity_type <> 'email_thread' OR {alias}.action = '{sent}')",
        views = view_tags_sql(),
    )
}

fn build_query(req: &WorkFeedCandidateRequest<'_>) -> String {
    let filter = req.filter;
    format!(
        include_str!("work_feed/query.sql"),
        own_work_ae = own_work("ae"),
        own_work_newer = own_work("newer"),
        email_inbox_gate = email_inbox_gate(),
        attention_pending = keyed_notifications("nc", "un.state <> 'done'"),
        attention_since_touch =
            keyed_notifications("nc", "un.created_at AT TIME ZONE 'UTC' >= nc.touched_at"),
        own_attention_at = own_attention_at(),
        document_gate = document_gate(ID_SQL, filter),
        chat_gate = chat_gate(ID_SQL, filter),
        project_gate = project_gate(ID_SQL, filter),
        initiative_gate = initiative_gate(ID_SQL, filter),
        channel_gate = channel_gate(ID_SQL, filter),
        channel_thread_gate = channel_thread_gate(ID_SQL, filter),
        email_gate = email_gate(ID_SQL, filter),
        calendar_event_gate = calendar_event_gate(filter),
        foreign_entity_gate = foreign_entity_gate(filter),
        agent_session_gate = agent_session_gate(),
    )
}

/// Fetches one page of work feed candidates.
///
/// `user_notification.created_at` is a naive `TIMESTAMP` written in UTC; the
/// query converts it to `timestamptz` so attention and activity timestamps
/// compare and paginate on one clock.
#[tracing::instrument(err, skip(db, req))]
pub(super) async fn work_feed_soup_page(
    db: &PgPool,
    req: WorkFeedCandidateRequest<'_>,
) -> Result<Vec<WorkFeedCandidate>, sqlx::Error> {
    let types = requested_types(&req);
    if types.is_empty() {
        return Ok(Vec::new());
    }

    let sql = build_query(&req);

    let after_ts = req.after.as_ref().map(|a| a.sort_at);
    let after_id = req.after.as_ref().map(|a| a.entity_id.clone());
    let source_ids: Vec<&str> = req
        .foreign_entity_sources
        .iter()
        .map(|source| source.id.as_str())
        .collect();
    let source_auth_entities: Vec<&str> = req
        .foreign_entity_sources
        .iter()
        .map(|source| source.auth_entity.as_str())
        .collect();
    let (only_types, only_ids): (Option<Vec<&str>>, Option<Vec<&str>>) = match req.only {
        Some(only) => (
            Some(only.iter().map(|e| e.entity_type.into()).collect()),
            Some(only.iter().map(|e| e.entity_id.as_ref()).collect()),
        ),
        None => (None, None),
    };

    sqlx::QueryBuilder::<sqlx::Postgres>::new(sql)
        .build()
        .bind(req.user_id.as_ref())
        .bind(&types)
        .bind(after_ts)
        .bind(after_id)
        .bind(req.link_ids)
        .bind(req.limit as i64)
        .bind(&source_ids)
        .bind(&source_auth_entities)
        .bind(req.mode == WorkFeedSoupMode::Work)
        .bind(only_types)
        .bind(only_ids)
        // Unnamed statement, same reasoning as the other candidate queries:
        // the SQL text varies per filter shape.
        .persistent(false)
        .try_map(|row: sqlx::postgres::PgRow| {
            let entity_type: String = row.try_get("entity_type")?;
            let entity_id: String = row.try_get("entity_id")?;
            let entity_type = EntityType::from_str(&entity_type).map_err(type_err)?;
            Ok(WorkFeedCandidate {
                entity: entity_type.with_entity_string(entity_id),
                attention_at: row.try_get("attention_at")?,
                touched_at: row.try_get("touched_at")?,
                sort_at: row.try_get("sort_at")?,
            })
        })
        .fetch_all(db)
        .await
}

#[cfg(test)]
mod test;
