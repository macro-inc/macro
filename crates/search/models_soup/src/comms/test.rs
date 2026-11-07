use super::*;
use crate::item::SoupItem;

fn sample_channel(is_participant: bool) -> SoupChannel {
    SoupChannel {
        channel: ChannelWithParticipants {
            channel: Channel {
                id: ChannelId(Uuid::nil()),
                name: Some("general".to_string()),
                channel_type: ChannelType::Team,
                org_id: None,
                team_id: Some(Uuid::nil()),
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
