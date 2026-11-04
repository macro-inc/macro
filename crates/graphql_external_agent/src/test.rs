use std::sync::{Arc, Mutex};

use async_graphql::{Context, EmptySubscription, Object, Request, Schema, Variables};
use bot_id::BotId;
use bots::domain::models::{Bot, BotKind, BotOwner};
use external_agents::domain::{
    models::{
        AgentEndpoint, AgentReply, EndpointChange, EndpointVerification, ExternalAgent,
        ExternalAgentEvent, ExternalAgentEventKind, PostedReply, RegisterExternalAgent,
        RegisteredExternalAgent,
    },
    ports::{ExternalAgentApi, ExternalAgentError, ExternalAgentRegistry, Result},
};
use macro_user_id::user_id::MacroUserIdStr;
use messages::domain::models::MessageParent;
use uuid::Uuid;

use crate::{
    ExternalAgentGraphqlContext, ExternalAgentMutationRoot, GraphqlAgentPrincipal,
    GraphqlExternalAgentQuery, GraphqlExternalAgentViewer,
};

const AGENT: BotId = BotId::new_from_uuid(Uuid::from_u128(0xA6E));
const OWNER: &str = "macro|owner@example.com";

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from(OWNER.to_owned()).unwrap()
}

fn external_agent(endpoint: Option<AgentEndpoint>) -> ExternalAgent {
    ExternalAgent {
        bot: Bot {
            id: AGENT,
            kind: BotKind::Owned,
            owner: Some(BotOwner::User {
                user_id: OWNER.to_owned(),
            }),
            name: "Outside Assistant".to_owned(),
            handle: "outside".to_owned(),
            description: None,
            avatar_url: None,
            created_by: Some(OWNER.to_owned()),
            created_at: chrono::DateTime::UNIX_EPOCH,
            updated_at: chrono::DateTime::UNIX_EPOCH,
            deleted_at: None,
            has_agent: true,
        },
        endpoint,
    }
}

struct FakeRegistry;

#[async_trait::async_trait]
impl ExternalAgentRegistry for FakeRegistry {
    async fn register(
        &self,
        _: MacroUserIdStr<'static>,
        req: RegisterExternalAgent,
    ) -> Result<RegisteredExternalAgent> {
        Ok(RegisteredExternalAgent {
            agent: external_agent(req.endpoint_url.map(|url| AgentEndpoint {
                webhook_id: "wh_outside".to_owned(),
                url,
                verified: true,
            })),
            bot_token: "mbot_raw_token".to_owned(),
            signing_secret: Some("whsec_test".to_owned()),
        })
    }
    async fn list(&self, _: MacroUserIdStr<'static>) -> Result<Vec<ExternalAgent>> {
        Ok(vec![external_agent(None)])
    }
    async fn set_endpoint(
        &self,
        _: MacroUserIdStr<'static>,
        _: BotId,
        _: Option<String>,
    ) -> Result<EndpointChange> {
        Err(ExternalAgentError::NotFound)
    }
    async fn verify_endpoint(
        &self,
        _: MacroUserIdStr<'static>,
        _: BotId,
    ) -> Result<EndpointVerification> {
        Err(ExternalAgentError::NotFound)
    }
    async fn issue_token(&self, _: MacroUserIdStr<'static>, _: BotId) -> Result<String> {
        Err(ExternalAgentError::NotFound)
    }
    async fn delete(&self, _: MacroUserIdStr<'static>, _: BotId) -> Result<()> {
        Ok(())
    }
}

#[derive(Default)]
struct FakeApi {
    replies: Mutex<Vec<(BotId, AgentReply)>>,
}

#[async_trait::async_trait]
impl ExternalAgentApi for FakeApi {
    async fn events(
        &self,
        bot_id: BotId,
        after: Option<Uuid>,
        _: u16,
    ) -> Result<Vec<ExternalAgentEvent>> {
        assert_eq!(after, Some(Uuid::from_u128(1)));
        Ok(vec![ExternalAgentEvent {
            id: Uuid::from_u128(2),
            bot_id,
            kind: ExternalAgentEventKind::DirectMessage,
            parent: MessageParent::Channel(Uuid::from_u128(0xD1)),
            message_id: Uuid::from_u128(3),
            message_thread_id: None,
            reply_thread_id: None,
            sender_id: OWNER.to_owned(),
            invoking_user: owner(),
            content: "what changed today?".to_owned(),
            message_created_at: chrono::DateTime::UNIX_EPOCH,
        }])
    }
    async fn reply(&self, bot_id: BotId, reply: AgentReply) -> Result<PostedReply> {
        self.replies.lock().unwrap().push((bot_id, reply));
        Ok(PostedReply {
            message_id: Uuid::from_u128(4),
            parent: MessageParent::Channel(Uuid::from_u128(0xD1)),
            thread_id: None,
        })
    }
    async fn set_typing(&self, _: BotId, _: Uuid, _: bool) -> Result<()> {
        Ok(())
    }
}

struct TestQuery;

#[Object]
impl TestQuery {
    async fn external_agent(
        &self,
        ctx: &Context<'_>,
    ) -> async_graphql::Result<GraphqlExternalAgentViewer> {
        GraphqlExternalAgentViewer::resolve(ctx)
    }

    async fn user(&self) -> GraphqlExternalAgentQuery {
        GraphqlExternalAgentQuery::new(owner())
    }
}

fn schema(api: Arc<FakeApi>) -> Schema<TestQuery, ExternalAgentMutationRoot, EmptySubscription> {
    Schema::build(TestQuery, ExternalAgentMutationRoot, EmptySubscription)
        .data(ExternalAgentGraphqlContext::new(Arc::new(FakeRegistry), api))
        .finish()
}

fn as_agent(query: &str) -> Request {
    Request::new(query).data(GraphqlAgentPrincipal(AGENT))
}

fn as_owner(query: &str) -> Request {
    Request::new(query).data(owner())
}

fn error_code(response: &async_graphql::Response) -> Option<String> {
    response.errors.first().and_then(|error| {
        error
            .extensions
            .as_ref()
            .and_then(|extensions| extensions.get("code"))
            .map(|code| code.to_string())
    })
}

#[tokio::test]
async fn an_agent_reads_its_inbox_and_answers_an_event() {
    let api = Arc::new(FakeApi::default());
    let schema = schema(api.clone());

    let read = schema
        .execute(as_agent(
            r#"{ externalAgent { id events(after: "00000000-0000-0000-0000-000000000001") {
                id kind conversationType conversationId messageId threadId senderId text
            } } }"#,
        ))
        .await;
    assert!(read.errors.is_empty(), "{:?}", read.errors);
    assert_eq!(
        read.data.into_json().unwrap(),
        serde_json::json!({ "externalAgent": {
            "id": AGENT.to_string(),
            "events": [{
                "id": "00000000-0000-0000-0000-000000000002",
                "kind": "DIRECT_MESSAGE",
                "conversationType": "channel",
                "conversationId": "00000000-0000-0000-0000-0000000000d1",
                "messageId": "00000000-0000-0000-0000-000000000003",
                "threadId": null,
                "senderId": OWNER,
                "text": "what changed today?",
            }],
        }}),
    );

    let replied = schema
        .execute(
            as_agent(
                r#"mutation($input: ReplyToExternalAgentEventInput!) {
                    replyToExternalAgentEvent(input: $input) { messageId conversationId threadId }
                }"#,
            )
            .variables(Variables::from_json(serde_json::json!({ "input": {
                "eventId": "00000000-0000-0000-0000-000000000002",
                "text": "Nothing yet.",
            }}))),
        )
        .await;
    assert!(replied.errors.is_empty(), "{:?}", replied.errors);
    let replies = api.replies.lock().unwrap();
    assert_eq!(replies.len(), 1);
    assert_eq!(replies[0].0, AGENT);
    assert_eq!(replies[0].1.event_id, Uuid::from_u128(2));
    assert_eq!(replies[0].1.content, "Nothing yet.");
}

#[tokio::test]
async fn a_user_cannot_act_as_an_agent() {
    let api = Arc::new(FakeApi::default());
    let schema = schema(api.clone());

    let read = schema.execute(as_owner("{ externalAgent { id } }")).await;
    let replied = schema
        .execute(as_owner(
            r#"mutation { replyToExternalAgentEvent(input: {
                eventId: "00000000-0000-0000-0000-000000000002", text: "hi"
            }) { messageId } }"#,
        ))
        .await;

    assert_eq!(error_code(&read).as_deref(), Some("\"UNAUTHENTICATED\""));
    assert_eq!(error_code(&replied).as_deref(), Some("\"UNAUTHENTICATED\""));
    assert!(api.replies.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_agent_cannot_manage_external_agents() {
    let schema = schema(Arc::new(FakeApi::default()));

    let registered = schema
        .execute(as_agent(
            r#"mutation { registerExternalAgent(input: { name: "Twin", handle: "twin" }) {
                botToken
            } }"#,
        ))
        .await;

    assert!(!registered.errors.is_empty());
    assert!(registered.data.into_json().unwrap().is_null());
}

#[tokio::test]
async fn registering_hands_over_the_token_and_signing_secret() {
    let schema = schema(Arc::new(FakeApi::default()));

    let registered = schema
        .execute(as_owner(
            r#"mutation { registerExternalAgent(input: {
                name: "Outside Assistant", handle: "outside",
                endpointUrl: "https://agent.example.com/macro"
            }) {
                botToken signingSecret
                agent { id name handle endpoint { url verified } }
            } }"#,
        ))
        .await;

    assert!(registered.errors.is_empty(), "{:?}", registered.errors);
    assert_eq!(
        registered.data.into_json().unwrap(),
        serde_json::json!({ "registerExternalAgent": {
            "botToken": "mbot_raw_token",
            "signingSecret": "whsec_test",
            "agent": {
                "id": AGENT.to_string(),
                "name": "Outside Assistant",
                "handle": "outside",
                "endpoint": { "url": "https://agent.example.com/macro", "verified": true },
            },
        }}),
    );
}
