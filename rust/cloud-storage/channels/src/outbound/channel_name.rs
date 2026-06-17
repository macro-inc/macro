//! Batch channel-name resolution backed by Postgres.

use std::collections::{HashMap, HashSet};

use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::ChannelType;

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

    let channels: HashMap<Uuid, (Option<String>, ChannelType)> = channel_rows
        .into_iter()
        .map(|r| (r.id, (r.name, r.channel_type)))
        .collect();

    let needs_participants: Vec<Uuid> = channels
        .iter()
        .filter(|(_, (name, ct))| {
            matches!(ct, ChannelType::DirectMessage)
                || (matches!(ct, ChannelType::Private)
                    && name.as_ref().is_none_or(|n| n.trim().is_empty()))
        })
        .map(|(id, _)| *id)
        .collect();

    let (participants_by_channel, name_lookup) = if needs_participants.is_empty() {
        (HashMap::new(), HashMap::new())
    } else {
        load_participants_and_names(pool, &needs_participants).await?
    };

    let mut resolved: HashMap<Uuid, String> = HashMap::with_capacity(channels.len());
    for (channel_id, (name, channel_type)) in &channels {
        let empty = Vec::new();
        let participants = participants_by_channel.get(channel_id).unwrap_or(&empty);
        let resolved_name = resolve_channel_name(
            *channel_type,
            name.as_deref(),
            *channel_id,
            viewer_user_id.as_ref(),
            participants,
            &name_lookup,
        );
        resolved.insert(*channel_id, resolved_name);
    }

    Ok(resolved)
}

async fn load_participants_and_names(
    pool: &PgPool,
    channel_ids: &[Uuid],
) -> Result<(HashMap<Uuid, Vec<String>>, HashMap<String, String>), sqlx::Error> {
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

    let mut participants_by_channel: HashMap<Uuid, Vec<String>> = HashMap::new();
    let mut all_user_ids: HashSet<String> = HashSet::new();
    for row in participant_rows {
        all_user_ids.insert(row.user_id.clone());
        participants_by_channel
            .entry(row.channel_id)
            .or_default()
            .push(row.user_id);
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

    let mut name_lookup = HashMap::new();
    for row in name_rows {
        let Some(name) = display_name(row.first_name.as_deref(), row.last_name.as_deref()) else {
            continue;
        };
        name_lookup.insert(row.user_profile_id, name);
    }

    Ok((participants_by_channel, name_lookup))
}

fn resolve_channel_name(
    channel_type: ChannelType,
    stored_name: Option<&str>,
    channel_id: Uuid,
    viewer_user_id: &str,
    participants: &[String],
    name_lookup: &HashMap<String, String>,
) -> String {
    if let Some(name) = stored_name.filter(|name| !name.trim().is_empty()) {
        return name.to_string();
    }

    match channel_type {
        ChannelType::Public | ChannelType::Team => format!("#{}", &channel_id.to_string()[..8]),
        ChannelType::Private => {
            let mut names: Vec<_> = participants
                .iter()
                .filter(|id| id.as_str() != viewer_user_id)
                .map(|id| display_name_for_user(id, name_lookup))
                .collect();
            names.sort();
            if names.is_empty() {
                "Private channel".to_string()
            } else {
                names.join(", ")
            }
        }
        ChannelType::DirectMessage => participants
            .iter()
            .find(|id| id.as_str() != viewer_user_id)
            .map(|id| display_name_for_user(id, name_lookup))
            .unwrap_or_else(|| "Direct message".to_string()),
    }
}

fn display_name_for_user(user_id: &str, name_lookup: &HashMap<String, String>) -> String {
    name_lookup
        .get(user_id)
        .cloned()
        .unwrap_or_else(|| user_id.to_string())
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
