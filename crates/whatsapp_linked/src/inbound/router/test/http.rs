//! Every route's credential rules, over HTTP, against the real router,
//! repository and entity access.

use super::*;
use crate::domain::{
    events::{InboundEvent, InboundKind, Message, MessageKind, PairingUpdate},
    provider::WhatsAppProvider,
    session::SessionService,
};
use crate::outbound::pg::PgWhatsAppRepository;
use async_trait::async_trait;
use axum::body::Body;
use axum::http::{Method, Request, header};
use entity_access::{
    domain::{models::EntityType, service::EntityAccessServiceImpl},
    outbound::PgAccessRepository,
};
use external_chat::{
    domain::{
        models::*,
        ports::{ExternalChatResult, SendRateLimiter},
        service::ExternalChatService,
    },
    inbound::router::{ExternalChatRouterState, external_chats_router},
    outbound::pg::PgExternalChatRepository,
};
use macro_authorization::{
    BotActingUserClaims, BotAuthentication, BotScope, CredentialOrigin, HarnessAuthentication,
    HarnessAuthorizationOwner, InternalIdentityClaims, MacroAuthorizationError,
    MacroUserAuthentication, ValidatedCredential, ValidatedIdentity,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_user::UserContext;
use rootcause::Report;
use sqlx::PgPool;
use tower::ServiceExt;

const GROUP: &str = "120363000000000001@g.us";
/// A test user's id, typed.
fn person(user: &str) -> macro_user_id::user_id::MacroUserIdStr<'static> {
    user.to_owned().try_into().expect("test user ids are valid")
}

const ALICE: &str = "macro|alice@example.com";
const BOB: &str = "macro|bob@example.com";
const ALICE_JID: &str = "15550000001@s.whatsapp.net";
const CUSTOMER_JID: &str = "15558880001@s.whatsapp.net";

/// Bearer tokens and keys the fake authorizer knows. Every one acts for Alice,
/// the chat's owner, except Bob's session.
const ALICE_SESSION: &str = "alice-session";
const BOB_SESSION: &str = "bob-session";
const ALICE_API_JWT: &str = "alice-api-jwt";
const ALICE_API_KEY: &str = "alice-api-key";
const BOT_TOKEN: &str = "bot-token";
const HARNESS_TOKEN: &str = "harness-token";

fn context(user: &str) -> UserContext {
    UserContext {
        user_id: user.to_owned(),
        fusion_user_id: "fusion-user-id".to_owned(),
        organization_id: None,
        permissions: None,
    }
}

fn acting(user: &str, origin: CredentialOrigin) -> MacroUserAuthentication {
    MacroUserAuthentication {
        origin,
        agent_id: None,
        macro_user_id: user.to_owned().try_into().unwrap(),
        user_context: context(user),
    }
}

#[derive(Clone)]
struct Credentials;

impl MacroAuthorizationService for Credentials {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        self.authorize_identity(jwt)
            .await
            .map(|credential| UserContext {
                user_id: credential.identity.user_id,
                fusion_user_id: credential.identity.fusion_user_id,
                organization_id: credential.identity.organization_id,
                permissions: credential.identity.permissions,
            })
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        let (user, origin) = match jwt {
            ALICE_SESSION => (ALICE, CredentialOrigin::Session),
            BOB_SESSION => (BOB, CredentialOrigin::Session),
            ALICE_API_JWT => (ALICE, CredentialOrigin::MacroApiJwt),
            _ => return Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        };
        Ok(ValidatedCredential {
            identity: ValidatedIdentity {
                agent_id: None,
                user_id: user.to_owned(),
                fusion_user_id: "fusion-user-id".to_owned(),
                organization_id: None,
                permissions: None,
            },
            origin,
        })
    }

    async fn authorize_user_api_key(
        &self,
        api_key: &str,
    ) -> Result<UserContext, Report<MacroAuthorizationError>> {
        match api_key {
            ALICE_API_KEY => Ok(context(ALICE)),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_bot(
        &self,
        token: &str,
        bot_scope: BotScope,
        _claims: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        if token != BOT_TOKEN {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(BotAuthentication {
            bot_id: serde_json::from_value(serde_json::json!(Uuid::from_u128(1))).unwrap(),
            token_id: Uuid::from_u128(2),
            bot_scope,
            team_id: None,
            acting_user: Some(acting(ALICE, CredentialOrigin::Bot)),
        })
    }

    async fn authorize_harness(
        &self,
        token: &str,
        _claim: Option<String>,
    ) -> Result<HarnessAuthentication, Report<MacroAuthorizationError>> {
        if token != HARNESS_TOKEN {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(HarnessAuthentication {
            harness_id: harness_id::HarnessId::new_from_uuid(Uuid::from_u128(3)),
            token_id: Uuid::from_u128(4),
            owner: HarnessAuthorizationOwner::User {
                user_id: ALICE.to_owned(),
            },
            acting_user: acting(ALICE, CredentialOrigin::Harness),
        })
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

struct Unlimited;

#[async_trait]
impl SendRateLimiter for Unlimited {
    async fn check(
        &self,
        _: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> ExternalChatResult<()> {
        Ok(())
    }
}

async fn user(pool: &PgPool, id: &str) {
    let email = id.trim_start_matches("macro|");
    let macro_user = Uuid::now_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $2)",
        macro_user,
        id,
        email
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        id,
        email,
        macro_user
    )
    .execute(pool)
    .await
    .unwrap();
}

#[derive(Clone, Copy, Debug)]
enum Principal {
    Session,
    ApiJwt,
    ApiKey,
    Bot,
    Harness,
}

fn request(principal: Principal, method: Method, path: &str, body: Body) -> Request<Body> {
    let builder = Request::builder()
        .method(method)
        .uri(path)
        .header(header::CONTENT_TYPE, "application/json");
    let builder = match principal {
        Principal::Session => {
            builder.header(header::AUTHORIZATION, format!("Bearer {ALICE_SESSION}"))
        }
        Principal::ApiJwt => {
            builder.header(header::AUTHORIZATION, format!("Bearer {ALICE_API_JWT}"))
        }
        Principal::ApiKey => {
            builder.header(macro_authorization::USER_API_KEY_HEADER, ALICE_API_KEY)
        }
        Principal::Bot => builder
            .header(macro_authorization::BOT_TOKEN_HEADER, BOT_TOKEN)
            .header(macro_authorization::BOT_SCOPE_HEADER, "user"),
        Principal::Harness => {
            builder.header(macro_authorization::HARNESS_TOKEN_HEADER, HARNESS_TOKEN)
        }
    };
    builder.body(body).unwrap()
}

fn upload_body() -> (String, Body) {
    let boundary = "whatsapp-boundary";
    let body = format!(
        "--{boundary}\r\nContent-Disposition: form-data; name=\"file\"; filename=\"note.txt\"\r\nContent-Type: text/plain\r\n\r\nhello\r\n--{boundary}--\r\n"
    );
    (
        format!("multipart/form-data; boundary={boundary}"),
        Body::from(body),
    )
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn every_route_enforces_its_credential_rules(pool: PgPool) {
    for id in [ALICE, BOB] {
        user(&pool, id).await;
    }
    let repository = Arc::new(PgWhatsAppRepository::new(pool.clone()));
    let service = Arc::new(WhatsAppService::new(repository.clone()));
    let chats = Arc::new(ExternalChatService::new(
        Arc::new(WhatsAppProvider::new(repository.clone())),
        Arc::new(PgExternalChatRepository::new(pool.clone())),
        Arc::new(Unlimited),
    ));
    let session = SessionService::new(repository);
    let pairing = service
        .connect(&person(ALICE), false, SendAuthority::Human)
        .await
        .unwrap();
    let lease = session.begin_lease(pairing.account_id).await.unwrap();
    session
        .update_pairing(
            lease.scope,
            pairing.id,
            PairingUpdate::Success {
                identity_jid: ALICE_JID.to_owned(),
            },
        )
        .await
        .unwrap();
    let participant = |jid: &str| Participant {
        identity: Identity {
            jid: jid.to_owned(),
            alternate_jid: None,
            display_name: None,
        },
        admin: false,
    };
    session
        .update_groups(
            lease.scope,
            &[GroupInfo {
                jid: GROUP.into(),
                name: "Customer escalations".into(),
                participants: vec![participant(ALICE_JID), participant(CUSTOMER_JID)],
                announce: false,
                disappearing_seconds: None,
                community_parent: false,
                community_jid: None,
                community_announcements: false,
                observed_at: chrono::Utc::now(),
            }],
            true,
        )
        .await
        .unwrap();
    let binding = chats
        .add(
            &person(ALICE),
            &AddChat {
                provider: ExternalChatProvider::WhatsApp,
                remote_id: GROUP.into(),
                kind: ExternalChatKind::Group,
            },
            SendAuthority::Human,
        )
        .await
        .unwrap();
    let mut tx = pool.begin().await.unwrap();
    entity_access_db_utils::direct_share::set(
        &mut tx,
        &binding.id,
        EntityType::ExternalChat,
        &BOB.to_owned().try_into().unwrap(),
        Some(models_permissions::share_permission::access_level::AccessLevel::View),
        false,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();
    session
        .ingest_event(
            lease.scope,
            &InboundEvent {
                event_id: Uuid::from_u128(10),
                group_jid: GROUP.into(),
                chat_alternate_jid: None,
                source_at: chrono::Utc::now(),
                observed_at: chrono::Utc::now(),
                kind: InboundKind::Message(Message {
                    source_id: "FIRST".into(),
                    sender: Identity {
                        jid: CUSTOMER_JID.into(),
                        alternate_jid: None,
                        display_name: Some("Customer".into()),
                    },
                    kind: MessageKind::Text,
                    text: "hello".into(),
                    history: false,
                    from_me: false,
                    revision: 0,
                    target: None,
                    media: vec![],
                    mentions: vec![],
                    forwarded: false,
                    view_once: false,
                    rich: None,
                }),
            },
        )
        .await
        .unwrap();

    let authorization_state = MacroAuthorizationState::new(Arc::new(Credentials));
    let app: Router = Router::new()
        .nest(
            "/external-chats",
            external_chats_router(ExternalChatRouterState {
                service: chats,
                entity_access_service: Arc::new(EntityAccessServiceImpl::new(
                    PgAccessRepository::new(pool.clone()),
                )),
                authorization_state: authorization_state.clone(),
            }),
        )
        .nest(
            "/whatsapp",
            whatsapp_router(WhatsAppRouterState {
                service: service.clone(),
                authorization_state,
            }),
        );
    let group = binding.id;
    let generation = service
        .account(&person(ALICE))
        .await
        .unwrap()
        .unwrap()
        .authorization_generation;

    // A viewer reads one message; its route sits next to POST
    // /messages/attachments without conflicting.
    let viewer = |path: String| {
        Request::get(path)
            .header(header::AUTHORIZATION, format!("Bearer {BOB_SESSION}"))
            .body(Body::empty())
            .unwrap()
    };
    let page = app
        .clone()
        .oneshot(viewer(format!("/external-chats/{group}/messages")))
        .await
        .unwrap();
    assert_eq!(page.status(), StatusCode::OK);
    let page: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(page.into_body(), 1 << 20)
            .await
            .unwrap(),
    )
    .unwrap();
    let message = page["messages"][0]["id"].as_str().unwrap().to_owned();
    let one = app
        .clone()
        .oneshot(viewer(format!(
            "/external-chats/{group}/messages/{message}"
        )))
        .await
        .unwrap();
    assert_eq!(one.status(), StatusCode::OK);
    let one: serde_json::Value = serde_json::from_slice(
        &axum::body::to_bytes(one.into_body(), 1 << 20)
            .await
            .unwrap(),
    )
    .unwrap();
    assert_eq!(
        (one["id"].as_str(), one["body"].as_str()),
        (Some(message.as_str()), Some("hello"))
    );

    let reply = || {
        Body::from(
            serde_json::json!({
                "idempotencyKey": Uuid::now_v7(),
                "message": { "type": "text", "text": "On it", "mentions": [] }
            })
            .to_string(),
        )
    };
    use Principal::*;
    use StatusCode as S;
    // (principal, method, path, body, expected). Detach and disconnect change
    // state, so the owner's session runs them last.
    let sends = format!("/external-chats/{group}/sends");
    let attachments = format!("/external-chats/{group}/attachments");
    let pairing_path = format!("/whatsapp/pairing/{}", pairing.id);
    let permissions = format!("/external-chats/{group}/permissions");
    let detach = format!("/external-chats/{group}");
    let mut outcomes = vec![];
    for (principal, method, path, expected) in [
        (Session, Method::POST, sends.as_str(), S::OK),
        (ApiJwt, Method::POST, &sends, S::OK),
        (ApiKey, Method::POST, &sends, S::OK),
        (Bot, Method::POST, &sends, S::FORBIDDEN),
        (Harness, Method::POST, &sends, S::FORBIDDEN),
        (Session, Method::POST, &attachments, S::OK),
        (ApiJwt, Method::POST, &attachments, S::OK),
        (ApiKey, Method::POST, &attachments, S::OK),
        (Bot, Method::POST, &attachments, S::FORBIDDEN),
        (Harness, Method::POST, &attachments, S::FORBIDDEN),
        // Already connected: the session reaches the domain, which refuses a
        // second pairing without `replace`.
        (Session, Method::POST, "/whatsapp/connect", S::CONFLICT),
        (ApiJwt, Method::POST, "/whatsapp/connect", S::FORBIDDEN),
        (ApiKey, Method::POST, "/whatsapp/connect", S::FORBIDDEN),
        (Bot, Method::POST, "/whatsapp/connect", S::FORBIDDEN),
        (Harness, Method::POST, "/whatsapp/connect", S::FORBIDDEN),
        (Session, Method::GET, &pairing_path, S::OK),
        (ApiJwt, Method::GET, &pairing_path, S::FORBIDDEN),
        (ApiKey, Method::GET, &pairing_path, S::FORBIDDEN),
        (Bot, Method::GET, &pairing_path, S::FORBIDDEN),
        (Harness, Method::GET, &pairing_path, S::FORBIDDEN),
        (Session, Method::POST, "/external-chats", S::OK),
        (ApiJwt, Method::POST, "/external-chats", S::FORBIDDEN),
        (ApiKey, Method::POST, "/external-chats", S::FORBIDDEN),
        (Bot, Method::POST, "/external-chats", S::FORBIDDEN),
        (Harness, Method::POST, "/external-chats", S::FORBIDDEN),
        (Session, Method::PATCH, &permissions, S::NO_CONTENT),
        (ApiJwt, Method::PATCH, &permissions, S::FORBIDDEN),
        (ApiKey, Method::PATCH, &permissions, S::FORBIDDEN),
        (Bot, Method::PATCH, &permissions, S::FORBIDDEN),
        (Harness, Method::PATCH, &permissions, S::FORBIDDEN),
        (ApiJwt, Method::DELETE, &detach, S::FORBIDDEN),
        (ApiKey, Method::DELETE, &detach, S::FORBIDDEN),
        (Bot, Method::DELETE, &detach, S::FORBIDDEN),
        (Harness, Method::DELETE, &detach, S::FORBIDDEN),
        (Session, Method::DELETE, &detach, S::NO_CONTENT),
        (ApiJwt, Method::POST, "/whatsapp/disconnect", S::FORBIDDEN),
        (ApiKey, Method::POST, "/whatsapp/disconnect", S::FORBIDDEN),
        (Bot, Method::POST, "/whatsapp/disconnect", S::FORBIDDEN),
        (Harness, Method::POST, "/whatsapp/disconnect", S::FORBIDDEN),
        (Session, Method::POST, "/whatsapp/disconnect", S::OK),
    ] {
        let (content_type, body) = match path {
            path if path == sends => ("application/json".to_owned(), reply()),
            path if path == attachments => upload_body(),
            "/whatsapp/connect" => (
                "application/json".to_owned(),
                Body::from(r#"{"replace":false}"#),
            ),
            "/external-chats" => (
                "application/json".to_owned(),
                Body::from(
                    serde_json::json!({ "provider": "whatsapp", "remoteId": GROUP, "kind": "group" })
                        .to_string(),
                ),
            ),
            path if path == permissions => ("application/json".to_owned(), Body::from("{}")),
            "/whatsapp/disconnect" => (
                "application/json".to_owned(),
                Body::from(
                    serde_json::json!({ "authorizationGeneration": generation }).to_string(),
                ),
            ),
            _ => ("application/json".to_owned(), Body::empty()),
        };
        let mut request = request(principal, method.clone(), path, body);
        request
            .headers_mut()
            .insert(header::CONTENT_TYPE, content_type.parse().unwrap());
        let status = app.clone().oneshot(request).await.unwrap().status();
        outcomes.push((principal, method, path.to_owned(), status, expected));
    }
    let mismatches: Vec<_> = outcomes
        .iter()
        .filter(|(_, _, _, status, expected)| status != expected)
        .collect();
    assert!(mismatches.is_empty(), "{mismatches:#?}");
}
