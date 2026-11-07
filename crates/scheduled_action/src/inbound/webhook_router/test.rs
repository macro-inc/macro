use std::sync::Mutex;

use axum::body::{Body, to_bytes};
use axum::http::{Request, header};
use chrono::Utc;
use entity_access::domain::models::EntityAccessReceipt;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::*;
use crate::domain::event_trigger::EventId;
use crate::inbound::axum_router::test::{FakeAuth, FakeEntityAccessService};

const EVENT: &str = "0195c0de-0000-7000-8000-00000000e7e1";
const ROUTINE: &str = "0195c0de-0000-7000-8000-000000000001";

/// What a delivery passed to the service.
#[derive(Debug, PartialEq)]
struct Delivered {
    token: String,
    body: Vec<u8>,
    content_type: Option<String>,
}

/// Records what it is asked; a delivery fails with `deliver_error` when set.
struct Webhooks {
    deliveries: Mutex<Vec<Delivered>>,
    created_for: Mutex<Vec<String>>,
    deliver_error: Mutex<Option<RoutineWebhookError>>,
}

impl Webhooks {
    fn new() -> Self {
        Self {
            deliveries: Mutex::default(),
            created_for: Mutex::default(),
            deliver_error: Mutex::new(None),
        }
    }
}

fn webhook() -> RoutineWebhook {
    RoutineWebhook {
        routine_id: Uuid::parse_str(ROUTINE).unwrap(),
        token_prefix: "mrw_prefix".to_owned(),
        created_at: Utc::now(),
    }
}

impl RoutineWebhooks for Webhooks {
    async fn create(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<CreatedRoutineWebhook, RoutineWebhookError> {
        self.created_for
            .lock()
            .unwrap()
            .push(receipt.entity().entity_id.clone());
        Ok(CreatedRoutineWebhook {
            webhook: webhook(),
            token: "mrw_secret".to_owned(),
        })
    }

    async fn get(
        &self,
        _: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<RoutineWebhook, RoutineWebhookError> {
        Err(RoutineWebhookError::NoWebhook)
    }

    async fn delete(
        &self,
        _: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), RoutineWebhookError> {
        Ok(())
    }

    async fn deliver(
        &self,
        token: &str,
        body: &[u8],
        content_type: Option<&str>,
    ) -> Result<EventId, RoutineWebhookError> {
        self.deliveries.lock().unwrap().push(Delivered {
            token: token.to_owned(),
            body: body.to_vec(),
            content_type: content_type.map(str::to_owned),
        });
        match self.deliver_error.lock().unwrap().take() {
            Some(error) => Err(error),
            None => Ok(EventId::try_from(Uuid::parse_str(EVENT).unwrap()).unwrap()),
        }
    }
}

fn router(webhooks: Arc<Webhooks>) -> Router {
    routine_webhook_router(RoutineWebhookRouterState {
        service: webhooks,
        access_service: Arc::new(FakeEntityAccessService::owner_only()),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuth)),
    })
}

async fn send(router: &Router, request: Request<Body>) -> (StatusCode, Value) {
    let response = router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let value =
        serde_json::from_slice(&bytes).unwrap_or_else(|_| json!(String::from_utf8_lossy(&bytes)));
    (status, value)
}

fn delivery(body: impl Into<Body>) -> Request<Body> {
    Request::builder()
        .method("POST")
        .uri("/scheduled-actions/webhooks/mrw_token")
        .header(header::CONTENT_TYPE, "text/plain")
        .body(body.into())
        .unwrap()
}

#[tokio::test]
async fn a_delivery_needs_no_credentials_and_passes_on_what_was_sent() {
    let webhooks = Arc::new(Webhooks::new());
    let app = router(Arc::clone(&webhooks));

    let (status, body) = send(&app, delivery("Deploy finished")).await;

    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(body, json!({ "eventId": EVENT }));
    assert_eq!(
        *webhooks.deliveries.lock().unwrap(),
        vec![Delivered {
            token: "mrw_token".to_owned(),
            body: b"Deploy finished".to_vec(),
            content_type: Some("text/plain".to_owned()),
        }]
    );
}

#[tokio::test]
async fn a_body_over_the_limit_is_refused_before_the_service() {
    let webhooks = Arc::new(Webhooks::new());
    let app = router(Arc::clone(&webhooks));

    let (status, _) = send(&app, delivery(vec![b'a'; MAX_WEBHOOK_BODY_BYTES + 1])).await;

    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
    assert!(webhooks.deliveries.lock().unwrap().is_empty());
}

#[tokio::test]
async fn delivery_refusals_have_their_own_statuses() {
    for (error, expected) in [
        (RoutineWebhookError::UnknownUrl, StatusCode::NOT_FOUND),
        (RoutineWebhookError::NotListening, StatusCode::CONFLICT),
        (
            RoutineWebhookError::Backlogged,
            StatusCode::TOO_MANY_REQUESTS,
        ),
        (
            RoutineWebhookError::Body(WebhookBodyError::NotText),
            StatusCode::BAD_REQUEST,
        ),
        (
            RoutineWebhookError::Internal(rootcause::report!("offline")),
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
    ] {
        let webhooks = Arc::new(Webhooks::new());
        *webhooks.deliver_error.lock().unwrap() = Some(error);
        let (status, body) = send(&router(webhooks), delivery("hello")).await;
        assert_eq!(status, expected);
        // Storage failures never show their cause.
        if expected == StatusCode::INTERNAL_SERVER_ERROR {
            assert_eq!(body, json!("internal server error"));
        }
    }
}

#[tokio::test]
async fn only_the_owner_manages_the_url() {
    let webhooks = Arc::new(Webhooks::new());
    let app = router(Arc::clone(&webhooks));
    let manage = |method: &str, token: &str| {
        Request::builder()
            .method(method)
            .uri(format!("/scheduled-actions/{ROUTINE}/webhook"))
            .header(header::AUTHORIZATION, format!("Bearer {token}"))
            .body(Body::empty())
            .unwrap()
    };

    let (status, body) = send(&app, manage("POST", "owner")).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["token"], "mrw_secret");
    assert_eq!(body["webhook"]["tokenPrefix"], "mrw_prefix");
    assert_eq!(*webhooks.created_for.lock().unwrap(), vec![ROUTINE]);

    let (status, _) = send(&app, manage("GET", "owner")).await;
    assert_eq!(status, StatusCode::NOT_FOUND);
    let (status, _) = send(&app, manage("DELETE", "owner")).await;
    assert_eq!(status, StatusCode::NO_CONTENT);

    for method in ["POST", "GET", "DELETE"] {
        let (status, _) = send(&app, manage(method, "stranger")).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED, "{method}");
    }
    assert_eq!(webhooks.created_for.lock().unwrap().len(), 1);
}
