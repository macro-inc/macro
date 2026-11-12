use super::*;
use crate::item::SoupItem;

fn sample_channel(is_participant: bool) -> SoupChannel {
    SoupChannel {
        agent_dm: None,
        channel: ChannelWithParticipants {
            channel: Channel {
                id: ChannelId(Uuid::nil()),
                name: Some("general".to_string()),
                channel_type: ChannelType::Team,
                org_id: None,
                team_id: Some(Uuid::nil()),
                auto_join_team: false,
                created_at: chrono::DateTime::<chrono::Utc>::default(),
                updated_at: chrono::DateTime::<chrono::Utc>::default(),
                owner_id: MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap(),
            },
            participants: Vec::new(),
            is_participant,
        },
        latest_message: LatestMessage::default(),
        viewed_at: None,
        interacted_at: None,
    }
}

#[test]
fn soup_channel_serializes_is_participant_at_the_item_top_level() {
    let item = SoupItem::<()>::Channel(sample_channel(false));

    let json = serde_json::to_value(&item).unwrap();

    assert_eq!(json["tag"], "channel");
    assert_eq!(json["data"]["is_participant"], serde_json::json!(false));
    // The flag describes the requesting user, not the channel row itself.
    assert!(json["data"]["channel"].get("is_participant").is_none());
}

#[test]
fn channel_payload_without_is_participant_still_deserializes() {
    let mut json = serde_json::to_value(sample_channel(true)).unwrap();
    json.as_object_mut()
        .unwrap()
        .remove("is_participant")
        .unwrap();

    let channel: SoupChannel = serde_json::from_value(json).unwrap();

    assert!(!channel.channel.is_participant);
}

#[test]
fn channel_list_conversion_keeps_the_agent_dm_persona_and_auto_join() {
    let channel_id = Uuid::from_u128(1);
    let bot_id = BotId::new_from_uuid(Uuid::from_u128(2));
    let list_item = channels::domain::models::ChannelWithLatest {
        agent_dm: Some(channels::domain::agent_dm::AgentDmProfile {
            bot_id,
            name: "Researcher".to_string(),
            avatar_url: Some("https://example.com/researcher.png".to_string()),
        }),
        channel: channels::domain::models::ChannelWithParticipants {
            channel: channels::domain::models::ChannelListItem {
                id: channel_id,
                name: Some("Researcher".to_string()),
                channel_type: channels::domain::models::ChannelType::DirectMessage,
                org_id: None,
                team_id: Some(Uuid::from_u128(3)),
                auto_join_team: true,
                created_at: chrono::DateTime::<chrono::Utc>::default(),
                updated_at: chrono::DateTime::<chrono::Utc>::default(),
                owner_id: MacroUserIdStr::try_from("macro|owner@example.com".to_string())
                    .unwrap(),
            },
            participants: Vec::new(),
            is_participant: true,
        },
        latest_message: channels::domain::models::LatestMessage::default(),
        viewed_at: None,
        interacted_at: None,
        frecency_score: None,
    };

    let channel = SoupChannel::new_from_channels(list_item);

    assert_eq!(
        channel.agent_dm,
        Some(SoupAgentDmProfile {
            bot_id,
            name: "Researcher".to_string(),
            avatar_url: Some("https://example.com/researcher.png".to_string()),
        })
    );
    assert!(channel.channel.channel.auto_join_team);
}

#[test]
fn channel_payload_without_agent_dm_or_auto_join_still_deserializes() {
    let mut json = serde_json::to_value(sample_channel(true)).unwrap();
    json["channel"]
        .as_object_mut()
        .unwrap()
        .remove("auto_join_team")
        .unwrap();

    let channel: SoupChannel = serde_json::from_value(json).unwrap();

    assert!(channel.agent_dm.is_none());
    assert!(!channel.channel.channel.auto_join_team);
}
