use std::sync::Mutex;
use std::time::Duration;

use axum::body::Body;
use axum::http::Request;
use axum::http::header::CONTENT_TYPE;
use entity_access::domain::models::EntityAccessReceipt;
use macro_uuid::generate_uuid_v7;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::*;
use crate::domain::webhook::{Delivered, MintedWebhook};

const HOOK: &str = "0190f5b2-3c4d-7e8f-9a0b-1c2d3e4f5a6b";
const SECRET: &str = "fake-webhook-secret-text";

#[derive(Debug, Clone, PartialEq, Eq)]
struct Received {
    hook_id: String,
    secret: String,
    body: Vec<u8>,
    content_type: Option<String>,
    idempotency_key: Option<String>,
}

/// Answers every delivery with `answer`, and records what it was given.
struct Fake {
    answer: Mutex<Option<Result<Delivered, DeliveryError>>>,
    received: Mutex<Vec<Received>>,
}

impl Fake {
    fn answering(answer: Result<Delivered, DeliveryError>) -> Arc<Self> {
        Arc::new(Self {
            answer: Mutex::new(Some(answer)),
            received: Mutex::new(Vec::new()),
        })
    }
    fn received(&self) -> Vec<Received> {
        self.received.lock().unwrap().clone()
    }
}

impl RoutineWebhookService for Fake {
    async fn status(
        &self,
        _: &EntityAccessReceipt<EditAccessLevel>,
        _: ManagingCaller,
    ) -> Result<Option<WebhookInfo>, WebhookManagementError> {
        unimplemented!()
    }
    async fn mint(
        &self,
        _: &EntityAccessReceipt<EditAccessLevel>,
        _: ManagingCaller,
    ) -> Result<MintedWebhook, WebhookManagementError> {
        unimplemented!()
    }
    async fn remove(
        &self,
        _: &EntityAccessReceipt<EditAccessLevel>,
        _: ManagingCaller,
    ) -> Result<bool, WebhookManagementError> {
        unimplemented!()
    }
    async fn receive(&self, request: DeliveryRequest<'_>) -> Result<Delivered, DeliveryError> {
        self.received.lock().unwrap().push(Received {
            hook_id: request.hook_id.to_owned(),
            secret: request.secret.to_owned(),
            body: request.body.to_vec(),
            content_type: request.content_type.map(str::to_owned),
            idempotency_key: request.idempotency_key,
        });
        self.answer
            .lock()
            .unwrap()
            .take()
            .unwrap_or(Err(DeliveryError::NotFound))
    }
}

fn app<W: RoutineWebhookService>(service: Arc<W>) -> Router {
    Router::new().nest(
        "/scheduled-action",
        webhook_delivery_router::<_, ()>(service),
    )
}

async fn send(app: Router, request: Request<Body>) -> (StatusCode, HeaderMap, Vec<u8>) {
    let response = app.oneshot(request).await.unwrap();
    let status = response.status();
    let headers = response.headers().clone();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, headers, body.to_vec())
}

fn post(uri: &str) -> axum::http::request::Builder {
    Request::post(uri).header(CONTENT_TYPE, "application/json")
}

#[tokio::test]
async fn the_secret_in_the_path_starts_a_run() {
    let run_id = generate_uuid_v7();
    let fake = Fake::answering(Ok(Delivered::Started { run_id }));
    let (status, headers, body) = send(
        app(Arc::clone(&fake)),
        post(&format!("/scheduled-action/hooks/{HOOK}/{SECRET}"))
            .header("idempotency-key", "order-42")
            .body(Body::from(r#"{"order":42}"#))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert!(headers.get("access-control-allow-origin").is_none());
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap(),
        json!({"runId": run_id})
    );
    assert_eq!(
        fake.received(),
        [Received {
            hook_id: HOOK.into(),
            secret: SECRET.into(),
            body: br#"{"order":42}"#.to_vec(),
            content_type: Some("application/json".into()),
            idempotency_key: Some("order-42".into()),
        }]
    );
}

#[tokio::test]
async fn a_body_failing_the_payload_tests_is_answered_without_a_run() {
    let fake = Fake::answering(Ok(Delivered::Unmatched));
    let (status, _, body) = send(
        app(fake),
        post(&format!("/scheduled-action/hooks/{HOOK}/{SECRET}"))
            .body(Body::from("status: passed"))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap(),
        json!({"runId": null})
    );
}

#[tokio::test]
async fn a_bearer_secret_starts_a_run() {
    let run_id = generate_uuid_v7();
    let fake = Fake::answering(Ok(Delivered::Repeated { run_id }));
    let (status, _, body) = send(
        app(Arc::clone(&fake)),
        post(&format!("/scheduled-action/hooks/{HOOK}"))
            .header(AUTHORIZATION, format!("Bearer {SECRET}"))
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(
        serde_json::from_slice::<Value>(&body).unwrap(),
        json!({"runId": run_id})
    );
    let received = fake.received();
    assert_eq!(received[0].secret, SECRET);
    assert!(received[0].body.is_empty());
}

#[tokio::test]
async fn a_bearer_post_without_a_token_is_checked_with_an_empty_secret() {
    let fake = Fake::answering(Err(DeliveryError::NotFound));
    let (status, _, body) = send(
        app(Arc::clone(&fake)),
        post(&format!("/scheduled-action/hooks/{HOOK}"))
            .header(AUTHORIZATION, "Basic abc")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body, b"Not found");
    assert_eq!(fake.received()[0].secret, "");
}

#[tokio::test]
async fn refusals_map_to_their_statuses() {
    let cases = [
        (DeliveryError::NotFound, StatusCode::NOT_FOUND, None),
        (
            DeliveryError::TooManyRequests {
                retry_after: Duration::from_secs(60),
            },
            StatusCode::TOO_MANY_REQUESTS,
            Some("60"),
        ),
        (
            DeliveryError::Busy {
                retry_after: Duration::from_millis(10),
            },
            StatusCode::TOO_MANY_REQUESTS,
            Some("1"),
        ),
        (DeliveryError::TooLarge, StatusCode::PAYLOAD_TOO_LARGE, None),
        (DeliveryError::NotText, StatusCode::BAD_REQUEST, None),
        (
            DeliveryError::InvalidIdempotencyKey,
            StatusCode::BAD_REQUEST,
            None,
        ),
        (DeliveryError::Paused, StatusCode::CONFLICT, None),
        (
            DeliveryError::Unavailable(rootcause::report!("down")),
            StatusCode::SERVICE_UNAVAILABLE,
            None,
        ),
    ];
    for (error, expected, retry_after) in cases {
        let label = format!("{error:?}");
        let (status, headers, body) = send(
            app(Fake::answering(Err(error))),
            post(&format!("/scheduled-action/hooks/{HOOK}/{SECRET}"))
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await;
        assert_eq!(status, expected, "{label}");
        assert_eq!(
            headers
                .get(RETRY_AFTER)
                .map(|value| value.to_str().unwrap()),
            retry_after,
            "{label}"
        );
        assert!(!String::from_utf8_lossy(&body).contains("down"));
    }
}

#[tokio::test]
async fn an_oversized_body_is_refused_before_the_service() {
    let fake = Fake::answering(Ok(Delivered::Started {
        run_id: generate_uuid_v7(),
    }));
    let (status, _, _) = send(
        app(Arc::clone(&fake)),
        post(&format!("/scheduled-action/hooks/{HOOK}/{SECRET}"))
            .body(Body::from(vec![b' '; MAX_BODY_BYTES + 1]))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert!(fake.received().is_empty());
}

#[tokio::test]
async fn a_non_text_idempotency_key_is_refused_before_the_service() {
    let fake = Fake::answering(Ok(Delivered::Started {
        run_id: generate_uuid_v7(),
    }));
    let (status, _, _) = send(
        app(Arc::clone(&fake)),
        post(&format!("/scheduled-action/hooks/{HOOK}/{SECRET}"))
            .header(
                "idempotency-key",
                HeaderValue::from_bytes(b"caf\xe9").unwrap(),
            )
            .body(Body::from("{}"))
            .unwrap(),
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(fake.received().is_empty());
}

#[tokio::test]
async fn other_paths_and_methods_reach_no_hook() {
    for (method, uri) in [
        ("POST", format!("/scheduled-action/hooks/{HOOK}/{SECRET}/")),
        (
            "POST",
            format!("/scheduled-action/hooks/{HOOK}/{SECRET}/x/y"),
        ),
        ("POST", "/scheduled-action/hooks".to_owned()),
        ("GET", format!("/scheduled-action/hooks/{HOOK}/{SECRET}")),
        ("PUT", format!("/scheduled-action/hooks/{HOOK}")),
    ] {
        let fake = Fake::answering(Ok(Delivered::Started {
            run_id: generate_uuid_v7(),
        }));
        let (status, _, _) = send(
            app(Arc::clone(&fake)),
            Request::builder()
                .method(method)
                .uri(&uri)
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await;
        assert!(
            matches!(
                status,
                StatusCode::NOT_FOUND | StatusCode::METHOD_NOT_ALLOWED
            ),
            "{method} {uri}: {status}"
        );
        assert!(fake.received().is_empty(), "{method} {uri}");
    }
}

/// Every span field and event field written while a request is served.
mod capture {
    use std::sync::{Arc, Mutex};

    use tracing::field::{Field, Visit};
    use tracing::span::{Attributes, Id, Record};
    use tracing::{Event, Metadata, Subscriber};

    #[derive(Clone, Default)]
    pub struct Captured(pub Arc<Mutex<Vec<String>>>);

    impl Captured {
        pub fn written(&self) -> Vec<String> {
            self.0.lock().unwrap().clone()
        }
    }

    struct Fields<'a>(&'a str, &'a Mutex<Vec<String>>);

    impl Visit for Fields<'_> {
        fn record_debug(&mut self, field: &Field, value: &dyn std::fmt::Debug) {
            self.1
                .lock()
                .unwrap()
                .push(format!("{} {}={value:?}", self.0, field.name()));
        }
    }

    pub struct Recorder(pub Captured, pub std::sync::atomic::AtomicU64);

    impl Subscriber for Recorder {
        fn enabled(&self, _: &Metadata<'_>) -> bool {
            true
        }
        fn new_span(&self, span: &Attributes<'_>) -> Id {
            let name = span.metadata().name();
            span.record(&mut Fields(name, &self.0.0));
            Id::from_u64(
                self.1
                    .fetch_add(1, std::sync::atomic::Ordering::Relaxed)
                    .saturating_add(1),
            )
        }
        fn record(&self, _: &Id, values: &Record<'_>) {
            values.record(&mut Fields("record", &self.0.0));
        }
        fn record_follows_from(&self, _: &Id, _: &Id) {}
        fn event(&self, event: &Event<'_>) {
            event.record(&mut Fields(event.metadata().name(), &self.0.0));
        }
        fn enter(&self, _: &Id) {}
        fn exit(&self, _: &Id) {}
    }
}

/// The real service, store and request tracing: a secret sent either way,
/// right or wrong, is written to no span and no log event.
#[sqlx::test(migrator = "macro_db_migrator::MACRO_DB_MIGRATIONS")]
async fn the_secret_is_never_traced(pool: sqlx::PgPool) {
    use crate::domain::ports::ScheduledActionRepo;
    use crate::domain::webhook::{Limit, LimitScope, RoutineWebhooks, WebhookLimits};
    use crate::outbound::pg_scheduled_action_repo::test::{
        USER_A, insert_user, sample_action, test_repo, user_owner,
    };
    use crate::outbound::pg_webhook_store::PgWebhookStore;

    struct Unlimited;
    impl WebhookLimits for Unlimited {
        async fn count(
            &self,
            _: LimitScope,
            _: Limit,
        ) -> Result<Option<Duration>, rootcause::Report> {
            Ok(None)
        }
    }

    insert_user(&pool, USER_A).await;
    let repo = Arc::new(test_repo(pool.clone()));
    let mut action = sample_action(user_owner(USER_A), "webhook routine");
    action.trigger =
        serde_json::from_value(json!({"type": "events", "filters": [{"events": ["webhook"]}]}))
            .unwrap();
    action.next_run_at = None;
    action.event_activated_at = Some(chrono::Utc::now() - chrono::Duration::minutes(1));
    let action = repo.create_action(action).await.unwrap();
    let service = Arc::new(RoutineWebhooks::new(
        Arc::clone(&repo),
        PgWebhookStore::new(pool.clone()),
        Unlimited,
    ));
    let receipt = EntityAccessReceipt::dangerously_assert_authenticated_user(
        macro_user_id::user_id::MacroUserIdStr::parse_from_str(USER_A).unwrap(),
        &action.id.unwrap().to_string(),
        model_entity::EntityType::ScheduledAction,
    );
    let minted = service
        .mint(&receipt, ManagingCaller::Person)
        .await
        .unwrap();
    let secret = minted.secret.expose().to_owned();
    let hook = minted.hook_id.to_string();
    let app = app(service)
        .layer(macro_tower_layers::MacroRequestIdAndTracingLayer::new(Duration::ZERO).into_inner());

    let captured = capture::Captured::default();
    let _guard = tracing::subscriber::set_default(capture::Recorder(
        captured.clone(),
        std::sync::atomic::AtomicU64::new(0),
    ));
    tracing::callsite::rebuild_interest_cache();
    let wrong = format!("{secret}x");
    let requests = [
        post(&format!("/scheduled-action/hooks/{hook}/{secret}"))
            .body(Body::from(r#"{"a":1}"#))
            .unwrap(),
        post(&format!("/scheduled-action/hooks/{hook}"))
            .header(AUTHORIZATION, format!("Bearer {secret}"))
            .body(Body::from("{}"))
            .unwrap(),
        post(&format!("/scheduled-action/hooks/{hook}/{wrong}"))
            .body(Body::from("{}"))
            .unwrap(),
        post(&format!("/scheduled-action/hooks/{hook}/{secret}/"))
            .body(Body::from("{}"))
            .unwrap(),
        post(&format!("/scheduled-action/hooks/{hook}/{secret}/extra"))
            .body(Body::from("{}"))
            .unwrap(),
        post(&format!("/scheduled-action/hooks/{hook}/{secret}"))
            .body(Body::from(vec![0xff, 0xfe]))
            .unwrap(),
    ];
    let mut statuses = Vec::new();
    for request in requests {
        statuses.push(send(app.clone(), request).await.0);
    }
    assert_eq!(
        statuses,
        [
            StatusCode::ACCEPTED,
            StatusCode::ACCEPTED,
            StatusCode::NOT_FOUND,
            StatusCode::NOT_FOUND,
            StatusCode::NOT_FOUND,
            StatusCode::BAD_REQUEST,
        ]
    );
    let written = captured.written();
    assert!(
        written
            .iter()
            .any(|field| field.contains("routine.webhook.receive")),
        "{written:#?}"
    );
    assert!(
        written.iter().any(|field| field.contains("url.path")),
        "{written:#?}"
    );
    let leaked: Vec<_> = written
        .iter()
        .filter(|field| field.contains(&secret))
        .collect();
    assert!(leaked.is_empty(), "{leaked:#?}");
}

fn signed_in(origin: macro_authorization::CredentialOrigin) -> MacroUserAuthentication {
    let user_id = "macro|owner@macro.com";
    MacroUserAuthentication {
        origin,
        agent_id: None,
        agent_via: None,
        routine_id: None,
        macro_user_id: macro_user_id::user_id::MacroUserIdStr::try_from(user_id.to_owned())
            .unwrap(),
        user_context: model::user::UserContext {
            user_id: user_id.into(),
            ..Default::default()
        },
    }
}

#[test]
fn only_a_persons_own_session_manages_a_webhook() {
    use macro_authorization::CredentialOrigin;
    assert_eq!(
        managing_caller(&signed_in(CredentialOrigin::Session)),
        ManagingCaller::Person
    );
    // An API token (the SDK, an MCP client) carries no agent context, yet is
    // not the person in their own session.
    for origin in [
        CredentialOrigin::MacroApiJwt,
        CredentialOrigin::ScopedMacroApiJwt,
        CredentialOrigin::UserApiKey,
        CredentialOrigin::Bot,
    ] {
        assert_eq!(managing_caller(&signed_in(origin)), ManagingCaller::Agent);
    }
    let mut attributed = signed_in(CredentialOrigin::Session);
    attributed.agent_id = Some(bot_id::BotId::TEST_A);
    assert_eq!(managing_caller(&attributed), ManagingCaller::Agent);
}

/// Refuses whoever the router calls a program, as the domain does, and
/// answers the owner in person with "not found"; records whom it was given.
#[derive(Default)]
struct Manages(Mutex<Vec<ManagingCaller>>);

impl Manages {
    fn answer(&self, caller: ManagingCaller) -> WebhookManagementError {
        self.0.lock().unwrap().push(caller);
        match caller {
            ManagingCaller::Agent => WebhookManagementError::NotOwnerInPerson,
            ManagingCaller::Person => WebhookManagementError::NotFound,
        }
    }
}

impl RoutineWebhookService for Manages {
    async fn status(
        &self,
        _: &EntityAccessReceipt<EditAccessLevel>,
        caller: ManagingCaller,
    ) -> Result<Option<WebhookInfo>, WebhookManagementError> {
        Err(self.answer(caller))
    }
    async fn mint(
        &self,
        _: &EntityAccessReceipt<EditAccessLevel>,
        caller: ManagingCaller,
    ) -> Result<MintedWebhook, WebhookManagementError> {
        Err(self.answer(caller))
    }
    async fn remove(
        &self,
        _: &EntityAccessReceipt<EditAccessLevel>,
        caller: ManagingCaller,
    ) -> Result<bool, WebhookManagementError> {
        Err(self.answer(caller))
    }
    async fn receive(&self, _: DeliveryRequest<'_>) -> Result<Delivered, DeliveryError> {
        unimplemented!()
    }
}

#[tokio::test]
async fn a_credential_signed_for_a_routine_run_cannot_manage_a_url() {
    use crate::inbound::axum_router::test::{FakeAuth, FakeEntityAccessService, request};

    let service = Arc::new(Manages::default());
    let app = webhook_management_router::<_, _, _, ()>(WebhookRouterState {
        service: Arc::clone(&service),
        access_service: Arc::new(FakeEntityAccessService::owner_only()),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuth)),
        public_base: Arc::from("https://example.test/scheduled-action"),
    });
    let uri = format!("/scheduled-actions/{}/webhook", generate_uuid_v7());
    // Read, make, replace (a second make) and delete.
    let methods = ["GET", "POST", "POST", "DELETE"];
    let answers = async |token: &str| {
        let mut answers = Vec::new();
        for method in methods {
            answers.push(request(&app, method, &uri, token, json!(null)).await);
        }
        answers
    };

    let refused = answers("agent").await;
    assert!(
        refused
            .iter()
            .all(|(status, _)| *status == StatusCode::FORBIDDEN),
        "{refused:?}"
    );
    // A run's API token, and a run's credential arriving as a session.
    for token in ["routine", "routine-session"] {
        assert_eq!(answers(token).await, refused, "{token}");
    }
    let owner = answers("owner").await;
    assert!(
        owner
            .iter()
            .all(|(status, _)| *status == StatusCode::NOT_FOUND),
        "{owner:?}"
    );
    let callers = service.0.lock().unwrap().clone();
    assert_eq!(
        callers,
        [
            [ManagingCaller::Agent; 12].as_slice(),
            &[ManagingCaller::Person; 4]
        ]
        .concat()
    );
}
