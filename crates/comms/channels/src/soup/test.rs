use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use soup_types::comms::{SoupAgentDmProfile, SoupChannel};
use uuid::Uuid;

#[test]
fn channel_list_conversion_keeps_the_agent_dm_persona_and_auto_join() {
    let channel_id = Uuid::from_u128(1);
    let bot_id = BotId::new_from_uuid(Uuid::from_u128(2));
    let list_item = crate::domain::models::ChannelWithLatest {
        agent_dm: Some(crate::domain::agent_dm::AgentDmProfile {
            bot_id,
            name: "Researcher".to_string(),
            avatar_url: Some("https://example.com/researcher.png".to_string()),
        }),
        channel: crate::domain::models::ChannelWithParticipants {
            channel: crate::domain::models::ChannelListItem {
                id: channel_id,
                name: Some("Researcher".to_string()),
                channel_type: crate::domain::models::ChannelType::DirectMessage,
                org_id: None,
                team_id: Some(Uuid::from_u128(3)),
                auto_join_team: true,
                created_at: chrono::DateTime::<chrono::Utc>::default(),
                updated_at: chrono::DateTime::<chrono::Utc>::default(),
                owner_id: MacroUserIdStr::try_from("macro|owner@example.com".to_string()).unwrap(),
            },
            participants: Vec::new(),
            is_participant: true,
        },
        latest_message: crate::domain::models::LatestMessage::default(),
        viewed_at: None,
        interacted_at: None,
        frecency_score: None,
    };

    let channel = SoupChannel::from(list_item);

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
