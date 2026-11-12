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
    /// Creates that reached the service; each answers "not found".
    creates: Mutex<usize>,
}

impl DatabaseWebhooksService for FakeService {
    async fn create_webhook(
        &self,
        _receipt: entity_access::domain::models::EntityAccessReceipt<EditAccessLevel>,
        _table_id: TableId,
    ) -> Result<CreatedWebhook, DatabaseWebhookError> {
        *self.creates.lock().unwrap() += 1;
        Err(DatabaseWebhookError::NotFound)
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

mod create_route {
    use super::*;
    use axum::http::{Request, header};
    use entity_access::domain::models::{
        AccessError, AccessLevel, BotAccessScope, BotId, CallChannelInfo, EntityAccessReceipt,
        EntityPermission, EntityType, RequiredPermission, TeamRole, UserTeamInfo,
    };
    use macro_authorization::{
        CODE_EXECUTION_HEADER, CredentialOrigin, InternalIdentityClaims, MacroAuthorizationError,
        ValidatedCredential,
    };
    use macro_user_id::{
        lowercased::Lowercase,
        user_id::{MacroUserId, MacroUserIdStr},
    };
    use model_user::UserContext;
    use rootcause::Report;
    use tower::ServiceExt;

    /// "person" is the editor's own session; "agent" is their credential
    /// signed for an agent's program.
    #[derive(Clone)]
    struct Credentials;

    impl MacroAuthorizationService for Credentials {
        async fn authorize(
            &self,
            jwt: &str,
        ) -> Result<UserContext, Report<MacroAuthorizationError>> {
            match jwt {
                "person" | "agent" => Ok(UserContext {
                    user_id: "macro|editor@example.com".to_owned(),
                    fusion_user_id: "fusion-user-id".to_owned(),
                    organization_id: None,
                    permissions: None,
                }),
                _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
            }
        }

        async fn authorize_identity(
            &self,
            jwt: &str,
        ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
            let mut credential = ValidatedCredential::session(self.authorize(jwt).await?);
            if jwt == "agent" {
                credential.origin = CredentialOrigin::MacroApiJwt;
                credential.identity.agent_id =
                    Some(serde_json::from_value(json!(Uuid::from_u128(1))).unwrap());
            }
            Ok(credential)
        }

        async fn authorize_internal(
            &self,
            _provided_key: &str,
            _claims: InternalIdentityClaims,
        ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
            Err(Report::new(MacroAuthorizationError::InvalidCredentials))
        }
    }

    /// The editor may edit every database; nothing else is asked.
    struct Editor;

    impl EntityAccessService for Editor {
        async fn generate_entity_access_receipt<T: RequiredPermission>(
            &self,
            _user_id: &MacroUserId<Lowercase<'_>>,
            _user_org_id: Option<i64>,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> Result<EntityAccessReceipt<T>, AccessError> {
            panic!("unexpected generate_entity_access_receipt call")
        }

        async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
            &self,
            _bot_id: BotId,
            _scope: BotAccessScope,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> Result<EntityAccessReceipt<T>, AccessError> {
            panic!("unexpected generate_bot_entity_access_receipt call")
        }

        async fn get_access_level(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> Result<Option<AccessLevel>, AccessError> {
            panic!("unexpected get_access_level call")
        }

        async fn check_access(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
            _required_level: AccessLevel,
        ) -> Result<AccessLevel, AccessError> {
            panic!("unexpected check_access call")
        }

        async fn check_public_access(
            &self,
            _entity_id: &str,
            _entity_type: EntityType,
            _required_level: AccessLevel,
        ) -> Result<AccessLevel, AccessError> {
            panic!("unexpected check_public_access call")
        }

        async fn get_entity_permission(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
            _user_org_id: Option<i64>,
        ) -> Result<EntityPermission, AccessError> {
            Ok(EntityPermission::AccessLevel {
                access_level: AccessLevel::Edit,
            })
        }

        async fn get_crm_entity_permission_with_team(
            &self,
            _user_id: Option<&MacroUserId<Lowercase<'_>>>,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> Result<(EntityPermission, uuid::Uuid, TeamRole), AccessError> {
            panic!("unexpected get_crm_entity_permission_with_team call")
        }

        async fn get_users_by_entity(
            &self,
            _entity_id: &str,
            _entity_type: EntityType,
        ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
            panic!("unexpected get_users_by_entity call")
        }

        async fn get_call_channel(
            &self,
            _call_id: &uuid::Uuid,
        ) -> Result<Option<CallChannelInfo>, AccessError> {
            panic!("unexpected get_call_channel call")
        }

        async fn get_call_channel_by_channel_id(
            &self,
            _channel_id: &uuid::Uuid,
        ) -> Result<Option<CallChannelInfo>, AccessError> {
            panic!("unexpected get_call_channel_by_channel_id call")
        }

        async fn get_user_team(
            &self,
            _user_id: &MacroUserId<Lowercase<'_>>,
        ) -> Result<Option<UserTeamInfo>, AccessError> {
            Ok(None)
        }
    }

    fn create(bearer: &str, code_mode: bool) -> Request<axum::body::Body> {
        let request = Request::post(format!("/{}/webhooks", DATABASE.as_uuid()))
            .header(header::AUTHORIZATION, format!("Bearer {bearer}"))
            .header(header::CONTENT_TYPE, "application/json");
        let request = if code_mode {
            request.header(CODE_EXECUTION_HEADER, "1")
        } else {
            request
        };
        request
            .body(axum::body::Body::from(
                json!({ "tableId": MEETINGS.as_uuid() }).to_string(),
            ))
            .unwrap()
    }

    async fn send(service: &Arc<FakeService>, request: Request<axum::body::Body>) -> Response {
        database_webhooks_router::<_, _, _, ()>(DatabaseWebhooksRouterState::new(
            service.clone(),
            Arc::new(Editor),
            MacroAuthorizationState::new(Arc::new(Credentials)),
        ))
        .oneshot(request)
        .await
        .unwrap()
    }

    #[tokio::test]
    async fn an_agents_program_cannot_create_a_database_webhook() {
        for request in [create("agent", false), create("person", true)] {
            let service = Arc::new(FakeService::default());
            let response = send(&service, request).await;

            assert_eq!(response.status(), StatusCode::FORBIDDEN);
            let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
            let body: Value = serde_json::from_slice(&body).unwrap();
            assert_eq!(body["message"], PROGRAM_DATABASE_WEBHOOK_REFUSAL);
            assert_eq!(*service.creates.lock().unwrap(), 0);
        }
    }

    #[tokio::test]
    async fn an_editor_still_reaches_the_service() {
        let service = Arc::new(FakeService::default());
        let response = send(&service, create("person", false)).await;

        assert_eq!(response.status(), StatusCode::NOT_FOUND);
        assert_eq!(*service.creates.lock().unwrap(), 1);
    }
}
