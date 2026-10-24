//! The attention candidate query behind Home's work feed and the
//! notifications inbox: one keyset-paginated page merging the viewer's
//! attention (the newest pending, i.e. unseen or seen, notification) with,
//! when asked, their own work (latest activity that counts as work), newest
//! first.
//!
//! An item's place in the feed is `sort_at = max(attention_at, touched_at)`.
//! The query runs two streams, each ordered by its own timestamp: the
//! attention stream keeps a candidate only when its own work is not newer,
//! and the own-work stream only when its attention is not at least as new.
//! Every candidate is therefore emitted by exactly one stream, at its
//! `sort_at`, so merging the two ordered streams and taking the first `limit`
//! rows is the page — no candidate repeats across pages and none is skipped.
//!
//! [`AttentionKeying`] decides which candidate a notification places.
//! `ThreadScoped` shares the notified-at feed's keying (thread-scoped channel
//! notifications become `channel_message` candidates on their thread root);
//! `FiledEntity` keys every notification to the entity it is filed under, so
//! a channel and all its threads are one candidate. Both share the per-type
//! gates and one attention condition: an email thread's attention lasts only
//! while the thread is in the inbox (mail's own notion of done).
//!
//! Done notifications never place an item, so the query reads only the
//! viewer's pending ones, once, and both streams look attention up there.
//! It also reads them only back to a floor: a full page of own work holds
//! `limit` items placed at or after its oldest touch, so nothing placed
//! earlier can reach the page. Reading every notification instead made a
//! viewer with a long history pay for all of it on each page.
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
    AttentionCandidate, AttentionCandidateRequest, AttentionKeying, NotifiedSoupRequest,
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

/// Every type an attention feed can surface, in the order the notified-at
/// feed decides them, then the CRM records only attention feeds list.
fn requested_types<'a>(req: &AttentionCandidateRequest<'a>) -> Vec<&'static str> {
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
    let crm: &[&'static str] = if req.crm {
        &[EntityType::CrmCompany.into(), EntityType::CrmContact.into()]
    } else {
        &[]
    };
    included_types(&notified)
        .into_iter()
        .chain(crm.iter().copied())
        .filter(|entity_type| requested.contains(entity_type))
        .collect()
}

/// The `crm_companies` row aliased `alias` is visible to the viewer: its
/// team has CRM enabled, the viewer belongs to that team, and the company is
/// not hidden (hidden records are listed only on explicit admin requests).
fn visible_crm_company(alias: &str) -> String {
    format!(
        r#"NOT {alias}.hidden
            AND EXISTS (
                SELECT 1 FROM team_user tu
                JOIN team_crm_settings tcs ON tcs.team_id = tu.team_id
                WHERE tu.team_id = {alias}.team_id
                AND tu.user_id = $1
                AND tcs.crm_enabled
            )"#
    )
}

fn crm_company_gate() -> String {
    uuid_guarded(
        ID_SQL,
        format!(
            r#"EXISTS (
                SELECT 1 FROM crm_companies c
                WHERE c.id = {ID_SQL}::uuid
                AND {visible}
            )"#,
            visible = visible_crm_company("c"),
        ),
    )
}

fn crm_contact_gate() -> String {
    uuid_guarded(
        ID_SQL,
        format!(
            r#"EXISTS (
                SELECT 1 FROM crm_contacts ct
                JOIN crm_companies c ON c.id = ct.company_id
                WHERE ct.id = {ID_SQL}::uuid
                AND NOT ct.hidden
                AND {visible}
            )"#,
            visible = visible_crm_company("c"),
        ),
    )
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

/// Whether the `notification` row `n` places the `channel_message` candidate
/// named by its secondary item rather than the entity it is filed under.
fn thread_keyed(keying: AttentionKeying) -> &'static str {
    match keying {
        AttentionKeying::ThreadScoped => {
            "(n.event_item_type = 'channel' AND n.secondary_event_item_type = 'channel_message')"
        }
        AttentionKeying::FiledEntity => "FALSE",
    }
}

fn build_query(req: &AttentionCandidateRequest<'_>) -> String {
    let filter = req.filter;
    format!(
        include_str!("attention/query.sql"),
        thread_keyed = thread_keyed(req.keying),
        own_work_ae = own_work("ae"),
        own_work_newer = own_work("newer"),
        email_inbox_gate = email_inbox_gate(),
        document_gate = document_gate(ID_SQL, filter),
        chat_gate = chat_gate(ID_SQL, filter),
        project_gate = project_gate(ID_SQL, filter),
        initiative_gate = initiative_gate(ID_SQL, filter),
        channel_gate = channel_gate(ID_SQL, filter),
        channel_thread_gate = channel_thread_gate(ID_SQL, filter),
        email_gate = email_gate(ID_SQL, filter),
        calendar_event_gate = calendar_event_gate(filter),
        foreign_entity_gate = foreign_entity_gate(filter),
        agent_session_gate = agent_session_gate(filter),
        crm_company_gate = crm_company_gate(),
        crm_contact_gate = crm_contact_gate(),
    )
}

/// Fetches one page of attention feed candidates.
///
/// `user_notification.created_at` is a naive `TIMESTAMP` written in UTC; the
/// query converts it to `timestamptz` so attention and activity timestamps
/// compare and paginate on one clock.
#[tracing::instrument(err, skip(db, req))]
pub(super) async fn attention_soup_page(
    db: &PgPool,
    req: AttentionCandidateRequest<'_>,
) -> Result<Vec<AttentionCandidate>, sqlx::Error> {
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
        .bind(req.own_work)
        .bind(only_types)
        .bind(only_ids)
        // Unnamed statement, same reasoning as the other candidate queries:
        // the SQL text varies per filter shape.
        .persistent(false)
        .try_map(|row: sqlx::postgres::PgRow| {
            let entity_type: String = row.try_get("entity_type")?;
            let entity_id: String = row.try_get("entity_id")?;
            let entity_type = EntityType::from_str(&entity_type).map_err(type_err)?;
            Ok(AttentionCandidate {
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
