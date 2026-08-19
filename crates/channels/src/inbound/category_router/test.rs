use std::sync::{Arc, Mutex};

use axum::{
    body::Body,
    http::{Request, StatusCode, header},
};
use http_body_util::BodyExt;
use macro_authorization::{
    InternalAuthConfig, JwtValidator, MacroAuthorizationError, MacroAuthorizationServiceImpl,
    ValidatedIdentity,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use tower::ServiceExt;

use super::*;

const USER_ID: &str = "macro|category-router@example.com";

#[derive(Clone, Copy)]
struct TestJwt;

impl JwtValidator for TestJwt {
    fn validate(&self, jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        if jwt != "valid" {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }
        Ok(ValidatedIdentity {
            user_id: USER_ID.into(),
            fusion_user_id: "fusion-category-router".into(),
            organization_id: None,
            permissions: None,
        })
    }
}

#[derive(Clone, Default)]
struct FakeService {
    calls: Arc<Mutex<Vec<(String, &'static str)>>>,
}

impl ChannelCategoryService for FakeService {
    async fn get_layout(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<ChannelCategoryLayout, ChannelCategoryError> {
        self.calls
            .lock()
            .unwrap()
            .push((user_id.to_string(), "get"));
        Ok(ChannelCategoryLayout::default())
    }

    async fn replace_layout(
        &self,
        user_id: MacroUserIdStr<'_>,
        layout: ChannelCategoryLayout,
    ) -> Result<ChannelCategoryLayout, ChannelCategoryError> {
        self.calls
            .lock()
            .unwrap()
            .push((user_id.to_string(), "put"));
        match layout.revision {
            409 => Err(ChannelCategoryError::Conflict),
            -1 => Err(ChannelCategoryError::Invalid("invalid layout".into())),
            _ => Ok(ChannelCategoryLayout {
                revision: layout.revision + 1,
                ..layout
            }),
        }
    }
}

fn router(service: FakeService) -> Router {
    let authorization = MacroAuthorizationServiceImpl::new(
        TestJwt,
        InternalAuthConfig {
            api_key: "internal".into(),
            default_user_id: None,
        },
        macro_authorization::NoBotAuthorizer,
    );
    channel_category_router::<_, _, ()>(ChannelCategoryRouterState::new(
        service,
        MacroAuthorizationState::new(Arc::new(authorization)),
    ))
}

fn request(
    method: &str,
    body: Option<ChannelCategoryLayout>,
    authenticated: bool,
) -> Request<Body> {
    let mut builder = Request::builder().method(method).uri("/channel-categories");
    if authenticated {
        builder = builder.header(header::AUTHORIZATION, "Bearer valid");
    }
    if body.is_some() {
        builder = builder.header(header::CONTENT_TYPE, "application/json");
    }
    builder
        .body(body.map_or_else(Body::empty, |value| {
            Body::from(serde_json::to_vec(&value).unwrap())
        }))
        .unwrap()
}

#[tokio::test]
async fn authentication_is_required_and_authenticated_user_scopes_get() {
    let service = FakeService::default();
    let unauthorized = router(service.clone())
        .oneshot(request("GET", None, false))
        .await
        .unwrap();
    assert_eq!(unauthorized.status(), StatusCode::UNAUTHORIZED);

    let response = router(service.clone())
        .oneshot(request("GET", None, true))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        service.calls.lock().unwrap().as_slice(),
        &[(USER_ID.into(), "get")]
    );
}

#[tokio::test]
async fn put_returns_layout_and_maps_validation_and_conflict_statuses() {
    let service = FakeService::default();
    let response = router(service.clone())
        .oneshot(request("PUT", Some(ChannelCategoryLayout::default()), true))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let bytes = response.into_body().collect().await.unwrap().to_bytes();
    let saved: ChannelCategoryLayout = serde_json::from_slice(&bytes).unwrap();
    assert_eq!(saved.revision, 1);

    for (revision, expected) in [(-1, StatusCode::BAD_REQUEST), (409, StatusCode::CONFLICT)] {
        let response = router(service.clone())
            .oneshot(request(
                "PUT",
                Some(ChannelCategoryLayout {
                    revision,
                    ..Default::default()
                }),
                true,
            ))
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
    }
    assert!(
        service
            .calls
            .lock()
            .unwrap()
            .iter()
            .all(|(user, _)| user == USER_ID)
    );
}

#[tokio::test]
async fn malformed_json_is_rejected_before_service_call() {
    let service = FakeService::default();
    let response = router(service.clone())
        .oneshot(
            Request::put("/channel-categories")
                .header(header::AUTHORIZATION, "Bearer valid")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::UNPROCESSABLE_ENTITY);
    assert!(service.calls.lock().unwrap().is_empty());
}
