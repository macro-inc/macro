use std::sync::{Arc, Mutex};

use async_graphql::{Context, EmptyMutation, EmptySubscription, ID, Object, Schema, value};
use bots::domain::{
    models::{Bot, BotId, BotIdentity, BotKind},
    ports::BotError,
};
use chrono::{TimeZone as _, Utc};
use entity_access::domain::models::{
    AccessError, Entity, EntityAccessReceipt, EntityPermission, EntityType, MemberParticipantRole,
    ParticipantRole,
};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::{
    BotReads, BotsGraphqlContext, ChannelMemberAuthorizer, GraphqlBot, GraphqlBotsQuery,
    bot_identity_loader, resolve_bot,
};

const VIEWER: &str = "macro|viewer@example.com";
const MEMBER_CHANNEL: Uuid = Uuid::from_u128(0x10);
const OTHER_CHANNEL: Uuid = Uuid::from_u128(0x20);
const SCOUT: Uuid = Uuid::from_u128(0x01);
const RETIRED: Uuid = Uuid::from_u128(0x02);

fn viewer() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(VIEWER).unwrap()
}

fn scout() -> BotIdentity {
    BotIdentity {
        id: BotId::new_from_uuid(SCOUT),
        name: "Release Scout".to_string(),
        handle: "scout".to_string(),
        avatar_url: Some("https://static.example/scout.png".to_string()),
        deleted_at: None,
        is_system: false,
    }
}

fn retired() -> BotIdentity {
    BotIdentity {
        id: BotId::new_from_uuid(RETIRED),
        name: "Old Alerts".to_string(),
        handle: "old-alerts".to_string(),
        avatar_url: None,
        deleted_at: Some(Utc.with_ymd_and_hms(2026, 11, 1, 12, 0, 0).unwrap()),
        is_system: false,
    }
}

fn installed_bot() -> Bot {
    let at = Utc.with_ymd_and_hms(2026, 10, 1, 0, 0, 0).unwrap();
    Bot {
        id: BotId::new_from_uuid(SCOUT),
        kind: BotKind::Owned,
        owner: None,
        name: "Release Scout".to_string(),
        handle: "scout".to_string(),
        description: Some("Watches releases".to_string()),
        avatar_url: None,
        created_by: None,
        created_at: at,
        updated_at: at,
        deleted_at: None,
        has_agent: true,
    }
}

#[derive(Default)]
struct FakeBots {
    identity_calls: Mutex<Vec<Vec<BotId>>>,
    mentionable_channels: Mutex<Vec<Option<String>>>,
}

impl BotReads for FakeBots {
    async fn identities(&self, ids: &[BotId]) -> Result<Vec<BotIdentity>, BotError> {
        self.identity_calls.lock().unwrap().push(ids.to_vec());
        // Like the service: request order, unknown ids left out.
        Ok(ids
            .iter()
            .filter_map(|id| {
                [scout(), retired()]
                    .into_iter()
                    .find(|identity| identity.id == *id)
            })
            .collect())
    }

    async fn mentionable_bots(
        &self,
        _caller: MacroUserIdStr<'static>,
        channel: Option<EntityAccessReceipt<MemberParticipantRole>>,
    ) -> Result<Vec<Bot>, BotError> {
        self.mentionable_channels
            .lock()
            .unwrap()
            .push(channel.map(|receipt| receipt.entity().entity_id.clone()));
        Ok(vec![installed_bot()])
    }
}

/// Grants membership of [`MEMBER_CHANNEL`] only.
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
            Entity {
                entity_id: channel_id.to_string(),
                entity_type: EntityType::Channel,
            },
            EntityPermission::ChannelRole {
                role: ParticipantRole::Member,
            },
        )
    }
}

struct Query;

#[Object]
impl Query {
    #[graphql(flatten)]
    async fn bots_query(&self) -> GraphqlBotsQuery {
        GraphqlBotsQuery::new(viewer())
    }

    async fn bot_edge(
        &self,
        ctx: &Context<'_>,
        id: ID,
    ) -> async_graphql::Result<Option<GraphqlBot>> {
        resolve_bot(ctx, BotId::new_from_uuid(Uuid::parse_str(&id)?)).await
    }
}

async fn execute(bots: &Arc<FakeBots>, query: &str) -> async_graphql::Response {
    let context = BotsGraphqlContext::new(Arc::clone(bots), Arc::new(MemberOfOneChannel));
    let schema = Schema::new(Query, EmptyMutation, EmptySubscription);
    schema
        .execute(
            async_graphql::Request::new(query)
                .data(viewer())
                .data(bot_identity_loader(context.clone()))
                .data(context),
        )
        .await
}

fn error_code(response: &async_graphql::Response) -> Option<String> {
    let extensions = response.errors.first()?.extensions.as_ref()?;
    match extensions.get("code")? {
        async_graphql::Value::String(code) => Some(code.clone()),
        _ => None,
    }
}

#[tokio::test]
async fn bots_by_id_return_current_identities_in_request_order_without_unknown_ids() {
    let bots = Arc::new(FakeBots::default());

    let response = execute(
        &bots,
        r#"{ bots(ids: [
            "00000000-0000-0000-0000-000000000002",
            "00000000-0000-0000-0000-0000000000ff",
            "00000000-0000-0000-0000-000000000001"
        ]) { id name handle avatarUrl deletedAt isSystem } }"#,
    )
    .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data,
        value!({ "bots": [
            {
                "id": "00000000-0000-0000-0000-000000000002",
                "name": "Old Alerts",
                "handle": "old-alerts",
                "avatarUrl": null,
                "deletedAt": "2026-11-01T12:00:00+00:00",
                "isSystem": false
            },
            {
                "id": "00000000-0000-0000-0000-000000000001",
                "name": "Release Scout",
                "handle": "scout",
                "avatarUrl": "https://static.example/scout.png",
                "deletedAt": null,
                "isSystem": false
            }
        ] })
    );
}

#[tokio::test]
async fn more_than_100_bot_ids_are_refused_before_any_read() {
    let bots = Arc::new(FakeBots::default());
    let ids = (0..101u128)
        .map(|n| format!("\"{}\"", Uuid::from_u128(n)))
        .collect::<Vec<_>>()
        .join(",");

    let response = execute(&bots, &format!("{{ bots(ids: [{ids}]) {{ id }} }}")).await;

    assert_eq!(error_code(&response).as_deref(), Some("BAD_USER_INPUT"));
    assert!(bots.identity_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_malformed_bot_id_is_refused_before_any_read() {
    let bots = Arc::new(FakeBots::default());

    let response = execute(&bots, r#"{ bots(ids: ["bot|not-a-uuid"]) { id } }"#).await;

    assert!(!response.errors.is_empty());
    assert!(bots.identity_calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn mentionable_bots_pass_the_channel_membership_to_the_bots_service() {
    let bots = Arc::new(FakeBots::default());

    let in_channel = execute(
        &bots,
        r#"{ mentionableBots(channelId: "00000000-0000-0000-0000-000000000010") { id name } }"#,
    )
    .await;
    let anywhere = execute(&bots, r#"{ mentionableBots { id } }"#).await;

    assert!(in_channel.errors.is_empty(), "{:?}", in_channel.errors);
    assert_eq!(
        in_channel.data,
        value!({ "mentionableBots": [
            { "id": "00000000-0000-0000-0000-000000000001", "name": "Release Scout" }
        ] })
    );
    assert!(anywhere.errors.is_empty(), "{:?}", anywhere.errors);
    assert_eq!(
        *bots.mentionable_channels.lock().unwrap(),
        vec![Some(MEMBER_CHANNEL.to_string()), None]
    );
}

#[tokio::test]
async fn mentionable_bots_in_a_channel_the_viewer_has_not_joined_are_forbidden() {
    let bots = Arc::new(FakeBots::default());
    let other = OTHER_CHANNEL.to_string();

    let response = execute(
        &bots,
        &format!(r#"{{ mentionableBots(channelId: "{other}") {{ id }} }}"#),
    )
    .await;

    assert_eq!(error_code(&response).as_deref(), Some("FORBIDDEN"));
    assert!(bots.mentionable_channels.lock().unwrap().is_empty());
}

#[tokio::test]
async fn bot_edges_in_one_request_share_one_identity_read() {
    let bots = Arc::new(FakeBots::default());

    let response = execute(
        &bots,
        r#"{
            first: botEdge(id: "00000000-0000-0000-0000-000000000001") { name }
            second: botEdge(id: "00000000-0000-0000-0000-000000000002") { name }
            unknown: botEdge(id: "00000000-0000-0000-0000-0000000000ff") { name }
        }"#,
    )
    .await;

    assert!(response.errors.is_empty(), "{:?}", response.errors);
    assert_eq!(
        response.data,
        value!({
            "first": { "name": "Release Scout" },
            "second": { "name": "Old Alerts" },
            "unknown": null
        })
    );
    assert_eq!(bots.identity_calls.lock().unwrap().len(), 1);
}
