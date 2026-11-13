use super::*;
use models_soup::comms::{
    Channel, ChannelId, ChannelType, ChannelWithParticipants, LatestMessage, SoupAgentDmProfile,
    SoupChannel,
};

fn soup_channel(
    id: Uuid,
    name: &str,
    auto_join_team: bool,
    agent_dm: Option<SoupAgentDmProfile>,
) -> SoupItem<()> {
    SoupItem::Channel(SoupChannel {
        agent_dm,
        channel: ChannelWithParticipants {
            channel: Channel {
                id: ChannelId(id),
                name: Some(name.to_string()),
                channel_type: ChannelType::DirectMessage,
                org_id: None,
                team_id: None,
                auto_join_team,
                created_at: "2026-01-01T00:00:00Z".parse().unwrap(),
                updated_at: "2026-01-02T00:00:00Z".parse().unwrap(),
                owner_id: MacroUserIdStr::try_from(VALID_USER_ID.to_string()).unwrap(),
            },
            participants: Vec::new(),
            is_participant: true,
        },
        latest_message: LatestMessage::default(),
        viewed_at: None,
        interacted_at: None,
    })
}

#[tokio::test]
async fn channels_carry_auto_join_and_the_agent_dm_persona_the_rest_list_returns() {
    let harness = harness();
    let team_channel = Uuid::from_u128(1);
    let agent_dm = Uuid::from_u128(2);
    harness.soup_service.set_raw_response(vec![
        soup_channel(team_channel, "general", true, None),
        soup_channel(
            agent_dm,
            "Researcher",
            false,
            Some(SoupAgentDmProfile {
                bot_id: bot_id::BotId::new_from_uuid(Uuid::from_u128(3)),
                name: "Researcher".to_string(),
                avatar_url: Some("https://example.com/researcher.png".to_string()),
            }),
        ),
    ]);

    let response = harness
        .execute(
            r#"{ user { soup(input: {initial: {filters: {channelFilter: {literal: {isParticipant: true}}}}}) {
                items {
                    __typename id
                    ... on GraphqlSoupChannel { name autoJoinTeam agentDm { botId name avatarUrl } }
                }
            } } }"#,
        )
        .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data,
        async_graphql::value!({ "user": { "soup": { "items": [
            {
                "__typename": "GraphqlSoupChannel",
                "id": "00000000-0000-0000-0000-000000000001",
                "name": "general",
                "autoJoinTeam": true,
                "agentDm": null
            },
            {
                "__typename": "GraphqlSoupChannel",
                "id": "00000000-0000-0000-0000-000000000002",
                "name": "Researcher",
                "autoJoinTeam": false,
                "agentDm": {
                    "botId": "00000000-0000-0000-0000-000000000003",
                    "name": "Researcher",
                    "avatarUrl": "https://example.com/researcher.png"
                }
            }
        ] } } })
    );
}
