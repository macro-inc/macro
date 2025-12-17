use macro_user_id::{cowlike::CowLike, email::ReadEmailParts, user_id::MacroUserIdStr};
use models_comms::{
    ChannelType,
    channel::{ChannelId, ChannelParticipant},
};
use std::collections::HashMap;
use uuid::Uuid;

pub type ChannelName = String;
pub type NameLookup = HashMap<MacroUserIdStr<'static>, String>;

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
            ChannelType::DirectMessage => resolve_direct_message_channel_name(channel_name, participants, &channel_id.0, user_id, name_lookup),
        }
}

pub fn resolve_private_channel_name(
    channel_name: Option<&str>,
    participants: &[ChannelParticipant],
    name_lookup: &NameLookup,
) -> ChannelName {
    if let Some(name) = &channel_name {
        return name.to_string();
    }

    participants
        .iter()
        .map(|p| id_to_display_name(p.user_id.copied(), name_lookup))
        .collect::<Vec<String>>()
        .join(", ")
}

pub fn resolve_direct_message_channel_name(
    channel_name: Option<&str>,
    participants: &[ChannelParticipant],
    channel_id: &Uuid,
    user_id: MacroUserIdStr<'_>,
    name_lookup: &NameLookup,
) -> ChannelName {
    // Direct Message Channels should not have a name
    if channel_name.is_some() {
        tracing::warn!(channel_id=?channel_id, "direct message channel should not have a name");
    }

    if !participants.iter().any(|p| p.user_id == user_id) {
        return resolve_private_channel_name(channel_name, participants, name_lookup);
    }

    let other_participant = participants.iter().find(|p| p.user_id != user_id);

    if let Some(other) = other_participant {
        id_to_display_name(other.user_id.copied(), name_lookup)
    } else {
        tracing::error!(channel_id=?channel_id, "no other participant found, in a direct message channel");
        "Unknown".to_string()
    }
}

fn id_to_display_name(id: MacroUserIdStr<'_>, name_lookup: &NameLookup) -> String {
    match name_lookup.get(&id) {
        Some(name) => name.clone(),
        None => id.email_part().local_part().to_string(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use macro_user_id::user_id::MacroUserIdStr;
    use models_comms::channel::{Channel, ChannelId, ChannelType};
    use uuid::Uuid;

    fn make_participants(channel_id: &Uuid) -> Vec<ChannelParticipant> {
        vec![
            ChannelParticipant {
                channel_id: ChannelId(channel_id.to_owned()),
                user_id: MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap(),
                role: models_comms::channel::ParticipantRole::Owner,
                joined_at: chrono::Utc::now(),
                left_at: None,
            },
            ChannelParticipant {
                channel_id: ChannelId(channel_id.to_owned()),
                user_id: MacroUserIdStr::parse_from_str("macro|user2@macro.com").unwrap(),
                role: models_comms::channel::ParticipantRole::Member,
                joined_at: chrono::Utc::now(),
                left_at: None,
            },
        ]
    }

    #[test]
    fn test_resolve_private_channel_name() {
        let channel_with_name = Channel {
            id: ChannelId(Uuid::default()),
            name: Some("test".to_string()),
            channel_type: ChannelType::Private,
            org_id: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            owner_id: MacroUserIdStr::parse_from_str("macro|test@test.com").unwrap(),
        };

        let channel_without_name = Channel {
            id: ChannelId(Uuid::default()),
            name: None,
            channel_type: ChannelType::Private,
            org_id: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            owner_id: MacroUserIdStr::parse_from_str("macro|test@test.com").unwrap(),
        };

        let participants_with_name = make_participants(&channel_with_name.id.0);
        let participants_without_name = make_participants(&channel_without_name.id.0);

        assert_eq!(
            resolve_private_channel_name(
                channel_with_name.name.as_deref(),
                &participants_with_name,
                &Default::default()
            ),
            "test"
        );
        assert_eq!(
            resolve_private_channel_name(
                channel_without_name.name.as_deref(),
                &participants_without_name,
                &Default::default()
            ),
            "user1, user2"
        );
    }

    #[test]
    fn test_resolve_direct_message_channel_name() {
        let direct_message_channel = Channel {
            id: ChannelId(Default::default()),
            name: None,
            channel_type: ChannelType::DirectMessage,
            org_id: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            owner_id: MacroUserIdStr::parse_from_str("macro|test@test.com").unwrap(),
        };

        let participants = make_participants(&direct_message_channel.id.0);

        assert_eq!(
            resolve_direct_message_channel_name(
                direct_message_channel.name.as_deref(),
                &participants,
                &direct_message_channel.id.0,
                MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap(),
                &Default::default()
            ),
            "user2"
        );
    }

    #[test]
    fn test_resolve_direct_message_channel_name_for_other() {
        let direct_message_channel = Channel {
            id: ChannelId(Default::default()),
            name: None,
            channel_type: ChannelType::DirectMessage,
            org_id: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            owner_id: MacroUserIdStr::parse_from_str("macro|test@test.com").unwrap(),
        };

        // Test the preview for a user who is not in the channel
        let participants = make_participants(&direct_message_channel.id.0);

        assert_eq!(
            resolve_direct_message_channel_name(
                direct_message_channel.name.as_deref(),
                &participants,
                &direct_message_channel.id.0,
                MacroUserIdStr::parse_from_str("macro|user3@macro.com").unwrap(),
                &Default::default()
            ),
            "user1, user2"
        );
    }

    #[test]
    fn test_resolve_organization_and_public_channel_name() {
        let organization_channel = Channel {
            id: ChannelId(Default::default()),
            name: Some("organization_channel".to_string()),
            channel_type: ChannelType::Organization,
            org_id: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            owner_id: MacroUserIdStr::parse_from_str("macro|test@test.com").unwrap(),
        };

        let public_channel = Channel {
            id: ChannelId(Default::default()),
            name: Some("public_channel".to_string()),
            channel_type: ChannelType::Public,
            org_id: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            owner_id: MacroUserIdStr::parse_from_str("macro|test@test.com").unwrap(),
        };

        let org_participants = make_participants(&organization_channel.id.0);
        let pub_participants = make_participants(&public_channel.id.0);

        assert_eq!(
            resolve_channel_name(
                &organization_channel.channel_type,
                organization_channel.name.as_deref(),
                &org_participants,
                &organization_channel.id,
                MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap(),
                &Default::default()
            ),
            "organization_channel"
        );

        assert_eq!(
            resolve_channel_name(
                &public_channel.channel_type,
                public_channel.name.as_deref(),
                &pub_participants,
                &public_channel.id,
                MacroUserIdStr::parse_from_str("macro|user1@macro.com").unwrap(),
                &Default::default()
            ),
            "public_channel"
        );
    }
}
