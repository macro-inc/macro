use std::collections::HashMap;

use axum::body::Body;
use axum::http::{Request, header};
use bot_id::BotId;
use channel_sender::ChannelSender;
use entity_access::domain::models::{
    AccessLevel, BotAccessScope, CallChannelInfo, Entity, EntityPermission, EntityType,
    RequiredPermission, TeamRole, UserTeamInfo,
};
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, InternalAuthConfig, JwtValidator, MacroAuthorizationError,
    MacroAuthorizationServiceImpl, NoBotAuthorizer, NoUserApiKeyAuthorizer, ValidatedIdentity,
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use rootcause::Report;
use tower::ServiceExt;

use super::*;
use crate::domain::ports::SessionFacts;
use crate::test_support::{FLAG_OFF, FakeMessages, FakeSessions, RATER, World, message, user};

const INTERNAL_KEY: &str = "test-internal-key";
const STRANGER: &str = "macro|stranger@example.com";
const SESSION: Uuid = Uuid::from_u128(0x5E55);
const CHANNEL: Uuid = Uuid::from_u128(0xC4A7);
const BOT_MESSAGE: Uuid = Uuid::from_u128(0xB0B0);

/// A bearer token is the user id it stands for.
#[derive(Clone)]
struct BearerIsUser;

impl JwtValidator for BearerIsUser {
    fn validate_credential(
        &self,
        jwt: &str,
    ) -> Result<macro_authorization::ValidatedCredential, Report<MacroAuthorizationError>> {
        Ok(macro_authorization::ValidatedCredential {
            origin: macro_authorization::CredentialOrigin::Session,
            identity: ValidatedIdentity {
                agent_id: None,
                agent_via: None,
                routine_id: None,
                user_id: jwt.to_string(),
                fusion_user_id: "fusion-user".to_string(),
                organization_id: None,
                permissions: None,
            },
        })
    }
}

/// View grants by (user, entity id); nothing else is granted.
#[derive(Clone, Default)]
struct Grants(Arc<HashMap<(String, String), AccessLevel>>);

impl Grants {
    fn permission(
        &self,
        user: Option<&str>,
        entity_id: &str,
    ) -> Result<EntityPermission, AccessError> {
        let user = user.ok_or(AccessError::Unauthorized)?;
        self.0
            .get(&(user.to_owned(), entity_id.to_owned()))
            .map(|access_level| EntityPermission::AccessLevel {
                access_level: *access_level,
            })
            .ok_or(AccessError::Unauthorized)
    }
}

impl EntityAccessService for Grants {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        let permission = self.permission(Some(user_id.as_ref()), entity_id)?;
        EntityAccessReceipt::try_new_authenticated_user(
            user(user_id.as_ref()),
            Entity {
                entity_id: entity_id.to_owned(),
                entity_type,
            },
            permission,
        )
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        _bot_id: BotId,
        _scope: BotAccessScope,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        Err(AccessError::Unauthorized)
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        Err(AccessError::internal("not used"))
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::internal("not used"))
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        Err(AccessError::internal("not used"))
    }

    async fn get_entity_permission(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        entity_id: &str,
        _entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        self.permission(user_id.map(|user| user.as_ref()), entity_id)
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<(EntityPermission, Uuid, TeamRole), AccessError> {
        Err(AccessError::internal("not used"))
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        Err(AccessError::internal("not used"))
    }

    async fn get_call_channel(
        &self,
        _call_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::internal("not used"))
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        Err(AccessError::internal("not used"))
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        Err(AccessError::internal("not used"))
    }
}

/// RATER and FLAG_OFF can view the session and the channel; STRANGER can't.
fn app() -> (Router, crate::test_support::FakeRepo) {
    let mut world = World::default();
    world.sessions = FakeSessions(HashMap::from([(
        SESSION,
        SessionFacts {
            bot_id: bot_id::MACRO_NEW_BOT_ID,
            harness: "macro".to_owned(),
            model: "claude-opus-5-5".to_owned(),
        },
    )]));
    world.messages = FakeMessages(HashMap::from([(
        BOT_MESSAGE,
        message(
            BOT_MESSAGE,
            MessageParent::Channel(CHANNEL),
            ChannelSender::new_from_bot(BotId::TEST_A),
            "Done.",
        ),
    )]));
    let (service, repo) = world.service();

    let mut grants = HashMap::new();
    for viewer in [RATER, FLAG_OFF] {
        for entity in [SESSION, CHANNEL] {
            grants.insert((viewer.to_owned(), entity.to_string()), AccessLevel::View);
        }
    }
    let authorization = MacroAuthorizationServiceImpl::new(
        BearerIsUser,
        InternalAuthConfig {
            api_key: INTERNAL_KEY.to_string(),
            default_user_id: None,
        },
        NoBotAuthorizer,
        NoUserApiKeyAuthorizer,
    );
    let router = agent_feedback_router(AgentFeedbackRouterState::new(
        Arc::new(service),
        Arc::new(Grants(Arc::new(grants))),
        MacroAuthorizationState::new(Arc::new(authorization)),
    ));
    (router, repo)
}

fn request(
    method: &str,
    uri: &str,
    user_id: &str,
    body: Option<serde_json::Value>,
) -> Request<Body> {
    let builder = Request::builder()
        .method(method)
        .uri(uri)
        .header(header::AUTHORIZATION, format!("Bearer {user_id}"))
        .header(header::CONTENT_TYPE, "application/json");
    let body = body.map_or_else(Body::empty, |body| Body::from(body.to_string()));
    builder.body(body).unwrap()
}

fn rating(id: u128, rating: &str) -> serde_json::Value {
    serde_json::json!({
        "id": Uuid::from_u128(id),
        "rating": rating,
        "note": "a note",
        "surface": "agents_view",
    })
}

async fn json(response: Response) -> serde_json::Value {
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    serde_json::from_slice(&bytes).unwrap()
}

fn turn_uri(turn: u32) -> String {
    format!("/agent-feedback/agent-sessions/{SESSION}/turns/{turn}")
}

#[tokio::test]
async fn flag_off_answers_404_and_writes_nothing() {
    let (app, repo) = app();

    let rated = app
        .clone()
        .oneshot(request(
            "PUT",
            &turn_uri(0),
            FLAG_OFF,
            Some(rating(1, "up")),
        ))
        .await
        .unwrap();
    let mine = app
        .oneshot(request(
            "GET",
            &format!("/agent-feedback/agent-sessions/{SESSION}/mine"),
            FLAG_OFF,
            None,
        ))
        .await
        .unwrap();

    assert_eq!(rated.status(), StatusCode::NOT_FOUND);
    assert_eq!(mine.status(), StatusCode::NOT_FOUND);
    assert!(repo.rows().is_empty());
}

#[tokio::test]
async fn without_view_access_nothing_is_rated_or_listed() {
    let (app, repo) = app();

    let turn = app
        .clone()
        .oneshot(request(
            "PUT",
            &turn_uri(0),
            STRANGER,
            Some(rating(1, "up")),
        ))
        .await
        .unwrap();
    let message = app
        .clone()
        .oneshot(request(
            "PUT",
            &format!("/agent-feedback/messages/channel/{CHANNEL}/items/{BOT_MESSAGE}"),
            STRANGER,
            Some(rating(2, "up")),
        ))
        .await
        .unwrap();
    let mine = app
        .oneshot(request(
            "GET",
            &format!("/agent-feedback/messages/channel/{CHANNEL}/mine"),
            STRANGER,
            None,
        ))
        .await
        .unwrap();

    // The session extractor refuses as the session read routes do.
    assert_eq!(turn.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(message.status(), StatusCode::FORBIDDEN);
    assert_eq!(mine.status(), StatusCode::FORBIDDEN);
    assert!(repo.rows().is_empty());
}

#[tokio::test]
async fn rate_change_list_and_retract_a_turn() {
    let (app, repo) = app();

    let rated = app
        .clone()
        .oneshot(request("PUT", &turn_uri(2), RATER, Some(rating(1, "up"))))
        .await
        .unwrap();
    assert_eq!(rated.status(), StatusCode::OK);
    let rated = json(rated).await;
    assert_eq!(rated["rating"], "up");
    assert_eq!(rated["note"], "a note");
    assert!(rated["updatedAt"].is_string());

    let changed = app
        .clone()
        .oneshot(request("PUT", &turn_uri(2), RATER, Some(rating(2, "down"))))
        .await
        .unwrap();
    assert_eq!(json(changed).await["rating"], "down");

    let mine = app
        .clone()
        .oneshot(request(
            "GET",
            &format!("/agent-feedback/agent-sessions/{SESSION}/mine"),
            RATER,
            None,
        ))
        .await
        .unwrap();
    let mine = json(mine).await;
    assert_eq!(mine["items"].as_array().map(Vec::len), Some(1));
    assert_eq!(mine["items"][0]["turn"], 2);
    assert_eq!(mine["items"][0]["subjectId"], SESSION.to_string());
    assert_eq!(mine["items"][0]["rating"], "down");

    let retracted = app
        .clone()
        .oneshot(request(
            "DELETE",
            &format!(
                "{}?id={}&surface=agent_block",
                turn_uri(2),
                Uuid::from_u128(3)
            ),
            RATER,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(retracted.status(), StatusCode::NO_CONTENT);

    let mine = app
        .oneshot(request(
            "GET",
            &format!("/agent-feedback/agent-sessions/{SESSION}/mine"),
            RATER,
            None,
        ))
        .await
        .unwrap();
    assert_eq!(json(mine).await["items"], serde_json::json!([]));
    assert_eq!(repo.rows().len(), 3);
}

#[tokio::test]
async fn rate_an_agents_message_in_a_channel() {
    let (app, repo) = app();

    let rated = app
        .oneshot(request(
            "PUT",
            &format!("/agent-feedback/messages/channel/{CHANNEL}/items/{BOT_MESSAGE}"),
            RATER,
            Some(rating(1, "up")),
        ))
        .await
        .unwrap();

    assert_eq!(rated.status(), StatusCode::OK);
    assert_eq!(
        repo.rows()[0].event.message_parent_type.as_deref(),
        Some("channel")
    );
}

#[tokio::test]
async fn a_missing_rating_or_long_note_is_400_and_a_reused_id_409() {
    let (app, repo) = app();

    let no_rating = app
        .clone()
        .oneshot(request(
            "PUT",
            &turn_uri(0),
            RATER,
            Some(serde_json::json!({"id": Uuid::from_u128(1), "surface": "agents_view"})),
        ))
        .await
        .unwrap();
    let long_note = app
        .clone()
        .oneshot(request(
            "PUT",
            &turn_uri(0),
            RATER,
            Some(serde_json::json!({
                "id": Uuid::from_u128(2),
                "rating": "down",
                "note": "x".repeat(4001),
                "surface": "agents_view",
            })),
        ))
        .await
        .unwrap();
    app.clone()
        .oneshot(request("PUT", &turn_uri(0), RATER, Some(rating(3, "up"))))
        .await
        .unwrap();
    let reused = app
        .oneshot(request("PUT", &turn_uri(1), RATER, Some(rating(3, "up"))))
        .await
        .unwrap();

    assert_eq!(no_rating.status(), StatusCode::BAD_REQUEST);
    assert_eq!(long_note.status(), StatusCode::BAD_REQUEST);
    assert_eq!(reused.status(), StatusCode::CONFLICT);
    assert_eq!(json(reused).await["code"], "id_taken");
    assert_eq!(repo.rows().len(), 1);
}

#[tokio::test]
async fn the_export_takes_the_internal_key_and_refuses_a_person() {
    let (app, _) = app();
    app.clone()
        .oneshot(request("PUT", &turn_uri(0), RATER, Some(rating(1, "up"))))
        .await
        .unwrap();

    let as_person = app
        .clone()
        .oneshot(request(
            "GET",
            "/internal/agent-feedback/events",
            RATER,
            None,
        ))
        .await
        .unwrap();
    let as_service = app
        .oneshot(
            Request::get("/internal/agent-feedback/events?limit=10")
                .header(INTERNAL_API_KEY_HEADER, INTERNAL_KEY)
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert!(as_person.status().is_client_error());
    assert_eq!(as_service.status(), StatusCode::OK);
    let page = json(as_service).await;
    assert_eq!(page["items"].as_array().map(Vec::len), Some(1));
    assert_eq!(page["items"][0]["userId"], RATER);
    assert_eq!(page["items"][0]["model"], "claude-opus-5-5");
    assert_eq!(page["next"], serde_json::Value::Null);
}
