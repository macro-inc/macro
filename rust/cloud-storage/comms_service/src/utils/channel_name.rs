use super::user_name::id_to_display_name;
use model::comms::ChannelParticipant;
use models_comms::ChannelType;
use std::collections::HashMap;
use uuid::Uuid;

pub type ChannelName = String;
pub type NameLookup = HashMap<String, String>;

pub fn resolve_channel_name(
    channel_type: &ChannelType,
    channel_name: Option<&str>,
    participants: &[ChannelParticipant],
    channel_id: &Uuid,
    user_id: &str,
    name_lookup: Option<&NameLookup>,
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
            ChannelType::DirectMessage => resolve_direct_message_channel_name(channel_name, participants, channel_id, user_id, name_lookup),
        }
}

pub fn resolve_private_channel_name(
    channel_name: Option<&str>,
    participants: &[ChannelParticipant],
    name_lookup: Option<&NameLookup>,
) -> ChannelName {
    if let Some(name) = &channel_name {
        return name.to_string();
    }

    participants
        .iter()
        .map(|p| id_to_display_name(&p.user_id, name_lookup))
        .collect::<Vec<String>>()
        .join(", ")
}

pub fn resolve_direct_message_channel_name(
    channel_name: Option<&str>,
    participants: &[ChannelParticipant],
    channel_id: &Uuid,
    user_id: &str,
    name_lookup: Option<&NameLookup>,
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
        id_to_display_name(&other.user_id, name_lookup)
    } else {
        tracing::error!(channel_id=?channel_id, "no other participant found, in a direct message channel");
        "Unknown".to_string()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use model::comms::{Channel, ChannelType};
    use uuid::Uuid;

    fn make_participants(channel_id: &Uuid) -> Vec<ChannelParticipant> {
        vec![
            ChannelParticipant {
                channel_id: channel_id.to_owned(),
                user_id: "macro|user1@macro.com".to_string(),
                role: model::comms::ParticipantRole::Owner,
                joined_at: chrono::Utc::now(),
                left_at: None,
            },
            ChannelParticipant {
                channel_id: channel_id.to_owned(),
                user_id: "macro|user2@macro.com".to_string(),
                role: model::comms::ParticipantRole::Member,
                joined_at: chrono::Utc::now(),
                left_at: None,
            },
        ]
    }

    #[test]
    fn test_resolve_private_channel_name() {
        let channel_with_name = Channel {
            id: Default::default(),
            name: Some("test".to_string()),
            channel_type: ChannelType::Private,
            org_id: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            owner_id: "test".to_string(),
        };

        let channel_without_name = Channel {
            id: Default::default(),
            name: None,
            channel_type: ChannelType::Private,
            org_id: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            owner_id: "test".to_string(),
        };

        let participants_with_name = make_participants(&channel_with_name.id);
        let participants_without_name = make_participants(&channel_without_name.id);

        assert_eq!(
            resolve_private_channel_name(
                channel_with_name.name.as_deref(),
                &participants_with_name,
                None
            ),
            "test"
        );
        assert_eq!(
            resolve_private_channel_name(
                channel_without_name.name.as_deref(),
                &participants_without_name,
                None
            ),
            "user1, user2"
        );
    }

    #[test]
    fn test_resolve_direct_message_channel_name() {
        let direct_message_channel = Channel {
            id: Default::default(),
            name: None,
            channel_type: ChannelType::DirectMessage,
            org_id: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            owner_id: "test".to_string(),
        };

        let participants = make_participants(&direct_message_channel.id);

        assert_eq!(
            resolve_direct_message_channel_name(
                direct_message_channel.name.as_deref(),
                &participants,
                &direct_message_channel.id,
                "macro|user1@macro.com",
                None
            ),
            "user2"
        );
    }

    #[test]
    fn test_resolve_direct_message_channel_name_for_other() {
        let direct_message_channel = Channel {
            id: Default::default(),
            name: None,
            channel_type: ChannelType::DirectMessage,
            org_id: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            owner_id: "test".to_string(),
        };

        // Test the preview for a user who is not in the channel
        let participants = make_participants(&direct_message_channel.id);

        assert_eq!(
            resolve_direct_message_channel_name(
                direct_message_channel.name.as_deref(),
                &participants,
                &direct_message_channel.id,
                "macro|user3@macro.com",
                None
            ),
            "user1, user2"
        );
    }

    #[test]
    fn test_resolve_organization_and_public_channel_name() {
        let organization_channel = Channel {
            id: Default::default(),
            name: Some("organization_channel".to_string()),
            channel_type: ChannelType::Organization,
            org_id: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            owner_id: "test".to_string(),
        };

        let public_channel = Channel {
            id: Default::default(),
            name: Some("public_channel".to_string()),
            channel_type: ChannelType::Public,
            org_id: None,
            created_at: chrono::Utc::now(),
            updated_at: chrono::Utc::now(),
            owner_id: "test".to_string(),
        };

        let org_participants = make_participants(&organization_channel.id);
        let pub_participants = make_participants(&public_channel.id);

        assert_eq!(
            resolve_channel_name(
                &organization_channel.channel_type,
                organization_channel.name.as_deref(),
                &org_participants,
                &organization_channel.id,
                "macro|user1@macro.com",
                None
            ),
            "organization_channel"
        );

        assert_eq!(
            resolve_channel_name(
                &public_channel.channel_type,
                public_channel.name.as_deref(),
                &pub_participants,
                &public_channel.id,
                "macro|user1@macro.com",
                None
            ),
            "public_channel"
        );
    }
}
