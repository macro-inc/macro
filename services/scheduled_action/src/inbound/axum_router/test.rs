use super::*;
use crate::domain::service::test::{USER, configuration, service};
use axum::{
    body::{Body, to_bytes},
    http::{Request, header},
};
use macro_authorization::{InternalIdentityClaims, MacroAuthorizationError};
use model::user::UserContext;
use rootcause::Report;
use serde_json::{Value, json};
use tower::ServiceExt;
use utoipa::OpenApi;

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
                user_id: "macro|other@macro.com".into(),
                ..Default::default()
            }),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
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

fn router(events: bool) -> Router {
    scheduled_action_router(ScheduledActionRouterState {
        service: service(events),
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
    json!({"name":"legacy", "kind":"Agent", "schedule":"0 0 9 * * *", "timezone":"UTC", "task":{}, "enabled":true})
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
        ("DELETE", url.clone(), Value::Null),
        ("POST", format!("{url}/execute"), Value::Null),
        ("GET", format!("{url}/history"), Value::Null),
    ] {
        assert_eq!(
            request(&app, method, &path, "other", body).await.0,
            StatusCode::NOT_FOUND
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

#[test]
fn openapi_documents_canonical_legacy_and_event_opt_in_contracts() {
    let spec = serde_json::to_value(crate::swagger::ApiDoc::openapi()).unwrap();
    let schemas = &spec["components"]["schemas"];
    for name in [
        "ActionConfiguration",
        "LegacyActionConfiguration",
        "ActionTrigger",
        "EventFilters",
        "EventName",
        "ScheduledActionResponse",
        "CreateScheduledAction",
        "UpdateScheduledAction",
    ] {
        assert!(!schemas[name].is_null(), "missing {name}");
    }
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
}
