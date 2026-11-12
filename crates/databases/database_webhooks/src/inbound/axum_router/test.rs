use std::sync::Mutex;

use axum::body::to_bytes;
use axum::response::Response;
use serde_json::{Value, json};

use super::*;

const DATABASE: DatabaseId = DatabaseId::from_uuid(Uuid::from_u128(1));
const MEETINGS: TableId = TableId::from_uuid(Uuid::from_u128(10));

/// Answers deliveries by token, and keeps the payloads it was handed.
#[derive(Default)]
struct FakeService {
    payloads: Mutex<Vec<Value>>,
}

impl DatabaseWebhooksService for FakeService {
    async fn create_webhook(
        &self,
        _receipt: entity_access::domain::models::EntityAccessReceipt<EditAccessLevel>,
        _table_id: TableId,
    ) -> Result<CreatedWebhook, DatabaseWebhookError> {
        unimplemented!("not routed in these tests")
    }

    async fn list_webhooks(
        &self,
        _receipt: entity_access::domain::models::EntityAccessReceipt<EditAccessLevel>,
    ) -> Result<Vec<DatabaseWebhook>, DatabaseWebhookError> {
        unimplemented!("not routed in these tests")
    }

    async fn delete_webhook(
        &self,
        _receipt: entity_access::domain::models::EntityAccessReceipt<EditAccessLevel>,
        _webhook_id: WebhookId,
    ) -> Result<(), DatabaseWebhookError> {
        unimplemented!("not routed in these tests")
    }

    async fn deliver(
        &self,
        token: &str,
        payload: &Value,
    ) -> Result<Delivery, DatabaseWebhookError> {
        self.payloads.lock().unwrap().push(payload.clone());
        match token {
            "mdbw_good" => Ok(Delivery {
                database_id: DATABASE,
                table_id: MEETINGS,
                rows: vec![RowId::from_uuid(Uuid::from_u128(100))],
            }),
            "mdbw_unfit" => Err(DatabaseWebhookError::InvalidPayload(vec![PayloadProblem {
                row: Some(1),
                field: Some("Titel".to_string()),
                message: "no column is named \"Titel\"".to_string(),
            }])),
            "mdbw_orphaned" => Err(DatabaseWebhookError::Forbidden(
                "the webhook's creator can no longer edit this database",
            )),
            _ => Err(DatabaseWebhookError::NotFound),
        }
    }
}

async fn deliver(
    service: &Arc<FakeService>,
    token: &str,
    body: &'static str,
) -> (StatusCode, Value) {
    let state = DatabaseWebhooksRouterState::new(
        service.clone(),
        Arc::new(()),
        MacroAuthorizationState::new(Arc::new(())),
    );
    let response: Response = deliver_handler::<FakeService, (), ()>(
        State(state),
        Path(token.to_string()),
        Bytes::from(body),
    )
    .await
    .into_response();
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&body).unwrap())
}

#[tokio::test]
async fn a_delivery_answers_created_with_its_new_rows() {
    let service = Arc::new(FakeService::default());

    let answer = deliver(&service, "mdbw_good", r#"{"Title": "Acme kickoff"}"#).await;

    assert_eq!(
        answer,
        (
            StatusCode::CREATED,
            json!({
                "databaseId": "00000000-0000-0000-0000-000000000001",
                "tableId": "00000000-0000-0000-0000-00000000000a",
                "rows": ["00000000-0000-0000-0000-000000000064"],
            })
        )
    );
    assert_eq!(
        *service.payloads.lock().unwrap(),
        vec![json!({"Title": "Acme kickoff"})]
    );
}

#[tokio::test]
async fn an_unfit_payload_answers_every_problem() {
    let service = Arc::new(FakeService::default());

    let answer = deliver(&service, "mdbw_unfit", r#"[{}, {"Titel": "x"}]"#).await;

    assert_eq!(
        answer,
        (
            StatusCode::BAD_REQUEST,
            json!({
                "message": "the payload does not fit the table; nothing was written",
                "problems": [{
                    "row": 1,
                    "field": "Titel",
                    "message": "no column is named \"Titel\"",
                }],
            })
        )
    );
}

#[tokio::test]
async fn a_body_that_is_not_json_is_refused_before_the_service() {
    let service = Arc::new(FakeService::default());

    let (status, body) = deliver(&service, "mdbw_good", "Title=Acme").await;

    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(body["problems"][0]["field"], Value::Null);
    assert!(
        body["problems"][0]["message"]
            .as_str()
            .unwrap()
            .starts_with("the body is not JSON")
    );
    assert!(service.payloads.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_unknown_or_orphaned_webhook_answers_its_status() {
    let service = Arc::new(FakeService::default());

    assert_eq!(
        deliver(&service, "mdbw_unknown", "{}").await,
        (StatusCode::NOT_FOUND, json!({ "message": "not found" }))
    );
    assert_eq!(
        deliver(&service, "mdbw_orphaned", "{}").await,
        (
            StatusCode::FORBIDDEN,
            json!({ "message": "the webhook's creator can no longer edit this database" })
        )
    );
}
