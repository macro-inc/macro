use super::*;
use crate::domain::{Memory, Result, models::Activity};
use axum::{body::Body, http::Request};
use macro_authorization::{InternalIdentityClaims, MacroAuthorizationError};
use model_user::UserContext;
use rootcause::Report;
use std::sync::Mutex;
use tower::ServiceExt;

const CALLER: &str = "macro|caller@example.com";

#[derive(Clone)]
struct FakeAuthorization;

impl MacroAuthorizationService for FakeAuthorization {
    async fn authorize(
        &self,
        jwt: &str,
    ) -> std::result::Result<UserContext, Report<MacroAuthorizationError>> {
        if jwt != "valid" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(UserContext {
            user_id: CALLER.to_string(),
            fusion_user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
            permissions: None,
            organization_id: None,
        })
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> std::result::Result<
        macro_authorization::ValidatedCredential,
        Report<MacroAuthorizationError>,
    > {
        self.authorize(jwt)
            .await
            .map(macro_authorization::ValidatedCredential::session)
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> std::result::Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

/// Records each call and answers like a memory whose revision is 7, and
/// whose only visible activity is the caller's own.
#[derive(Default)]
struct FakeMemoryService {
    calls: Mutex<Vec<String>>,
}

impl MemoryService for FakeMemoryService {
    async fn get_memory(&self, _user: MacroUserIdStr<'static>) -> Result<Option<Memory>> {
        unimplemented!("not routed in these tests")
    }

    async fn explicit(&self, user: &MacroUserIdStr<'_>) -> Result<ExplicitMemory> {
        self.calls.lock().unwrap().push(format!("explicit {user}"));
        Ok(ExplicitMemory {
            content: "Prefers metric units".to_string(),
            revision: 7,
        })
    }

    async fn update_memory(
        &self,
        user: MacroUserIdStr<'static>,
        revision: i64,
        _edit: &MemoryEdit,
    ) -> Result<ExplicitMemory> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("update {user} {revision}"));
        if revision != 7 {
            return Err(MemoryError::Conflict);
        }
        Ok(ExplicitMemory {
            content: "Prefers metric units\nWorks in UTC".to_string(),
            revision: 8,
        })
    }

    async fn get_user_activity(
        &self,
        caller: MacroUserIdStr<'static>,
        user: MacroUserIdStr<'static>,
        start: NaiveDate,
        end: NaiveDate,
    ) -> Result<Vec<Activity>> {
        self.calls
            .lock()
            .unwrap()
            .push(format!("activity {caller} {user} {start} {end}"));
        if caller != user {
            return Err(MemoryError::Forbidden);
        }
        Ok(Vec::new())
    }
}

async fn send(service: &Arc<FakeMemoryService>, request: Request<Body>) -> (StatusCode, String) {
    let router: Router = memory_router(MemoryRouterState {
        service: service.clone(),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuthorization)),
    });
    let response = router.oneshot(request).await.unwrap();
    let status = response.status();
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, String::from_utf8(body.to_vec()).unwrap())
}

#[tokio::test]
async fn explicit_memory_is_read_and_edited_as_the_caller() {
    let service = Arc::new(FakeMemoryService::default());

    let read = send(
        &service,
        Request::get("/memory/explicit")
            .header("authorization", "Bearer valid")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    let edited = send(
        &service,
        Request::patch("/memory/explicit")
            .header("authorization", "Bearer valid")
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"revision":7,"edit":{"action":"insert","line":2,"content":"Works in UTC"}}"#,
            ))
            .unwrap(),
    )
    .await;
    let stale = send(
        &service,
        Request::patch("/memory/explicit")
            .header("authorization", "Bearer valid")
            .header("content-type", "application/json")
            .body(Body::from(
                r#"{"revision":6,"edit":{"action":"delete","line":1}}"#,
            ))
            .unwrap(),
    )
    .await;

    assert_eq!(
        read,
        (
            StatusCode::OK,
            r#"{"content":"Prefers metric units","revision":7}"#.to_string()
        )
    );
    assert_eq!(
        edited,
        (
            StatusCode::OK,
            r#"{"content":"Prefers metric units\nWorks in UTC","revision":8}"#.to_string()
        )
    );
    assert_eq!(
        stale,
        (
            StatusCode::CONFLICT,
            r#"{"error":"memory changed; read it again before retrying the edit"}"#.to_string()
        )
    );
    assert_eq!(
        *service.calls.lock().unwrap(),
        vec![
            "explicit macro|caller@example.com",
            "update macro|caller@example.com 7",
            "update macro|caller@example.com 6",
        ]
    );
}

#[tokio::test]
async fn user_activity_defaults_to_the_caller_and_forbids_strangers() {
    let service = Arc::new(FakeMemoryService::default());

    let own = send(
        &service,
        Request::get("/memory/activity?start=2026-10-01&end=2026-10-31")
            .header("authorization", "Bearer valid")
            .body(Body::empty())
            .unwrap(),
    )
    .await;
    let stranger = send(
        &service,
        Request::get(
            "/memory/activity?user=macro%7Cstranger%40example.com&start=2026-10-01&end=2026-10-31",
        )
        .header("authorization", "Bearer valid")
        .body(Body::empty())
        .unwrap(),
    )
    .await;
    let invalid = send(
        &service,
        Request::get("/memory/activity?user=stranger&start=2026-10-01&end=2026-10-31")
            .header("authorization", "Bearer valid")
            .body(Body::empty())
            .unwrap(),
    )
    .await;

    assert_eq!(own, (StatusCode::OK, r#"{"reports":[]}"#.to_string()));
    assert_eq!(stranger.0, StatusCode::FORBIDDEN);
    assert_eq!(invalid.0, StatusCode::BAD_REQUEST);
    assert_eq!(
        *service.calls.lock().unwrap(),
        vec![
            "activity macro|caller@example.com macro|caller@example.com 2026-10-01 2026-10-31",
            "activity macro|caller@example.com macro|stranger@example.com 2026-10-01 2026-10-31",
        ]
    );
}
