use bots::domain::{
    models::{Bot, BotId, BotIdentity},
    ports::BotError,
};
use entity_access::domain::models::{MemberParticipantRole, ParticipantRole};
use graphql_bots::{BotReads, BotsGraphqlContext, ChannelMemberAuthorizer, bot_identity_loader};

use super::*;

/// The bot `soup_agent_session` runs as.
const SESSION_BOT: Uuid = Uuid::from_u128(99);
const MEMBER_CHANNEL: Uuid = Uuid::from_u128(0x10);

fn session_bot() -> BotIdentity {
    BotIdentity {
        id: BotId::new_from_uuid(SESSION_BOT),
        name: "Ship Scout".to_string(),
        handle: "scout".to_string(),
        avatar_url: Some("https://static.example/scout.png".to_string()),
        deleted_at: None,
        is_system: false,
    }
}

struct FakeBots;

impl BotReads for FakeBots {
    async fn identities(&self, ids: &[BotId]) -> Result<Vec<BotIdentity>, BotError> {
        Ok([session_bot()]
            .into_iter()
            .filter(|identity| ids.contains(&identity.id))
            .collect())
    }

    async fn mentionable_bots(
        &self,
        _caller: MacroUserIdStr<'static>,
        _channel: Option<EntityAccessReceipt<MemberParticipantRole>>,
    ) -> Result<Vec<Bot>, BotError> {
        Ok(Vec::new())
    }
}

/// A member of [`MEMBER_CHANNEL`] only.
struct MemberOfOneChannel;

impl ChannelMemberAuthorizer for MemberOfOneChannel {
    async fn authorize_channel_member(
        &self,
        user_id: &MacroUserIdStr<'static>,
        channel_id: Uuid,
    ) -> Result<EntityAccessReceipt<MemberParticipantRole>, AccessError> {
        if channel_id != MEMBER_CHANNEL {
            return Err(AccessError::Unauthorized);
        }
        EntityAccessReceipt::try_new_authenticated_user(
            user_id.clone(),
            entity_access::domain::models::Entity {
                entity_id: channel_id.to_string(),
                entity_type: EntityType::Channel,
            },
            EntityPermission::ChannelRole {
                role: ParticipantRole::Member,
            },
        )
    }
}

async fn execute_with_bots(harness: &TestHarness, query: &str) -> async_graphql::Response {
    let context = BotsGraphqlContext::new(Arc::new(FakeBots), Arc::new(MemberOfOneChannel));
    harness
        .schema
        .execute(
            harness
                .request(query, authenticated_parts())
                // DSS puts the authenticated user in request data.
                .data(MacroUserIdStr::parse_from_str(VALID_USER_ID).unwrap())
                .data(bot_identity_loader(context.clone()))
                .data(context),
        )
        .await
}

#[tokio::test]
async fn bots_by_id_hang_off_the_authenticated_user() {
    let harness = harness();

    let response = execute_with_bots(
        &harness,
        r#"{ user { bots(ids: ["00000000-0000-0000-0000-000000000063"]) {
            __typename id name handle avatarUrl deletedAt isSystem
        } } }"#,
    )
    .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data,
        async_graphql::value!({ "user": { "bots": [{
            "__typename": "GraphqlBot",
            "id": "00000000-0000-0000-0000-000000000063",
            "name": "Ship Scout",
            "handle": "scout",
            "avatarUrl": "https://static.example/scout.png",
            "deletedAt": null,
            "isSystem": false
        }] } })
    );
}

#[tokio::test]
async fn bot_lookups_require_an_authenticated_user() {
    let harness = harness();
    let context = BotsGraphqlContext::new(Arc::new(FakeBots), Arc::new(MemberOfOneChannel));

    let response = harness
        .schema
        .execute(
            harness
                .request(
                    r#"{ user { bots(ids: ["00000000-0000-0000-0000-000000000063"]) { id } } }"#,
                    bearer_parts("invalid"),
                )
                .data(context),
        )
        .await;

    assert!(!response.errors.is_empty());
    assert_eq!(response.data, async_graphql::Value::Null);
}

#[tokio::test]
async fn agent_sessions_read_their_bot_as_the_shared_bot_record() {
    let harness = harness();
    let session_id = Uuid::from_u128(7);
    harness
        .soup_service
        .set_raw_response(vec![soup_agent_session(session_id)]);

    let response = execute_with_bots(
        &harness,
        r#"{ user { soup(input: {initial: {}}) { items {
            __typename id
            ... on GraphqlSoupAgentSession {
                botProfile { __typename id name handle avatarUrl }
                bot { id name avatarUrl }
            }
        } } } }"#,
    )
    .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data,
        async_graphql::value!({ "user": { "soup": { "items": [{
            "__typename": "GraphqlSoupAgentSession",
            "id": "00000000-0000-0000-0000-000000000007",
            "botProfile": {
                "__typename": "GraphqlBot",
                "id": "00000000-0000-0000-0000-000000000063",
                "name": "Ship Scout",
                "handle": "scout",
                "avatarUrl": "https://static.example/scout.png"
            },
            "bot": {
                "id": "00000000-0000-0000-0000-000000000063",
                "name": "Ship Scout",
                "avatarUrl": "https://static.example/scout.png"
            }
        }] } } })
    );
}
