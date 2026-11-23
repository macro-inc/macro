use axum::{
    body::Body,
    http::{Request, header},
};
use chrono::TimeDelta;
use http_body_util::BodyExt;
use macro_authorization::{InternalIdentityClaims, MacroAuthorizationError, ValidatedCredential};
use model_user::UserContext;
use rootcause::Report;
use serde_json::{Value, json};
use tower::ServiceExt;

use super::*;
use crate::{
    domain::service::TimeTrackingServiceImpl,
    test_support::{
        AUTHOR, EDITOR, FakeAccess, FakeRepo, FixedRollout, OUTSIDER, RecordingPublisher, TASK,
        TestClock, VIEWER, noon,
    },
};

/// A bearer token is the user id it stands for.
#[derive(Clone)]
struct BearerIsUser;

impl MacroAuthorizationService for BearerIsUser {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if !jwt.starts_with("macro|") {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(UserContext {
            user_id: jwt.to_string(),
            fusion_user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
            permissions: None,
            organization_id: None,
        })
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<ValidatedCredential, Report<MacroAuthorizationError>> {
        self.authorize(jwt).await.map(ValidatedCredential::session)
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

type Service = TimeTrackingServiceImpl<FakeRepo, FakeAccess, RecordingPublisher, TestClock>;

struct App {
    router: Router,
    clock: TestClock,
}

fn app() -> App {
    let access = Arc::new(FakeAccess::team());
    let clock = TestClock::at(noon());
    let service: Service = TimeTrackingServiceImpl::new(
        FakeRepo::with_live_tasks(&[TASK]),
        access.clone(),
        Arc::new(FixedRollout(true)),
        RecordingPublisher::default(),
    )
    .with_clock(clock.clone());
    let router = time_tracking_router(TimeTrackingRouterState::new(
        Arc::new(service),
        access,
        MacroAuthorizationState::new(Arc::new(BearerIsUser)),
    ));
    App { router, clock }
}

async fn send(
    app: &App,
    user_id: &str,
    method: &str,
    path: &str,
    body: Option<Value>,
) -> (StatusCode, Value) {
    let builder = Request::builder()
        .method(method)
        .uri(path)
        .header(header::AUTHORIZATION, format!("Bearer {user_id}"));
    let request = match body {
        Some(body) => builder
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.to_string())),
        None => builder.body(Body::empty()),
    }
    .unwrap();
    let response = app.router.clone().oneshot(request).await.unwrap();
    let status = response.status();
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let json = if bytes.is_empty() {
        Value::Null
    } else {
        serde_json::from_slice(&bytes)
            .unwrap_or_else(|_| Value::String(String::from_utf8_lossy(&bytes).into_owned()))
    };
    (status, json)
}

fn entries_path() -> String {
    format!("/tasks/{TASK}/entries")
}

#[tokio::test]
async fn an_editor_logs_time_and_a_viewer_reads_it_but_cannot_log() {
    let app = app();

    let (logged, body) = send(
        &app,
        EDITOR,
        "POST",
        &entries_path(),
        Some(json!({"date": "2026-11-20", "minutes": 90, "note": "drafting"})),
    )
    .await;
    let (refused, refusal) = send(
        &app,
        VIEWER,
        "POST",
        &entries_path(),
        Some(json!({"date": "2026-11-20", "minutes": 30})),
    )
    .await;
    let (listed, page) = send(&app, VIEWER, "GET", &entries_path(), None).await;

    assert_eq!(logged, StatusCode::OK);
    assert_eq!(body["totalMinutes"], 90);
    assert_eq!(body["entry"]["minutes"], 90);
    assert_eq!(body["entry"]["source"], "manual");
    assert_eq!(body["entry"]["userId"], EDITOR);
    assert_eq!(refused, StatusCode::FORBIDDEN);
    assert_eq!(refusal["code"], "forbidden");
    assert_eq!(listed, StatusCode::OK);
    assert_eq!(page["totalMinutes"], 90);
    assert_eq!(page["entries"].as_array().unwrap().len(), 1);
    assert_eq!(page["nextCursor"], Value::Null);
}

#[tokio::test]
async fn someone_without_access_to_the_task_gets_not_found() {
    let app = app();

    let (status, body) = send(&app, OUTSIDER, "GET", &entries_path(), None).await;

    assert_eq!(status, StatusCode::NOT_FOUND);
    assert_eq!(body["code"], "not_found");
}

#[tokio::test]
async fn only_the_author_changes_an_entry() {
    let app = app();
    let (_, logged) = send(
        &app,
        AUTHOR,
        "POST",
        &entries_path(),
        Some(json!({"date": "2026-11-20", "minutes": 45, "note": "first pass"})),
    )
    .await;
    let entry_path = format!("/entries/{}", logged["entry"]["id"].as_str().unwrap());

    let (not_author, refusal) = send(
        &app,
        EDITOR,
        "PATCH",
        &entry_path,
        Some(json!({"minutes": 5})),
    )
    .await;
    let (edited, body) = send(
        &app,
        AUTHOR,
        "PATCH",
        &entry_path,
        Some(json!({"minutes": 60, "note": null})),
    )
    .await;
    let (deleted, total) = send(&app, AUTHOR, "DELETE", &entry_path, None).await;

    assert_eq!(not_author, StatusCode::FORBIDDEN);
    assert_eq!(refusal["code"], "not_author");
    assert_eq!(edited, StatusCode::OK);
    assert_eq!(body["entry"]["minutes"], 60);
    assert_eq!(body["entry"]["note"], Value::Null);
    assert_eq!(deleted, StatusCode::OK);
    assert_eq!(total, json!({"totalMinutes": 0}));
}

#[tokio::test]
async fn a_misspelled_field_is_refused_and_changes_nothing() {
    let app = app();
    let (_, logged) = send(
        &app,
        AUTHOR,
        "POST",
        &entries_path(),
        Some(json!({"date": "2026-11-20", "minutes": 45})),
    )
    .await;
    let entry_path = format!("/entries/{}", logged["entry"]["id"].as_str().unwrap());

    let (edit, _) = send(
        &app,
        AUTHOR,
        "PATCH",
        &entry_path,
        Some(json!({"minute": 30})),
    )
    .await;
    let (log, _) = send(
        &app,
        AUTHOR,
        "POST",
        &entries_path(),
        Some(json!({"date": "2026-11-20", "minutes": 15, "notes": "drafting"})),
    )
    .await;
    let (_, page) = send(&app, AUTHOR, "GET", &entries_path(), None).await;

    assert_eq!(edit, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(log, StatusCode::UNPROCESSABLE_ENTITY);
    assert_eq!(page["totalMinutes"], 45);
    assert_eq!(page["entries"].as_array().unwrap().len(), 1);
    assert_eq!(page["entries"][0]["minutes"], 45);
}

#[tokio::test]
async fn a_timer_past_the_limit_is_answered_with_the_timer_to_resolve() {
    let app = app();
    let (started, body) = send(
        &app,
        AUTHOR,
        "POST",
        "/timer/start",
        Some(json!({"taskId": TASK, "timeZone": "America/New_York"})),
    )
    .await;
    let timer_id = body["timer"]["id"].as_str().unwrap().to_string();
    app.clock.advance(TimeDelta::hours(9));

    let (over, refusal) = send(
        &app,
        AUTHOR,
        "POST",
        "/timer/stop",
        Some(json!({"timerId": timer_id})),
    )
    .await;
    let (both, invalid) = send(
        &app,
        AUTHOR,
        "POST",
        "/timer/stop",
        Some(json!({"timerId": timer_id, "logAll": true, "endedAt": "2026-11-20T13:00:00Z"})),
    )
    .await;
    let (stopped, saved) = send(
        &app,
        AUTHOR,
        "POST",
        "/timer/stop",
        Some(json!({"timerId": timer_id, "endedAt": "2026-11-20T13:00:00Z"})),
    )
    .await;
    let (_, state) = send(&app, AUTHOR, "GET", "/timer", None).await;

    assert_eq!(started, StatusCode::OK);
    assert_eq!(over, StatusCode::CONFLICT);
    assert_eq!(refusal["code"], "timer_over_limit");
    assert_eq!(refusal["timer"]["id"], timer_id);
    assert_eq!(refusal["timer"]["taskId"], TASK);
    assert_eq!(both, StatusCode::BAD_REQUEST);
    assert_eq!(invalid["code"], "invalid_input");
    assert_eq!(stopped, StatusCode::OK);
    assert_eq!(saved["logged"]["entry"]["minutes"], 60);
    assert_eq!(saved["logged"]["entry"]["source"], "timer");
    assert_eq!(state["timer"], Value::Null);
}

#[tokio::test]
async fn a_viewer_cannot_start_a_timer_and_a_discarded_timer_saves_nothing() {
    let app = app();
    let (refused, refusal) = send(
        &app,
        VIEWER,
        "POST",
        "/timer/start",
        Some(json!({"taskId": TASK})),
    )
    .await;
    let (_, body) = send(
        &app,
        AUTHOR,
        "POST",
        "/timer/start",
        Some(json!({"taskId": TASK})),
    )
    .await;
    let timer_id = body["timer"]["id"].as_str().unwrap().to_string();

    let (discarded, empty) = send(
        &app,
        AUTHOR,
        "POST",
        "/timer/discard",
        Some(json!({"timerId": timer_id})),
    )
    .await;
    let (_, late_stop) = send(
        &app,
        AUTHOR,
        "POST",
        "/timer/stop",
        Some(json!({"timerId": timer_id})),
    )
    .await;

    assert_eq!(refused, StatusCode::FORBIDDEN);
    assert_eq!(refusal["code"], "forbidden");
    assert_eq!(discarded, StatusCode::NO_CONTENT);
    assert_eq!(empty, Value::Null);
    assert_eq!(late_stop, json!({"logged": null}));
}

#[tokio::test]
async fn a_half_given_cursor_or_an_unknown_zone_is_a_bad_request() {
    let app = app();

    let (cursor, _) = send(
        &app,
        VIEWER,
        "GET",
        &format!("{}?cursorDate=2026-11-20", entries_path()),
        None,
    )
    .await;
    let (zone, body) = send(
        &app,
        AUTHOR,
        "POST",
        "/timer/start",
        Some(json!({"taskId": TASK, "timeZone": "Mars/Olympus_Mons"})),
    )
    .await;

    assert_eq!(cursor, StatusCode::BAD_REQUEST);
    assert_eq!(zone, StatusCode::BAD_REQUEST);
    assert_eq!(body["code"], "invalid_input");
}
