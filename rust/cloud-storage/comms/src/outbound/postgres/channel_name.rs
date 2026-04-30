//! Batch channel-name resolution backed by Postgres.
//!
//! Queries channels, their participants, and user display names, then
//! delegates to the canonical [`resolve_channel_name`] domain function.

use std::collections::{HashMap, HashSet};

use chrono::{DateTime, Utc};
use doppleganger::Mirror;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_comms::channel::{ChannelId, ChannelParticipant, ParticipantRole};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::channel_name::{NameLookup, resolve_channel_name};
use crate::outbound::postgres::comms_repo::ChannelType;

/// Batch-resolve display names for a list of channel ids from the perspective
/// of `viewer_user_id`. The viewer is only used to pick the right "other
/// person" for DM channels; it is not an authorization check.
///
/// Channels the query can't find simply have no entry in the returned map.
#[tracing::instrument(skip(pool), err)]
pub async fn batch_resolve_channel_names<'a>(
    pool: &PgPool,
    channel_ids: &[Uuid],
    viewer_user_id: MacroUserIdStr<'a>,
) -> Result<HashMap<Uuid, String>, sqlx::Error> {
    if channel_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let channel_rows = sqlx::query!(
        r#"
        SELECT id, name, channel_type as "channel_type!: ChannelType"
        FROM comms_channels
        WHERE id = ANY($1)
        "#,
        channel_ids,
    )
    .fetch_all(pool)
    .await?;

    let channels: HashMap<Uuid, (Option<String>, models_comms::channel::ChannelType)> =
        channel_rows
            .into_iter()
            .map(|r| (r.id, (r.name, ChannelType::mirror(r.channel_type))))
            .collect();

    // Channels that need participant-derived names (DMs, unnamed privates).
    let needs_participants: Vec<Uuid> = channels
        .iter()
        .filter(|(_, (name, ct))| {
            matches!(ct, models_comms::channel::ChannelType::DirectMessage)
                || (matches!(ct, models_comms::channel::ChannelType::Private)
                    && name.as_ref().is_none_or(|n| n.trim().is_empty()))
        })
        .map(|(id, _)| *id)
        .collect();

    let (participants_by_channel, name_lookup) = if needs_participants.is_empty() {
        (HashMap::new(), NameLookup::new())
    } else {
        load_participants_and_names(pool, &needs_participants).await?
    };

    let mut resolved: HashMap<Uuid, String> = HashMap::with_capacity(channels.len());
    for (channel_id, (name, channel_type)) in &channels {
        let empty = Vec::new();
        let participants = participants_by_channel.get(channel_id).unwrap_or(&empty);
        let resolved_name = resolve_channel_name(
            channel_type,
            name.as_deref(),
            participants,
            &ChannelId(*channel_id),
            viewer_user_id.copied(),
            &name_lookup,
        );
        resolved.insert(*channel_id, resolved_name);
    }

    Ok(resolved)
}

async fn load_participants_and_names(
    pool: &PgPool,
    channel_ids: &[Uuid],
) -> Result<(HashMap<Uuid, Vec<ChannelParticipant>>, NameLookup), sqlx::Error> {
    let participant_rows = sqlx::query!(
        r#"
        SELECT channel_id, user_id
        FROM comms_channel_participants
        WHERE channel_id = ANY($1) AND left_at IS NULL
        "#,
        channel_ids
    )
    .fetch_all(pool)
    .await?;

    let mut participants_by_channel: HashMap<Uuid, Vec<ChannelParticipant>> = HashMap::new();
    let mut all_user_ids: HashSet<String> = HashSet::new();
    let placeholder_ts: DateTime<Utc> = DateTime::<Utc>::from_timestamp(0, 0).expect("epoch");
    for row in participant_rows {
        let user_id = MacroUserIdStr::parse_from_str(&row.user_id)
            .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
            .into_owned();
        all_user_ids.insert(row.user_id);
        participants_by_channel
            .entry(row.channel_id)
            .or_default()
            .push(ChannelParticipant {
                channel_id: ChannelId(row.channel_id),
                user_id,
                role: ParticipantRole::Member,
                joined_at: placeholder_ts,
                left_at: None,
            });
    }

    let user_id_strings: Vec<String> = all_user_ids.into_iter().collect();
    let name_rows = sqlx::query!(
        r#"
        SELECT u.id as user_profile_id, mui.first_name, mui.last_name
        FROM macro_user_info mui
        JOIN "User" u ON mui.macro_user_id = u.macro_user_id
        WHERE u.id = ANY($1)
        "#,
        &user_id_strings
    )
    .fetch_all(pool)
    .await?;

    let mut name_lookup = NameLookup::new();
    for row in name_rows {
        let Some(name) = display_name(row.first_name.as_deref(), row.last_name.as_deref()) else {
            continue;
        };
        let user_id = MacroUserIdStr::parse_from_str(&row.user_profile_id)
            .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
            .into_owned();
        name_lookup.insert(user_id, name);
    }

    Ok((participants_by_channel, name_lookup))
}

fn display_name(first: Option<&str>, last: Option<&str>) -> Option<String> {
    const NA: &str = "N/A";
    match (first.filter(|v| *v != NA), last.filter(|v| *v != NA)) {
        (None, None) => None,
        (None, Some(last)) => Some(last.to_string()),
        (Some(first), None) => Some(first.to_string()),
        (Some(first), Some(last)) => Some(format!("{first} {last}")),
    }
}
