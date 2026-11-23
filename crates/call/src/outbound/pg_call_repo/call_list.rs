//! A page of the calls a viewer can see, with everyone who was on them.
//!
//! Soup's call lists read this: Sales calls, a channel's Calls tab, and the
//! calls of a CRM company or contact (a call id filter).

#[cfg(test)]
mod test;

use std::collections::{HashMap, HashSet};

use channels::outbound::channel_name::batch_resolve_channel_names;
use entity_access::domain::models::AccessLevel;
use item_filters::ast::{LiteralTree, call::CallLiteral};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgPool;
use uuid::Uuid;

use super::imported::guest_name;
use super::property_clauses::{clause_params, property_clauses};
use super::{
    call_status_from_sql, call_status_sql_value, extract_call_ids, extract_channel_ids,
    extract_status_filter,
};
use crate::domain::meetings::GuestId;
use crate::domain::models::{
    CallDiscussion, CallRecord, CallRecordGuest, CallRecordPage, CallRecordParticipant,
};

/// One page of `user_id`'s calls matching `filter`, newest first.
///
/// Channel calls accept the viewer's user, channel, or team grants; standalone
/// calls need the viewer's own grant, so a group grant can't add them to team
/// memory. Records the filter's shape on the current span.
pub(super) async fn list_call_records(
    pool: &PgPool,
    user_id: MacroUserIdStr<'_>,
    limit: u32,
    filter: &LiteralTree<CallLiteral>,
    page: CallRecordPage,
) -> Result<Vec<CallRecord>, sqlx::Error> {
    let channel_ids = extract_channel_ids(filter);
    let call_ids = extract_call_ids(filter);
    let status_filter: Option<Vec<String>> = extract_status_filter(filter).map(|statuses| {
        statuses
            .into_iter()
            .map(|status| call_status_sql_value(status).to_string())
            .collect()
    });
    let property = clause_params(&property_clauses(filter));
    let span = tracing::Span::current();
    span.record("filter.call_ids", call_ids.len());
    span.record("filter.channel_ids", channel_ids.len());
    span.record("filter.status", status_filter.is_some());
    span.record("filter.property_clauses", property.clause_count);

    let rows = sqlx::query_file!(
        "src/outbound/pg_call_repo/call_list/page.sql",
        user_id.as_ref(),
        i64::from(limit),
        !channel_ids.is_empty(),
        &channel_ids,
        !call_ids.is_empty(),
        &call_ids,
        status_filter.is_some(),
        status_filter.as_deref().unwrap_or_default(),
        property.clause_count,
        &property.clause_indices,
        &property.negated,
        &property.definition_ids as &[Option<Uuid>],
        &property.values,
        page.by_start,
        page.after.map(|(sort_at, _)| sort_at),
        page.after.map(|(_, call_id)| call_id.to_string()),
    )
    .fetch_all(pool)
    .await?;
    span.record("rows", rows.len());
    if rows.is_empty() {
        return Ok(Vec::new());
    }

    // Each call's people live in its own table's participant and guest
    // tables: live, archived, or imported.
    let mut live = Vec::new();
    let mut archived = Vec::new();
    let mut imported = Vec::new();
    let mut seen_channels = HashSet::new();
    let mut page_channels = Vec::new();
    for row in &rows {
        if row.is_imported {
            imported.push(row.call_id);
        } else if row.is_active {
            live.push(row.call_id);
        } else {
            archived.push(row.call_id);
        }
        if let Some(channel_id) = row.channel_id
            && seen_channels.insert(channel_id)
        {
            page_channels.push(channel_id);
        }
    }
    let (mut people, channel_names) = tokio::try_join!(
        load_people(pool, &live, &archived, &imported),
        batch_resolve_channel_names(pool, &page_channels, user_id.copied()),
    )?;

    Ok(rows
        .into_iter()
        .map(|row| {
            let People {
                participants,
                guests,
            } = people.remove(&row.call_id).unwrap_or_default();
            CallRecord {
                call_id: row.call_id,
                user_access_level: None,
                channel_id: row.channel_id,
                discussion: CallDiscussion::from_stored(
                    row.discussion.as_deref().unwrap_or("call_chat"),
                    row.call_id,
                    row.channel_id,
                ),
                room_name: row.room_name,
                created_by: row.created_by,
                started_at: row.started_at,
                ended_at: row.ended_at,
                duration_ms: row.duration_ms,
                egress_id: row.egress_id,
                recording_started_at: row.recording_started_at,
                recording_key: row.recording_key,
                preview_key: row.preview_url,
                recording_url: None,
                recording_preview_url: None,
                channel_name: row
                    .channel_id
                    .and_then(|id| channel_names.get(&id).cloned()),
                custom_name: row.custom_name,
                summary: row.summary,
                share_with_team: row.share_with_team,
                team_share_access_level: row.team_share_access_level,
                is_active: row.is_active,
                status: Some(call_status_from_sql(&row.status)),
                viewer_has_declined: false,
                participants,
                guests,
                transcript: Vec::new(),
                source: None,
            }
        })
        .collect())
}

/// Who was on one call, each list earliest joiner first.
#[derive(Debug, Default)]
struct People {
    participants: Vec<CallRecordParticipant>,
    guests: Vec<CallRecordGuest>,
}

/// Everyone on the `live`, `archived`, and `imported` calls, by call.
#[tracing::instrument(
    err,
    skip_all,
    fields(calls = live.len() + archived.len() + imported.len(), people = tracing::field::Empty)
)]
async fn load_people(
    pool: &PgPool,
    live: &[Uuid],
    archived: &[Uuid],
    imported: &[Uuid],
) -> Result<HashMap<Uuid, People>, sqlx::Error> {
    let rows = sqlx::query_file!(
        "src/outbound/pg_call_repo/call_list/people.sql",
        live,
        archived,
        imported,
    )
    .fetch_all(pool)
    .await?;
    tracing::Span::current().record("people", rows.len());

    let mut people: HashMap<Uuid, People> = HashMap::new();
    for row in rows {
        let call = people.entry(row.call_id).or_default();
        match (row.guest_id, row.user_id) {
            (Some(guest_id), _) => call.guests.push(CallRecordGuest {
                id: GuestId::from_uuid(guest_id),
                display_name: guest_name(row.display_name, row.email),
                joined_at: row.joined_at,
                left_at: row.left_at,
            }),
            (None, Some(user_id)) => call.participants.push(CallRecordParticipant {
                user_id,
                joined_at: row.joined_at,
                left_at: row.left_at,
            }),
            // Every arm reads a NOT NULL user id or guest id.
            (None, None) => {
                return Err(sqlx::Error::Decode(
                    "call person row has neither a user id nor a guest id".into(),
                ));
            }
        }
    }
    Ok(people)
}
