//! Channel display-name resolution.
//!
//! Mirrors the logic in the `comms` crate's `domain::models::channel_name`
//! module but drives off the raw Postgres enum value so callers don't need
//! to round-trip through the typed `ChannelType`.

use std::collections::{HashMap, HashSet};

use macro_user_id::{cowlike::CowLike, email::ReadEmailParts, user_id::MacroUserIdStr};
use sqlx::PgPool;
use uuid::Uuid;

/// Maps user profile ids to display names.
pub type NameLookup = HashMap<String, String>;

/// Resolve the display name for a single channel.
///
/// `channel_type` is the raw Postgres enum value (`"public"`,
/// `"organization"`, `"private"`, `"direct_message"`, `"team"`).
pub fn resolve_channel_name(
    channel_type: &str,
    channel_name: Option<&str>,
    participant_user_ids: &[MacroUserIdStr<'_>],
    channel_id: &Uuid,
    user_id: MacroUserIdStr<'_>,
    name_lookup: &NameLookup,
) -> String {
    match channel_type {
        "organization" | "public" => channel_name.map(|n| n.to_string()).unwrap_or_else(|| {
            tracing::warn!(
                ?channel_id,
                "organization or public channel should have a name"
            );
            if channel_type == "organization" {
                "Organization"
            } else {
                "Public"
            }
            .to_string()
        }),
        "private" => resolve_private_channel_name(channel_name, participant_user_ids, name_lookup),
        "direct_message" => resolve_direct_message_channel_name(
            channel_name,
            participant_user_ids,
            channel_id,
            user_id,
            name_lookup,
        ),
        "team" => channel_name.map(|n| n.to_string()).unwrap_or_else(|| {
            tracing::warn!(?channel_id, "team channel should have a name");
            "Team".to_string()
        }),
        _ => channel_name.unwrap_or("Unknown").to_string(),
    }
}

fn resolve_private_channel_name(
    channel_name: Option<&str>,
    participant_user_ids: &[MacroUserIdStr<'_>],
    name_lookup: &NameLookup,
) -> String {
    if let Some(name) = channel_name
        && !name.trim().is_empty()
    {
        return name.to_string();
    }

    participant_user_ids
        .iter()
        .map(|id| id_to_display_name(id.copied(), name_lookup))
        .collect::<Vec<String>>()
        .join(", ")
}

fn resolve_direct_message_channel_name(
    channel_name: Option<&str>,
    participant_user_ids: &[MacroUserIdStr<'_>],
    channel_id: &Uuid,
    user_id: MacroUserIdStr<'_>,
    name_lookup: &NameLookup,
) -> String {
    if channel_name.is_some() {
        tracing::warn!(?channel_id, "direct message channel should not have a name");
    }

    if !participant_user_ids
        .iter()
        .any(|p| p.as_ref() == user_id.as_ref())
    {
        return resolve_private_channel_name(channel_name, participant_user_ids, name_lookup);
    }

    let other = participant_user_ids
        .iter()
        .find(|p| p.as_ref() != user_id.as_ref());

    if let Some(other) = other {
        id_to_display_name(other.copied(), name_lookup)
    } else {
        "Unknown".to_string()
    }
}

fn id_to_display_name(id: MacroUserIdStr<'_>, name_lookup: &NameLookup) -> String {
    match name_lookup.get(id.as_ref()) {
        Some(name) if !name.trim().is_empty() => name.clone(),
        _ => id.email_part().local_part().to_string(),
    }
}

/// Build a display name from optional first and last name parts.
///
/// Returns `None` if both are missing or `"N/A"`.
pub fn display_name(first: Option<&str>, last: Option<&str>) -> Option<String> {
    const NA: &str = "N/A";
    match (first.filter(|v| *v != NA), last.filter(|v| *v != NA)) {
        (None, None) => None,
        (None, Some(last)) => Some(last.to_string()),
        (Some(first), None) => Some(first.to_string()),
        (Some(first), Some(last)) => Some(format!("{first} {last}")),
    }
}

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

    let channel_info_rows = sqlx::query!(
        r#"
        SELECT id, name, channel_type::text as "channel_type!"
        FROM comms_channels
        WHERE id = ANY($1)
        "#,
        channel_ids,
    )
    .fetch_all(pool)
    .await?;

    let channel_map: HashMap<Uuid, (Option<String>, String)> = channel_info_rows
        .into_iter()
        .map(|r| (r.id, (r.name, r.channel_type)))
        .collect();

    let needs_participants: Vec<Uuid> = channel_map
        .iter()
        .filter(|(_, (name, ct))| {
            ct == "direct_message"
                || (ct == "private" && name.as_ref().is_none_or(|n| n.trim().is_empty()))
        })
        .map(|(id, _)| *id)
        .collect();

    let (participant_map, name_lookup) = if needs_participants.is_empty() {
        (HashMap::new(), NameLookup::new())
    } else {
        let participant_rows = sqlx::query!(
            r#"
            SELECT channel_id, user_id
            FROM comms_channel_participants
            WHERE channel_id = ANY($1) AND left_at IS NULL
            "#,
            &needs_participants
        )
        .fetch_all(pool)
        .await?;

        let mut part_map: HashMap<Uuid, Vec<MacroUserIdStr<'static>>> = HashMap::new();
        let mut all_user_ids = HashSet::new();
        for row in participant_rows {
            let uid = MacroUserIdStr::parse_from_str(&row.user_id)
                .expect("valid user id from db")
                .into_owned();
            all_user_ids.insert(row.user_id);
            part_map.entry(row.channel_id).or_default().push(uid);
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

        let lookup: NameLookup = name_rows
            .into_iter()
            .filter_map(|row| {
                let name = display_name(row.first_name.as_deref(), row.last_name.as_deref())?;
                Some((row.user_profile_id, name))
            })
            .collect();

        (part_map, lookup)
    };

    let mut resolved: HashMap<Uuid, String> = HashMap::with_capacity(channel_map.len());
    for (channel_id, (name, channel_type)) in &channel_map {
        let empty = Vec::new();
        let participants = participant_map.get(channel_id).unwrap_or(&empty);
        let resolved_name = resolve_channel_name(
            channel_type,
            name.as_deref(),
            participants,
            channel_id,
            viewer_user_id.copied(),
            &name_lookup,
        );
        resolved.insert(*channel_id, resolved_name);
    }

    Ok(resolved)
}
