//! Channel name resolution logic.
//!
//! Resolves the display name for a channel based on its type, stored name,
//! and participants. Mirrors the logic in the `comms` crate's
//! `domain::models::channel_name` module.

use std::collections::HashMap;

use macro_user_id::{cowlike::CowLike, email::ReadEmailParts, user_id::MacroUserIdStr};
use uuid::Uuid;

/// Maps user IDs to display names.
pub type NameLookup = HashMap<String, String>;

/// Resolve the display name for a channel.
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
