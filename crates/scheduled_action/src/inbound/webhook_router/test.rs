use std::sync::Mutex;

use axum::Router;
use entity_access::domain::models::EntityAccessReceipt;
use macro_uuid::{Uuid, generate_uuid_v7};
use serde_json::{Value, json};

use super::*;
use crate::inbound::axum_router::test::{FakeAuth, FakeEntityAccessService, request};

const TOKEN: &str = "mrw_0123456789ab_secret";

#[derive(Default)]
struct Webhooks {
    delivered: Mutex<Vec<Value>>,
    issued_for: Mutex<Vec<String>>,
}

impl RoutineWebhooks for Webhooks {
    async fn issue(
        &self,
        receipt: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<IssuedRoutineWebhook, RoutineWebhookError> {
        self.issued_for
            .lock()
            .unwrap()
            .push(receipt.entity().entity_id.clone());
        Ok(IssuedRoutineWebhook {
            token: TOKEN.to_owned(),
            webhook: RoutineWebhook {
                token_prefix: "mrw_0123456789ab".to_owned(),
                created_at: chrono::Utc::now(),
            },
        })
    }
    async fn get(
        &self,
        _: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<Option<RoutineWebhook>, RoutineWebhookError> {
        Ok(None)
    }
    async fn revoke(
        &self,
        _: EntityAccessReceipt<OwnerAccessLevel>,
    ) -> Result<(), RoutineWebhookError> {
        Ok(())
    }
    async fn deliver(
        &self,
        token: &str,
        payload: Value,
    ) -> Result<RoutineWebhookDelivery, RoutineWebhookError> {
        if token != TOKEN {
            return Err(RoutineWebhookError::UnknownToken);
        }
        self.delivered.lock().unwrap().push(payload);
        Ok(RoutineWebhookDelivery {
            event_id: generate_uuid_v7(),
            queued: true,
        })
    }
}

fn router(webhooks: Arc<Webhooks>) -> Router {
    routine_webhook_router(RoutineWebhookRouterState {
        webhooks,
        access_service: Arc::new(FakeEntityAccessService::owner_only()),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuth)),
    })
}

#[tokio::test]
async fn deliveries_need_only_the_token_and_a_json_body() {
    let webhooks = Arc::new(Webhooks::default());
    let app = router(Arc::clone(&webhooks));
    let url = format!("/scheduled-actions/webhooks/{TOKEN}");

    let (status, body) = request(&app, "POST", &url, "no-such-user", json!({ "ok": 1 })).await;
    assert_eq!(status, StatusCode::ACCEPTED);
    assert_eq!(body["queued"], json!(true));
    assert_eq!(
        *webhooks.delivered.lock().unwrap(),
        vec![json!({ "ok": 1 })]
    );

    let (status, _) = request(
        &app,
        "POST",
        "/scheduled-actions/webhooks/mrw_wrong",
        "owner",
        json!({}),
    )
    .await;
    assert_eq!(status, StatusCode::NOT_FOUND);

    let too_large = json!({ "text": "x".repeat(MAX_WEBHOOK_BODY_BYTES) });
    let (status, _) = request(&app, "POST", &url, "owner", too_large).await;
    assert_eq!(status, StatusCode::PAYLOAD_TOO_LARGE);
}

#[tokio::test]
async fn a_body_that_is_not_json_is_refused() {
    let app = router(Arc::new(Webhooks::default()));
    let response = tower::ServiceExt::oneshot(
        app,
        axum::http::Request::builder()
            .method("POST")
            .uri(format!("/scheduled-actions/webhooks/{TOKEN}"))
            .body(axum::body::Body::from("not json"))
            .unwrap(),
    )
    .await
    .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
}

#[tokio::test]
async fn only_the_owner_issues_a_url() {
    let webhooks = Arc::new(Webhooks::default());
    let app = router(Arc::clone(&webhooks));
    let id = Uuid::now_v7();
    let url = format!("/scheduled-actions/{id}/webhook");

    let (status, _) = request(&app, "POST", &url, "stranger", Value::Null).await;
    assert_eq!(status, StatusCode::UNAUTHORIZED);
    let (status, body) = request(&app, "POST", &url, "owner", Value::Null).await;
    assert_eq!(status, StatusCode::CREATED);
    assert_eq!(body["token"], json!(TOKEN));
    assert_eq!(*webhooks.issued_for.lock().unwrap(), vec![id.to_string()]);
}
