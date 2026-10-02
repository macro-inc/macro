use super::*;
use crate::domain::service::test::{USER, configuration, grant_to, service, set_stored_owner};
use axum::{
    body::{Body, to_bytes},
    http::{Request, header},
};
use entity_access::domain::{
    models::{
        AccessError, AccessLevel, BotAccessScope, BotReceiptScope, CallChannelInfo, Entity,
        EntityAccessReceipt, EntityPermission, EntityType, RequiredPermission, UserTeamInfo,
    },
    ports::EntityAccessService,
};
use macro_authorization::{
    BOT_SCOPE_HEADER, BOT_TOKEN_HEADER, BotActingUserClaims, BotAuthentication, BotScope,
    InternalIdentityClaims, MacroAuthorizationError, MacroUserAuthentication,
};
use macro_user_id::{
    lowercased::Lowercase,
    user_id::{MacroUserId, MacroUserIdStr},
};
use model::user::UserContext;
use model_owner::Owner;
use rootcause::Report;
use serde_json::{Value, json};
use std::collections::HashMap;
use tower::ServiceExt;
use utoipa::OpenApi;

#[tokio::test]
async fn manual_execution_returns_sanitized_admission_errors_after_authorization() {
    use crate::domain::service::test::set_admission_error;
    use ai_billing::{AiAdmissionError, DenyReason};

    for (error, expected_status) in [
        (
            AiAdmissionError::Denied(DenyReason::AllowanceExhausted),
            StatusCode::PAYMENT_REQUIRED,
        ),
        (
            AiAdmissionError::Unavailable,
            StatusCode::SERVICE_UNAVAILABLE,
        ),
    ] {
        let svc = service(true);
        set_admission_error(&svc, error);
        let app = router_with(svc, FakeEntityAccessService::owner_only());
        let (status, created) =
            request(&app, "POST", "/scheduled-actions", "owner", legacy()).await;
        assert_eq!(status, StatusCode::CREATED);
        let url = format!(
            "/scheduled-actions/{}/execute",
            created["id"].as_str().unwrap()
        );
        let (status, body) = request(&app, "POST", &url, "owner", Value::Null).await;
        assert_eq!(status, expected_status);
        assert_eq!(
            body,
            json!({"code": error.code(), "error": error.to_string()})
        );
        let (status, body) = request(&app, "POST", &url, "stranger", Value::Null).await;
        assert_eq!(status, StatusCode::UNAUTHORIZED);
        assert_ne!(body["code"], error.code());
    }
}

#[tokio::test]
async fn remote_session_admission_uses_the_same_public_http_contract() {
    use ai_billing::{AiAdmissionError, DenyReason};
    for error in [
        AiAdmissionError::Denied(DenyReason::OverageLimitReached),
        AiAdmissionError::Unavailable,
    ] {
        let response = ScheduledActionApiError::from(anyhow::Error::new(
            RoutineSessionError::Admission(error),
        ))
        .into_response();
        assert_eq!(
            response.status(),
            ai_billing::inbound::admission::admission_status(error)
        );
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        let body: Value = serde_json::from_slice(&bytes).unwrap();
        assert_eq!(
            body,
            json!({"code": error.code(), "error": error.to_string()})
        );
    }
}

#[test]
fn manual_execution_documents_quota_and_retryable_validation_failures() {
    let schema = serde_json::to_value(crate::swagger::ApiDoc::openapi()).unwrap();
    let responses = &schema["paths"]["/scheduled-actions/{id}/execute"]["post"]["responses"];
    for status in ["402", "503"] {
        assert_eq!(
            responses[status]["content"]["application/json"]["schema"]["$ref"],
            "#/components/schemas/AiAdmissionErrorBody"
        );
    }
}

const OTHER: &str = "macro|other@macro.com";
const VIEWER: &str = "macro|viewer@macro.com";
const BOT_TOKEN: &str = "team-bot-token";
const TEAM_ID: macro_uuid::Uuid = macro_uuid::Uuid::from_u128(0x7EA4);

#[derive(Clone)]
struct FakeAuth;

impl MacroAuthorizationService for FakeAuth {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        match jwt {
            "owner" => Ok(UserContext {
                user_id: USER.into(),
                ..Default::default()
            }),
            "other" => Ok(UserContext {
                user_id: OTHER.into(),
                ..Default::default()
            }),
            "viewer" => Ok(UserContext {
                user_id: VIEWER.into(),
                ..Default::default()
            }),
            "stranger" => Ok(UserContext {
                user_id: "macro|stranger@macro.com".into(),
                ..Default::default()
            }),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }

    async fn authorize_bot(
        &self,
        bot_token: &str,
        bot_scope: BotScope,
        acting_user: Option<BotActingUserClaims>,
    ) -> Result<BotAuthentication, Report<MacroAuthorizationError>> {
        if bot_token != BOT_TOKEN {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(BotAuthentication {
            bot_id: bot_id::BotId::TEST_A,
            token_id: macro_uuid::Uuid::nil(),
            bot_scope,
            team_id: Some(TEAM_ID),
            acting_user: acting_user
                .and_then(|claims| claims.user_id)
                .map(|user_id| {
                    let macro_user_id = MacroUserIdStr::try_from(user_id).expect("acting user id");
                    MacroUserAuthentication {
                        user_context: UserContext {
                            user_id: macro_user_id.to_string(),
                            ..Default::default()
                        },
                        macro_user_id,
                    }
                }),
        })
    }

    async fn authorize_internal(
        &self,
        key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if key != "test-internal-key" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(claims.user_id.map(|user_id| UserContext {
            user_id,
            ..Default::default()
        }))
    }
}

#[derive(Clone)]
struct FakeEntityAccessService {
    levels: HashMap<String, AccessLevel>,
}

impl FakeEntityAccessService {
    fn owner_only() -> Self {
        Self {
            levels: HashMap::from([(USER.to_owned(), AccessLevel::Owner)]),
        }
    }

    fn with(levels: impl IntoIterator<Item = (&'static str, AccessLevel)>) -> Self {
        Self {
            levels: levels
                .into_iter()
                .map(|(user, level)| (user.to_owned(), level))
                .collect(),
        }
    }
}

impl EntityAccessService for FakeEntityAccessService {
    async fn generate_entity_access_receipt<T: RequiredPermission>(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _user_org_id: Option<i64>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        unimplemented!()
    }

    async fn generate_bot_entity_access_receipt<T: RequiredPermission>(
        &self,
        bot_id: bot_id::BotId,
        scope: BotAccessScope,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<EntityAccessReceipt<T>, AccessError> {
        let storage_id = bot_id.into_storage_id();
        let Some(level) = self.levels.get(storage_id.as_ref()).copied() else {
            return Err(AccessError::Unauthorized);
        };
        let scope = match scope {
            BotAccessScope::User { user_id, .. } => BotReceiptScope::User {
                acting_user: user_id,
            },
            BotAccessScope::Team { team_id } => BotReceiptScope::Team { team_id },
        };
        EntityAccessReceipt::try_new_bot(
            storage_id,
            scope,
            Entity {
                entity_id: entity_id.to_owned(),
                entity_type,
            },
            EntityPermission::AccessLevel {
                access_level: level,
            },
        )
    }

    async fn get_access_level(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Option<AccessLevel>, AccessError> {
        unimplemented!()
    }

    async fn check_access(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!()
    }

    async fn check_public_access(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
        _required_level: AccessLevel,
    ) -> Result<AccessLevel, AccessError> {
        unimplemented!()
    }

    async fn get_entity_permission(
        &self,
        user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        entity_type: EntityType,
        _user_org_id: Option<i64>,
    ) -> Result<EntityPermission, AccessError> {
        if entity_type != EntityType::ScheduledAction {
            return Err(AccessError::BadRequest("unsupported entity type"));
        }
        let Some(user_id) = user_id else {
            return Err(AccessError::Unauthorized);
        };
        let Some(level) = self.levels.get(user_id.as_ref()).copied() else {
            return Err(AccessError::Unauthorized);
        };
        Ok(EntityPermission::AccessLevel {
            access_level: level,
        })
    }

    async fn get_crm_entity_permission_with_team(
        &self,
        _user_id: Option<&MacroUserId<Lowercase<'_>>>,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<
        (
            EntityPermission,
            macro_uuid::Uuid,
            entity_access::domain::models::TeamRole,
        ),
        AccessError,
    > {
        unimplemented!()
    }

    async fn get_users_by_entity(
        &self,
        _entity_id: &str,
        _entity_type: EntityType,
    ) -> Result<Vec<macro_user_id::user_id::MacroUserIdStr<'static>>, AccessError> {
        unimplemented!()
    }

    async fn get_call_channel(
        &self,
        _call_id: &macro_uuid::Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unimplemented!()
    }

    async fn get_call_channel_by_channel_id(
        &self,
        _channel_id: &macro_uuid::Uuid,
    ) -> Result<Option<CallChannelInfo>, AccessError> {
        unimplemented!()
    }

    async fn get_user_team(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<Option<UserTeamInfo>, AccessError> {
        unimplemented!()
    }
}

fn router(events: bool) -> Router {
    router_with(service(events), FakeEntityAccessService::owner_only())
}

fn router_with<S: ScheduledActionService>(
    service: Arc<S>,
    access: FakeEntityAccessService,
) -> Router {
    scheduled_action_router(ScheduledActionRouterState {
        service,
        access_service: Arc::new(access),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuth)),
    })
}

async fn request(
    router: &Router,
    method: &str,
    uri: &str,
    token: &str,
    body: Value,
) -> (StatusCode, Value) {
    let response = router
        .clone()
        .oneshot(
            Request::builder()
                .method(method)
                .uri(uri)
                .header(header::AUTHORIZATION, format!("Bearer {token}"))
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body.to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    let status = response.status();
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let value =
        serde_json::from_slice(&bytes).unwrap_or_else(|_| json!(String::from_utf8_lossy(&bytes)));
    (status, value)
}

fn legacy() -> Value {
    json!({"name":"legacy", "kind":"Agent", "schedule":"0 0 9 * * *", "timezone":"UTC", "task":{"model":"model", "prompt":"instructions", "user_prompt":"task"}, "enabled":true})
}

#[tokio::test]
async fn legacy_and_canonical_cron_create_update_return_compatibility_fields() {
    let app = router(false);
    for input in [
        legacy(),
        serde_json::to_value(configuration(false)).unwrap(),
    ] {
        let (status, created) =
            request(&app, "POST", "/scheduled-actions", "owner", input.clone()).await;
        assert_eq!(status, StatusCode::CREATED);
        assert_eq!(created["owner"], USER);
        assert_eq!(created["trigger"]["type"], "cron");
        assert_eq!(created["schedule"], created["trigger"]["schedule"]);
        assert_eq!(created["timezone"], created["trigger"]["timezone"]);
        let url = format!("/scheduled-actions/{}", created["id"].as_str().unwrap());
        let (status, updated) = request(&app, "PUT", &url, "owner", input).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(updated["configuration_revision"], 2);
        assert_eq!(updated["created_at"], created["created_at"]);
    }
}

#[tokio::test]
async fn event_responses_and_opt_in_lists_do_not_invent_cron_fields() {
    let app = router(true);
    let mut input = serde_json::to_value(configuration(true)).unwrap();
    input["enabled"] = json!(false);
    let (status, event) = request(&app, "POST", "/scheduled-actions", "owner", input).await;
    assert_eq!(status, StatusCode::CREATED);
    assert!(event.get("schedule").is_none());
    assert!(event.get("timezone").is_none());
    assert!(event["next_run_at"].is_null());
    let (_, list) = request(&app, "GET", "/scheduled-actions", "owner", Value::Null).await;
    assert_eq!(list, json!([]));
    let (_, list) = request(
        &app,
        "GET",
        "/scheduled-actions?include_events=true",
        "owner",
        Value::Null,
    )
    .await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    let url = format!(
        "/scheduled-actions/{}/execute",
        event["id"].as_str().unwrap()
    );
    assert_eq!(
        request(&app, "POST", &url, "owner", Value::Null).await.0,
        StatusCode::OK
    );
}

#[tokio::test]
async fn mixed_unknown_and_server_owned_input_is_bad_request_for_create_and_update() {
    let app = router(true);
    let (_, created) = request(&app, "POST", "/scheduled-actions", "owner", legacy()).await;
    let url = format!("/scheduled-actions/{}", created["id"].as_str().unwrap());
    let mut invalid = vec![];
    for field in [
        "owner",
        "id",
        "claimed",
        "configuration_revision",
        "event_activated_at",
        "next_run_at",
        "created_at",
        "updated_at",
    ] {
        let mut input = legacy();
        input[field] = Value::Null;
        invalid.push(input);
    }
    for extra in [
        Value::Null,
        json!({"type":"cron", "schedule":"0 0 9 * * *", "timezone":"UTC"}),
        json!({"type":"events", "filters":[{"events":["document.created"]}]}),
    ] {
        let mut input = legacy();
        input["trigger"] = extra;
        invalid.push(input);
    }
    let mut canonical = serde_json::to_value(configuration(true)).unwrap();
    canonical["schedule"] = Value::Null;
    invalid.push(canonical);
    let mut bad_filter = serde_json::to_value(configuration(true)).unwrap();
    bad_filter["trigger"]["filters"] = json!([]);
    invalid.push(bad_filter);
    for input in invalid {
        assert_eq!(
            request(&app, "POST", "/scheduled-actions", "owner", input.clone())
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
        assert_eq!(
            request(&app, "PUT", &url, "owner", input).await.0,
            StatusCode::BAD_REQUEST
        );
    }
}

#[tokio::test]
async fn foreign_owner_operations_return_not_found_and_list_is_empty() {
    let app = router(true);
    let (_, action) = request(
        &app,
        "POST",
        "/scheduled-actions",
        "owner",
        serde_json::to_value(configuration(true)).unwrap(),
    )
    .await;
    let url = format!("/scheduled-actions/{}", action["id"].as_str().unwrap());
    for (method, path, body) in [
        ("PUT", url.clone(), legacy()),
        ("PUT", format!("{url}/enabled"), json!({"enabled": false})),
        ("DELETE", url.clone(), Value::Null),
        ("POST", format!("{url}/execute"), Value::Null),
        ("GET", format!("{url}/history"), Value::Null),
    ] {
        assert_eq!(
            request(&app, method, &path, "other", body).await.0,
            StatusCode::UNAUTHORIZED
        );
    }
    assert_eq!(
        request(
            &app,
            "GET",
            "/scheduled-actions?include_events=true",
            "other",
            Value::Null
        )
        .await
        .1,
        json!([])
    );
}

#[tokio::test]
async fn activation_endpoint_is_idempotent_and_accepts_only_enabled() {
    let app = router(false);
    let (_, created) = request(&app, "POST", "/scheduled-actions", "owner", legacy()).await;
    let url = format!(
        "/scheduled-actions/{}/enabled",
        created["id"].as_str().unwrap()
    );
    for _ in 0..2 {
        let (status, paused) = request(&app, "PUT", &url, "owner", json!({"enabled": false})).await;
        assert_eq!(status, StatusCode::OK);
        assert_eq!(paused["enabled"], false);
        assert_eq!(paused["configuration_revision"], 2);
        assert_eq!(paused["name"], "legacy");
        assert_eq!(paused["schedule"], "0 0 9 * * *");
    }
    for invalid in [
        json!({}),
        json!({"enabled": "false"}),
        json!({"enabled": true, "name": "renamed"}),
    ] {
        assert_eq!(
            request(&app, "PUT", &url, "owner", invalid).await.0,
            StatusCode::BAD_REQUEST
        );
    }
    let (status, resumed) = request(&app, "PUT", &url, "owner", json!({"enabled": true})).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(resumed["enabled"], true);
    assert_eq!(resumed["configuration_revision"], 3);
}

#[tokio::test]
async fn event_management_off_and_expired_cron_are_bad_requests() {
    let app = router(false);
    assert_eq!(
        request(
            &app,
            "POST",
            "/scheduled-actions",
            "owner",
            serde_json::to_value(configuration(true)).unwrap()
        )
        .await
        .0,
        StatusCode::BAD_REQUEST
    );
    let mut input = legacy();
    input["schedule"] = json!("0 0 0 1 1 * 2000");
    assert_eq!(
        request(&app, "POST", "/scheduled-actions", "owner", input)
            .await
            .0,
        StatusCode::BAD_REQUEST
    );
}

#[tokio::test]
async fn authenticates_user_and_internal_requests_and_rejects_missing_credentials() {
    let app = router(false);
    let no_auth = Request::builder()
        .uri("/scheduled-actions")
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.clone().oneshot(no_auth).await.unwrap().status(),
        StatusCode::UNAUTHORIZED
    );
    let internal = Request::builder()
        .uri("/scheduled-actions")
        .header(
            macro_authorization::INTERNAL_API_KEY_HEADER,
            "test-internal-key",
        )
        .header(macro_authorization::INTERNAL_MACRO_USER_ID_HEADER, USER)
        .body(Body::empty())
        .unwrap();
    assert_eq!(
        app.oneshot(internal).await.unwrap().status(),
        StatusCode::OK
    );
}

#[tokio::test]
async fn maps_typed_errors_and_sanitizes_internal_failures() {
    for (error, expected) in [
        (
            anyhow::Error::from(ActionPolicyError::NotFound),
            StatusCode::NOT_FOUND,
        ),
        (
            anyhow::Error::from(ActionPolicyError::UpdateConflict),
            StatusCode::CONFLICT,
        ),
        (
            anyhow::Error::from(AlreadyRunningError {
                action_id: macro_uuid::generate_uuid_v7(),
            }),
            StatusCode::CONFLICT,
        ),
        (
            anyhow::Error::from(OwnerNotUserError {
                owner_type: model_owner::OwnerType::Bot,
            }),
            StatusCode::BAD_REQUEST,
        ),
        (
            anyhow::anyhow!("secret database details"),
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
    ] {
        let response = ScheduledActionApiError::from(error).into_response();
        assert_eq!(response.status(), expected);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("secret"));
    }
}

#[tokio::test]
async fn target_errors_have_deliberate_sanitized_status_codes() {
    for (error, expected) in [
        (
            TargetValidationError::InvalidTask.into(),
            StatusCode::BAD_REQUEST,
        ),
        (
            TargetValidationError::AgentsDisabled.into(),
            StatusCode::BAD_REQUEST,
        ),
        (
            TargetValidationError::ExplicitAgentRequired.into(),
            StatusCode::CONFLICT,
        ),
        (
            RoutineSessionError::InvalidCommand.into(),
            StatusCode::BAD_REQUEST,
        ),
        (
            RoutineSessionError::ModelMismatch.into(),
            StatusCode::BAD_REQUEST,
        ),
        (
            RoutineSessionError::PersonaUnavailable.into(),
            StatusCode::NOT_FOUND,
        ),
        (RoutineSessionError::Forbidden.into(), StatusCode::FORBIDDEN),
        (RoutineSessionError::Conflict.into(), StatusCode::CONFLICT),
        (
            RoutineSessionError::RuntimeUnavailable.into(),
            StatusCode::SERVICE_UNAVAILABLE,
        ),
        (
            RoutineSessionError::OperationFailed.into(),
            StatusCode::SERVICE_UNAVAILABLE,
        ),
        (
            RoutineSessionError::PromptDeliveryUnknown.into(),
            StatusCode::SERVICE_UNAVAILABLE,
        ),
        (
            RoutineSessionError::SessionMismatch.into(),
            StatusCode::INTERNAL_SERVER_ERROR,
        ),
    ] {
        let error: anyhow::Error = error;
        let response = ScheduledActionApiError::from(error.context("secret upstream diagnostics"))
            .into_response();
        assert_eq!(response.status(), expected);
        let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert!(!String::from_utf8_lossy(&bytes).contains("secret"));
    }
}

#[tokio::test]
async fn target_configuration_is_validated_through_http_and_gate_defaults_off() {
    use crate::domain::target_validation::test::agent_task;
    let app = router(false);
    let mut input = legacy();
    for task in [json!({}), agent_task()] {
        input["task"] = task;
        assert_eq!(
            request(&app, "POST", "/scheduled-actions", "owner", input.clone())
                .await
                .0,
            StatusCode::BAD_REQUEST
        );
    }
    assert_eq!(
        request(&app, "POST", "/scheduled-actions", "owner", legacy())
            .await
            .0,
        StatusCode::CREATED
    );
}

#[tokio::test]
async fn agent_replacement_requires_explicit_null_and_unavailable_agent_remains_manageable() {
    use crate::domain::{
        service::test::{FakeExecutor, FakeGrants, FakeRepo, TestService},
        target_validation::{
            TargetValidation,
            test::{Sessions, agent_task},
        },
    };
    let sessions = Arc::new(Sessions::default());
    let (tx, mut rx) = tokio::sync::mpsc::channel(32);
    tokio::spawn(async move { while rx.recv().await.is_some() {} });
    let repo = Arc::new(FakeRepo::default());
    let svc = TestService::new(
        repo.clone(),
        Arc::new(FakeExecutor::default()),
        tx,
        Arc::new(FakeGrants::all(repo)),
    )
    .with_target_validation(TargetValidation::new(sessions.clone(), true));
    let app = router_with(Arc::new(svc), FakeEntityAccessService::owner_only());
    let mut input = legacy();
    input["task"] = agent_task();
    assert_eq!(
        request(&app, "POST", "/scheduled-actions", "other", input.clone())
            .await
            .0,
        StatusCode::FORBIDDEN
    );
    let (status, created) =
        request(&app, "POST", "/scheduled-actions", "owner", input.clone()).await;
    assert_eq!(status, StatusCode::CREATED);
    let url = format!("/scheduled-actions/{}", created["id"].as_str().unwrap());
    let (status, message) = request(&app, "PUT", &url, "owner", legacy()).await;
    assert_eq!(status, StatusCode::CONFLICT);
    assert!(message.as_str().unwrap().contains("reload or upgrade"));

    *sessions.error.lock().unwrap() = Some(RoutineSessionError::RuntimeUnavailable);
    assert_eq!(
        request(&app, "PUT", &url, "owner", input.clone()).await.0,
        StatusCode::SERVICE_UNAVAILABLE
    );
    input["enabled"] = json!(false);
    assert_eq!(
        request(&app, "PUT", &url, "owner", input).await.0,
        StatusCode::OK
    );
    assert_eq!(
        request(&app, "GET", &format!("{url}/history"), "owner", Value::Null)
            .await
            .0,
        StatusCode::OK
    );
    let mut model = legacy();
    model["task"]["agent"] = Value::Null;
    assert_eq!(
        request(&app, "PUT", &url, "owner", model).await.0,
        StatusCode::OK
    );
    assert_eq!(
        request(&app, "DELETE", &url, "owner", Value::Null).await.0,
        StatusCode::NO_CONTENT
    );
}

#[test]
fn openapi_documents_canonical_legacy_and_event_opt_in_contracts() {
    let spec = serde_json::to_value(crate::swagger::ApiDoc::openapi()).unwrap();
    let schemas = &spec["components"]["schemas"];
    for name in [
        "ActionConfiguration",
        "ActionConfigurationUpdate",
        "LegacyActionConfiguration",
        "ActionTrigger",
        "EventFilters",
        "EventName",
        "ScheduledActionResponse",
        "CreateScheduledAction",
        "UpdateScheduledAction",
        "SetScheduledActionEnabled",
    ] {
        assert!(!schemas[name].is_null(), "missing {name}");
    }
    let update = &schemas["ActionConfigurationUpdate"];
    assert_eq!(
        update["required"],
        json!(["name", "trigger", "kind", "task"])
    );
    assert_eq!(update["properties"]["enabled"]["deprecated"], true);
    assert_eq!(
        schemas["SetScheduledActionEnabled"]["additionalProperties"],
        false
    );
    assert_eq!(
        spec["paths"]["/scheduled-actions/{id}/enabled"]["put"]["operationId"],
        "set_scheduled_action_enabled"
    );
    let legacy_properties = &schemas["ScheduledActionResponse"]["allOf"][1]["properties"];
    assert_eq!(legacy_properties["schedule"]["deprecated"], true);
    assert_eq!(legacy_properties["timezone"]["deprecated"], true);
    assert_eq!(schemas["EventFilters"]["type"], "array");
    assert_eq!(
        schemas["ActionConfiguration"]["additionalProperties"],
        false
    );
    assert_eq!(
        schemas["LegacyActionConfiguration"]["additionalProperties"],
        false
    );
    let params = spec["paths"]["/scheduled-actions"]["get"]["parameters"]
        .as_array()
        .unwrap();
    assert!(
        params
            .iter()
            .any(|p| p["name"] == "include_events" && p["required"] == false)
    );
    assert!(!spec["paths"]["/scheduled-actions/{id}"]["put"]["responses"]["409"].is_null());
    assert!(!spec["paths"]["/scheduled-actions"]["post"]["responses"]["403"].is_null());
}

#[tokio::test]
async fn editor_can_update_another_owners_row_but_cannot_delete_it() {
    let svc = service(true);
    let app = router_with(
        svc.clone(),
        FakeEntityAccessService::with([
            (USER, AccessLevel::Owner),
            (OTHER, AccessLevel::Edit),
            (VIEWER, AccessLevel::View),
        ]),
    );
    let (_, created) = request(&app, "POST", "/scheduled-actions", "owner", legacy()).await;
    let id = macro_uuid::Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    set_stored_owner(
        svc.as_ref(),
        id,
        Owner::from_principal_str("macro|stored-owner@macro.com").unwrap(),
    );
    let url = format!("/scheduled-actions/{id}");
    let (status, updated) = request(&app, "PUT", &url, "other", legacy()).await;
    assert_eq!(status, StatusCode::OK);
    assert_eq!(updated["owner"], "macro|stored-owner@macro.com");
    assert_eq!(
        request(&app, "PUT", &url, "viewer", legacy()).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(&app, "DELETE", &url, "other", Value::Null).await.0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("{url}/history"),
            "viewer",
            Value::Null
        )
        .await
        .0,
        StatusCode::OK
    );
    assert_eq!(
        request(
            &app,
            "GET",
            &format!("{url}/history"),
            "stranger",
            Value::Null
        )
        .await
        .0,
        StatusCode::UNAUTHORIZED
    );
    assert_eq!(
        request(&app, "DELETE", &url, "owner", Value::Null).await.0,
        StatusCode::NO_CONTENT
    );
}

#[tokio::test]
async fn executing_a_bot_owned_row_returns_the_owner_message() {
    let svc = service(true);
    let app = router_with(svc.clone(), FakeEntityAccessService::owner_only());
    let (_, created) = request(&app, "POST", "/scheduled-actions", "owner", legacy()).await;
    let id = macro_uuid::Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    set_stored_owner(svc.as_ref(), id, Owner::Bot(bot_id::BotId::TEST_A));
    let (status, body) = request(
        &app,
        "POST",
        &format!("/scheduled-actions/{id}/execute"),
        "owner",
        Value::Null,
    )
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert!(body.as_str().unwrap().contains("owner is a bot"));
}

#[tokio::test]
async fn bare_internal_key_on_an_id_route_is_unauthorized() {
    let app = router(false);
    let response = app
        .oneshot(
            Request::builder()
                .method("POST")
                .uri(format!(
                    "/scheduled-actions/{}/execute",
                    macro_uuid::generate_uuid_v7()
                ))
                .header(
                    macro_authorization::INTERNAL_API_KEY_HEADER,
                    "test-internal-key",
                )
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}

#[tokio::test]
async fn team_bot_create_returns_400_with_the_owner_message() {
    let svc = service(false);
    let app = router_with(svc.clone(), FakeEntityAccessService::owner_only());
    let response = app
        .clone()
        .oneshot(
            Request::builder()
                .method("POST")
                .uri("/scheduled-actions")
                .header(BOT_TOKEN_HEADER, BOT_TOKEN)
                .header(BOT_SCOPE_HEADER, "team")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(legacy().to_string()))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let bytes = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let body = String::from_utf8_lossy(&bytes);
    assert!(body.contains("owner is a bot"));
    let (_, list) = request(&app, "GET", "/scheduled-actions", "owner", Value::Null).await;
    assert_eq!(list, json!([]));
}

#[tokio::test]
async fn list_as_grantee_includes_the_granted_routine() {
    let svc = service(true);
    let app = router_with(svc.clone(), FakeEntityAccessService::owner_only());
    let (_, created) = request(
        &app,
        "POST",
        "/scheduled-actions",
        "owner",
        serde_json::to_value(configuration(true)).unwrap(),
    )
    .await;
    let id = macro_uuid::Uuid::parse_str(created["id"].as_str().unwrap()).unwrap();
    grant_to(svc.as_ref(), OTHER, id);
    let (_, list) = request(
        &app,
        "GET",
        "/scheduled-actions?include_events=true",
        "other",
        Value::Null,
    )
    .await;
    assert_eq!(list.as_array().unwrap().len(), 1);
    assert_eq!(list[0]["id"], created["id"]);
}
