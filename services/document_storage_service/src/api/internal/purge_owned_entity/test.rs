use std::{
    sync::{Arc, Mutex},
    time::{SystemTime, UNIX_EPOCH},
};

use axum::{
    Router,
    body::Body,
    extract::FromRef,
    http::{Request, StatusCode, header::AUTHORIZATION},
    routing::delete,
};
use bot_id::BotId;
use entity_registry::{OwnedPurgeOutcome, Owner, PurgeOwnedEntity};
use jsonwebtoken::{Algorithm, EncodingKey, Header};
use macro_auth::middleware::decode_jwt::{JwtValidationArgs, MacroAccessToken};
use macro_authorization::{
    InternalAuthConfig, MacroAuthJwtValidator, MacroAuthorizationServiceImpl,
    MacroAuthorizationState, NoBotAuthorizer, NoUserApiKeyAuthorizer,
};
use rootcause::Report;
use tower::ServiceExt;
use uuid::Uuid;

use super::{OwnedPurgeState, ROUTE, handler};
use crate::api::context::AuthorizationService;

const INTERNAL_KEY: &str = "test-internal-key";
/// The header `document_storage_service_client` sends its key in.
const DSS_CLIENT_KEY_HEADER: &str = "x-document-storage-service-auth-key";
const ENTITY: Uuid = Uuid::from_u128(0xE1);
const TEAM: Uuid = Uuid::from_u128(0x7EA);
const BOT: Uuid = Uuid::from_u128(0xB07);

/// An owning service that records each purge and answers the same way.
struct FakePurger {
    answer: Option<OwnedPurgeOutcome>,
    calls: Mutex<Vec<(Uuid, Owner)>>,
}

impl FakePurger {
    fn answering(answer: OwnedPurgeOutcome) -> Arc<Self> {
        Arc::new(Self {
            answer: Some(answer),
            calls: Mutex::default(),
        })
    }

    fn failing() -> Arc<Self> {
        Arc::new(Self {
            answer: None,
            calls: Mutex::default(),
        })
    }

    fn calls(&self) -> Vec<(Uuid, Owner)> {
        self.calls.lock().unwrap().clone()
    }
}

impl PurgeOwnedEntity for FakePurger {
    async fn purge_owned(
        &self,
        entity_id: Uuid,
        expected_owner: &Owner,
    ) -> Result<OwnedPurgeOutcome, Report> {
        self.calls
            .lock()
            .unwrap()
            .push((entity_id, expected_owner.clone()));
        self.answer
            .ok_or_else(|| rootcause::report!("injected purge failure"))
    }
}

struct Services {
    documents: Arc<FakePurger>,
    chats: Arc<FakePurger>,
    projects: Arc<FakePurger>,
}

impl Services {
    fn all_answering(answer: OwnedPurgeOutcome) -> Self {
        Self {
            documents: FakePurger::answering(answer),
            chats: FakePurger::answering(answer),
            projects: FakePurger::answering(answer),
        }
    }

    fn calls(&self) -> [Vec<(Uuid, Owner)>; 3] {
        [
            self.documents.calls(),
            self.chats.calls(),
            self.projects.calls(),
        ]
    }

    async fn send(&self, request: Request<Body>) -> StatusCode {
        let state = TestState {
            purge: OwnedPurgeState::new(
                self.documents.clone(),
                self.chats.clone(),
                self.projects.clone(),
            ),
            authorization: MacroAuthorizationState::new(Arc::new(
                MacroAuthorizationServiceImpl::new(
                    MacroAuthJwtValidator::new(JwtValidationArgs::new_testing()),
                    InternalAuthConfig {
                        api_key: INTERNAL_KEY.into(),
                        default_user_id: None,
                    },
                    NoBotAuthorizer,
                    NoUserApiKeyAuthorizer,
                ),
            )),
        };
        Router::new()
            .route(ROUTE, delete(handler::<FakePurger, FakePurger, FakePurger>))
            .with_state(state)
            .oneshot(request)
            .await
            .unwrap()
            .status()
    }
}

#[derive(Clone, FromRef)]
struct TestState {
    purge: OwnedPurgeState<FakePurger, FakePurger, FakePurger>,
    authorization: MacroAuthorizationState<AuthorizationService>,
}

fn team_owner() -> Owner {
    Owner::Team(TEAM)
}

fn purge(uri: &str) -> Request<Body> {
    Request::delete(uri)
        .header(DSS_CLIENT_KEY_HEADER, INTERNAL_KEY)
        .body(Body::empty())
        .unwrap()
}

fn user_access_token() -> String {
    let expires_in_an_hour = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as usize
        + 3_600;
    let claims = MacroAccessToken {
        aud: String::new(),
        exp: expires_in_an_hour,
        tid: "test-tenant".into(),
        iss: String::new(),
        email: "member@example.com".into(),
        fusion_user_id: "test-fusion-user".into(),
        macro_user_id: "macro|member@example.com".into(),
        macro_organization_id: None,
        root_macro_id: None,
    };
    let mut header = Header::new(Algorithm::HS256);
    header.kid = Some("test-access-token".into());
    jsonwebtoken::encode(&header, &claims, &EncodingKey::from_secret(b"")).unwrap()
}

#[tokio::test]
async fn each_kind_dss_owns_is_purged_by_its_owning_service() {
    let purged = vec![(ENTITY, team_owner())];
    let cases = [
        ("document", [purged.clone(), vec![], vec![]]),
        ("chat", [vec![], purged.clone(), vec![]]),
        ("project", [vec![], vec![], purged.clone()]),
    ];
    for (kind, expected_calls) in cases {
        let services = Services::all_answering(OwnedPurgeOutcome::Purged);

        let status = services
            .send(purge(&format!("/owned/{kind}/{ENTITY}?owner={TEAM}")))
            .await;

        assert_eq!(status, StatusCode::NO_CONTENT, "{kind}");
        assert_eq!(services.calls(), expected_calls, "{kind}");
    }
}

#[tokio::test]
async fn the_owner_query_reaches_the_owning_service_as_a_principal() {
    let cases = [
        (TEAM.to_string(), Owner::Team(TEAM)),
        (
            format!("bot%7C{BOT}"),
            Owner::Bot(BotId::new_from_uuid(BOT)),
        ),
    ];
    for (query, owner) in cases {
        let services = Services::all_answering(OwnedPurgeOutcome::Purged);

        services
            .send(purge(&format!("/owned/document/{ENTITY}?owner={query}")))
            .await;

        assert_eq!(services.documents.calls(), vec![(ENTITY, owner)], "{query}");
    }
}

#[tokio::test]
async fn an_entity_under_another_owner_is_a_conflict() {
    let services = Services::all_answering(OwnedPurgeOutcome::OwnedElsewhere);

    let status = services
        .send(purge(&format!("/owned/chat/{ENTITY}?owner={TEAM}")))
        .await;

    assert_eq!(status, StatusCode::CONFLICT);
}

#[tokio::test]
async fn a_failed_purge_is_a_server_error() {
    let services = Services {
        projects: FakePurger::failing(),
        ..Services::all_answering(OwnedPurgeOutcome::Purged)
    };

    let status = services
        .send(purge(&format!("/owned/project/{ENTITY}?owner={TEAM}")))
        .await;

    assert_eq!(status, StatusCode::INTERNAL_SERVER_ERROR);
}

#[tokio::test]
async fn kinds_other_services_own_are_refused_without_a_purge() {
    for kind in ["agent_session", "scheduled_action"] {
        let services = Services::all_answering(OwnedPurgeOutcome::Purged);

        let status = services
            .send(purge(&format!("/owned/{kind}/{ENTITY}?owner={TEAM}")))
            .await;

        assert_eq!(status, StatusCode::BAD_REQUEST, "{kind}");
        assert_eq!(services.calls(), [vec![], vec![], vec![]], "{kind}");
    }
}

#[tokio::test]
async fn a_malformed_request_is_refused_without_a_purge() {
    for uri in [
        format!("/owned/channel/{ENTITY}?owner={TEAM}"),
        format!("/owned/bogus/{ENTITY}?owner={TEAM}"),
        format!("/owned/document/not-a-uuid?owner={TEAM}"),
        format!("/owned/document/{ENTITY}"),
        format!("/owned/document/{ENTITY}?owner=not-a-principal"),
    ] {
        let services = Services::all_answering(OwnedPurgeOutcome::Purged);

        let status = services.send(purge(&uri)).await;

        assert_eq!(status, StatusCode::BAD_REQUEST, "{uri}");
        assert_eq!(services.calls(), [vec![], vec![], vec![]], "{uri}");
    }
}

#[tokio::test]
async fn a_signed_in_user_is_forbidden_to_purge() {
    let services = Services::all_answering(OwnedPurgeOutcome::Purged);
    let request = Request::delete(format!("/owned/document/{ENTITY}?owner={TEAM}"))
        .header(AUTHORIZATION, format!("Bearer {}", user_access_token()))
        .body(Body::empty())
        .unwrap();

    let status = services.send(request).await;

    assert_eq!(status, StatusCode::FORBIDDEN);
    assert_eq!(services.calls(), [vec![], vec![], vec![]]);
}

#[tokio::test]
async fn a_request_without_the_internal_key_is_refused_without_a_purge() {
    for key in [None, Some("wrong-key")] {
        let services = Services::all_answering(OwnedPurgeOutcome::Purged);
        let mut request = Request::delete(format!("/owned/document/{ENTITY}?owner={TEAM}"));
        if let Some(key) = key {
            request = request.header(DSS_CLIENT_KEY_HEADER, key);
        }

        let status = services.send(request.body(Body::empty()).unwrap()).await;

        assert!(status.is_client_error(), "{key:?}: {status}");
        assert_eq!(services.calls(), [vec![], vec![], vec![]], "{key:?}");
    }
}
