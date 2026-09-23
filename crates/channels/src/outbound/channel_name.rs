//! Batch channel-name resolution backed by Postgres.

use std::collections::{HashMap, HashSet};

use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use sqlx::PgPool;
use uuid::Uuid;

use crate::domain::models::{ChannelType, NameLookup, fallback_user_name};

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

    let channels = load_channels(pool, channel_ids).await?;
    let (participants_by_channel, name_lookup) =
        load_viewer_dependent_names(pool, &channels).await?;

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

/// Resolve the display name of one channel from the perspective of each of
/// `viewer_user_ids`, keyed by viewer.
///
/// DM and unnamed private channels are named after the *other* participants,
/// so the same channel reads differently to each member: to the caller a DM
/// is named after the callee, and to the callee it is named after the caller.
/// Use this when addressing several users about one channel (e.g. notifying
/// channel members) so each sees the name they know the channel by.
///
/// Returns an empty map when the channel does not exist. The viewer is not an
/// authorization check.
#[tracing::instrument(skip(pool), err)]
pub async fn resolve_channel_name_for_viewers<'a>(
    pool: &PgPool,
    channel_id: Uuid,
    viewer_user_ids: &[MacroUserIdStr<'a>],
) -> Result<HashMap<MacroUserIdStr<'static>, String>, sqlx::Error> {
    if viewer_user_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let channels = load_channels(pool, &[channel_id]).await?;
    let Some((name, channel_type)) = channels.get(&channel_id) else {
        return Ok(HashMap::new());
    };
    let (participants_by_channel, name_lookup) =
        load_viewer_dependent_names(pool, &channels).await?;
    let empty = Vec::new();
    let participants = participants_by_channel.get(&channel_id).unwrap_or(&empty);

    Ok(viewer_user_ids
        .iter()
        .map(|viewer| {
            let resolved_name = resolve_channel_name(
                *channel_type,
                name.as_deref(),
                channel_id,
                viewer.as_ref(),
                participants,
                &name_lookup,
            );
            (viewer.clone().into_owned(), resolved_name)
        })
        .collect())
}

type LoadedChannels = HashMap<Uuid, (Option<String>, ChannelType)>;

async fn load_channels(pool: &PgPool, channel_ids: &[Uuid]) -> Result<LoadedChannels, sqlx::Error> {
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

    Ok(channel_rows
        .into_iter()
        .map(|r| (r.id, (r.name, r.channel_type)))
        .collect())
}

/// Load participants and display names only for the channels whose name
/// depends on who is looking (DMs and unnamed private channels).
async fn load_viewer_dependent_names(
    pool: &PgPool,
    channels: &LoadedChannels,
) -> Result<(HashMap<Uuid, Vec<MacroUserIdStr<'static>>>, NameLookup), sqlx::Error> {
    let needs_participants: Vec<Uuid> = channels
        .iter()
        .filter(|(_, (name, ct))| {
            matches!(ct, ChannelType::DirectMessage)
                || (matches!(ct, ChannelType::Private)
                    && name.as_ref().is_none_or(|n| n.trim().is_empty()))
        })
        .map(|(id, _)| *id)
        .collect();

    if needs_participants.is_empty() {
        return Ok((HashMap::new(), HashMap::new()));
    }
    load_participants_and_names(pool, &needs_participants).await
}

async fn load_participants_and_names(
    pool: &PgPool,
    channel_ids: &[Uuid],
) -> Result<(HashMap<Uuid, Vec<MacroUserIdStr<'static>>>, NameLookup), sqlx::Error> {
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

    let mut participants_by_channel: HashMap<Uuid, Vec<MacroUserIdStr<'static>>> = HashMap::new();
    let mut all_user_ids: HashSet<MacroUserIdStr<'static>> = HashSet::new();
    for row in participant_rows {
        let Ok(user_id) = MacroUserIdStr::try_from(row.user_id) else {
            continue;
        };
        all_user_ids.insert(user_id.clone());
        participants_by_channel
            .entry(row.channel_id)
            .or_default()
            .push(user_id);
    }

    let user_id_strings: Vec<String> = all_user_ids
        .iter()
        .map(|user_id| user_id.as_ref().to_string())
        .collect();
    let user_ids_by_string: HashMap<_, _> = all_user_ids
        .into_iter()
        .map(|user_id| (user_id.as_ref().to_string(), user_id))
        .collect();
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
        let Some(user_id) = user_ids_by_string.get(&row.user_profile_id) else {
            continue;
        };
        name_lookup.insert(user_id.clone(), name);
    }

    Ok((participants_by_channel, name_lookup))
}

fn resolve_channel_name(
    channel_type: ChannelType,
    stored_name: Option<&str>,
    channel_id: Uuid,
    viewer_user_id: &str,
    participants: &[MacroUserIdStr<'static>],
    name_lookup: &NameLookup,
) -> String {
    if let Some(name) = stored_name.filter(|name| !name.trim().is_empty()) {
        return name.to_string();
    }

    match channel_type {
        ChannelType::Public | ChannelType::Team => format!("#{}", &channel_id.to_string()[..8]),
        ChannelType::Private => {
            let mut names: Vec<_> = participants
                .iter()
                .filter(|id| id.as_ref() != viewer_user_id)
                .map(|id| id_to_display_name(id, name_lookup))
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
            .find(|id| id.as_ref() != viewer_user_id)
            .map(|id| id_to_display_name(id, name_lookup))
            .unwrap_or_else(|| "Direct message".to_string()),
    }
}

fn id_to_display_name(user_id: &MacroUserIdStr<'static>, name_lookup: &NameLookup) -> String {
    match name_lookup.get(user_id) {
        Some(name) if !name.trim().is_empty() => name.clone(),
        _ => fallback_user_name(user_id),
    }
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn id_to_display_name_falls_back_to_email_local_part() {
        let name_lookup = NameLookup::new();

        let user_id =
            MacroUserIdStr::try_from("macro|shepherd.hatton@gmail.com".to_string()).unwrap();

        assert_eq!(
            id_to_display_name(&user_id, &name_lookup),
            "shepherd.hatton"
        );
    }
}
