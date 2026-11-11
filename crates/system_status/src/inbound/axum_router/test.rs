use std::sync::Arc;

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use macro_authorization::{
    InternalIdentityClaims, MacroAuthorizationError, MacroAuthorizationService,
    MacroAuthorizationState,
};
use model_user::UserContext;
use rootcause::Report;
use serde_json::{Value, json};
use tower::ServiceExt;

use crate::domain::{
    fakes::{FakeBroadcaster, FakeRepo},
    service::SystemStatusServiceImpl,
};
use crate::inbound::axum_router::{SystemStatusRouterState, system_status_router};

const STAFF_JWT: &str = "staff";
const OUTSIDER_JWT: &str = "outsider";
const STAFF_USER_ID: &str = "macro|oncall@macro.com";
const OUTSIDER_USER_ID: &str = "macro|ada@example.com";

#[derive(Clone)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, jwt: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        let user_id = match jwt {
            STAFF_JWT => STAFF_USER_ID,
            OUTSIDER_JWT => OUTSIDER_USER_ID,
            _ => return Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        };
        Ok(UserContext {
            user_id: user_id.to_string(),
            fusion_user_id: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb".to_string(),
            permissions: None,
            organization_id: None,
        })
    }

    async fn authorize_identity(
        &self,
        jwt: &str,
    ) -> Result<macro_authorization::ValidatedCredential, Report<MacroAuthorizationError>> {
        self.authorize(jwt)
            .await
            .map(macro_authorization::ValidatedCredential::session)
    }

    async fn authorize_internal(
        &self,
        _provided_key: &str,
        _claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        Err(Report::new(MacroAuthorizationError::InvalidCredentials))
    }
}

fn router() -> axum::Router {
    system_status_router(SystemStatusRouterState {
        service: Arc::new(SystemStatusServiceImpl::new(
            FakeRepo::default(),
            FakeBroadcaster::default(),
        )),
        authorization_state: MacroAuthorizationState::new(Arc::new(FakeAuthorizationService)),
    })
}

fn post(jwt: Option<&str>, body: Value) -> Request<Body> {
    let mut request = Request::post("/").header(header::CONTENT_TYPE, "application/json");
    if let Some(jwt) = jwt {
        request = request.header(header::AUTHORIZATION, format!("Bearer {jwt}"));
    }
    request.body(Body::from(body.to_string())).unwrap()
}

fn get(uri: &str, jwt: Option<&str>) -> Request<Body> {
    let mut request = Request::get(uri);
    if let Some(jwt) = jwt {
        request = request.header(header::AUTHORIZATION, format!("Bearer {jwt}"));
    }
    request.body(Body::empty()).unwrap()
}

async fn read_json(response: axum::response::Response) -> Value {
    let body = response.into_body().collect().await.unwrap().to_bytes();
    serde_json::from_slice(&body).unwrap()
}

#[tokio::test]
async fn anyone_reads_the_status_staff_set() {
    let app = router();

    let set = app
        .clone()
        .oneshot(post(
            Some(STAFF_JWT),
            json!({ "status": "major_outage", "message": "Macro is down" }),
        ))
        .await
        .unwrap();
    assert_eq!(set.status(), StatusCode::OK);
    let update = read_json(set).await;
    assert_eq!(update["status"], "major_outage");
    assert_eq!(update["message"], "Macro is down");
    assert_eq!(update["userId"], STAFF_USER_ID);

    let current = app.oneshot(get("/", None)).await.unwrap();
    assert_eq!(current.status(), StatusCode::OK);
    let current = read_json(current).await;
    assert_eq!(
        current,
        json!({
            "status": "major_outage",
            "message": "Macro is down",
            "id": update["id"],
            "updatedAt": update["createdAt"],
        })
    );
}

#[tokio::test]
async fn only_staff_set_status_or_read_history() {
    let app = router();
    let body = json!({ "status": "degraded", "message": "Slow" });

    let anonymous = app.clone().oneshot(post(None, body.clone())).await.unwrap();
    let outsider = app
        .clone()
        .oneshot(post(Some(OUTSIDER_JWT), body))
        .await
        .unwrap();
    let outsider_history = app
        .clone()
        .oneshot(get("/history", Some(OUTSIDER_JWT)))
        .await
        .unwrap();
    let staff_history = app.oneshot(get("/history", Some(STAFF_JWT))).await.unwrap();

    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(outsider.status(), StatusCode::FORBIDDEN);
    assert_eq!(outsider_history.status(), StatusCode::FORBIDDEN);
    assert_eq!(staff_history.status(), StatusCode::OK);
    assert_eq!(read_json(staff_history).await, json!({ "updates": [] }));
}

#[tokio::test]
async fn invalid_bodies_are_rejected() {
    let app = router();

    for body in [
        json!({ "status": "degraded" }),
        json!({ "status": "degraded", "message": "   " }),
        json!({ "status": "unknown", "message": "?" }),
    ] {
        let response = app
            .clone()
            .oneshot(post(Some(STAFF_JWT), body))
            .await
            .unwrap();
        assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    }
}
