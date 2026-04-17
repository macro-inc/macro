use macro_user_id::{cowlike::CowLike, email::ReadEmailParts, user_id::MacroUserIdStr};
use models_comms::channel::{ChannelId, ChannelParticipant, ChannelType};
use std::collections::HashMap;
use uuid::Uuid;

pub type ChannelName = String;
pub type NameLookup = HashMap<MacroUserIdStr<'static>, String>;

#[cfg(test)]
mod tests;

#[tracing::instrument(skip_all)]
pub fn resolve_channel_name(
    channel_type: &ChannelType,
    channel_name: Option<&str>,
    participants: &[ChannelParticipant],
    channel_id: &ChannelId,
    user_id: MacroUserIdStr<'_>,
    name_lookup: &NameLookup,
) -> ChannelName {
    match channel_type {
            ChannelType::Organization | ChannelType::Public => channel_name.map(|name| name.to_string()).unwrap_or_else(|| {
                tracing::warn!(channel_id=?channel_id, "organization or public channel should have a name");
                match channel_type {
                    ChannelType::Organization => "Organization".to_string(),
                    ChannelType::Public => "Public".to_string(),
                    _ => unreachable!(),
                }
            }),
            ChannelType::Private => resolve_private_channel_name(channel_name, participants, name_lookup),
            ChannelType::DirectMessage => match resolve_direct_message_channel_name(channel_name, participants, &channel_id.0, user_id, name_lookup) {
                Ok(c) | Err(c) => c,
            }
            ChannelType::Team => channel_name.map(|name| name.to_string()).unwrap_or_else(|| {
                tracing::warn!(channel_id=?channel_id, "team channel should have a name");
                "Team".to_string()
            }),
        }
}

pub fn resolve_private_channel_name(
    channel_name: Option<&str>,
    participants: &[ChannelParticipant],
    name_lookup: &NameLookup,
) -> ChannelName {
    if let Some(name) = &channel_name
        && !name.trim().is_empty()
    {
        return name.to_string();
    }

    participants
        .iter()
        .map(|p| id_to_display_name(p.user_id.copied(), name_lookup))
        .collect::<Vec<String>>()
        .join(", ")
}

#[tracing::instrument(err)]
pub fn resolve_direct_message_channel_name(
    channel_name: Option<&str>,
    participants: &[ChannelParticipant],
    channel_id: &Uuid,
    user_id: MacroUserIdStr<'_>,
    name_lookup: &NameLookup,
) -> Result<ChannelName, ChannelName> {
    // Direct Message Channels should not have a name
    if channel_name.is_some() {
        tracing::warn!(channel_id=?channel_id, "direct message channel should not have a name");
    }

    if !participants.iter().any(|p| p.user_id == user_id) {
        return Ok(resolve_private_channel_name(
            channel_name,
            participants,
            name_lookup,
        ));
    }

    let other_participant = participants.iter().find(|p| p.user_id != user_id);

    if let Some(other) = other_participant {
        Ok(id_to_display_name(other.user_id.copied(), name_lookup))
    } else {
        tracing::warn!("{participants:?}");

        Err("Unknown".to_string())
    }
}

fn id_to_display_name(id: MacroUserIdStr<'_>, name_lookup: &NameLookup) -> String {
    match name_lookup.get(&id) {
        Some(name) if !name.trim().is_empty() => name.clone(),
        _ => id.email_part().local_part().to_string(),
    }
}
