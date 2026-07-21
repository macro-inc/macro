use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalAuthConfig, JwtValidator,
    MacroAuthorizationError, MacroAuthorizationServiceImpl, MacroAuthorizationState,
    ValidatedIdentity,
};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use tower::ServiceExt;

use super::*;
use crate::domain::models::{ChannelMessage, GetThreadReplyRowsRequest, UserName};

const VALID_BEARER_TOKEN: &str = "valid-token";
const INVALID_BEARER_TOKEN: &str = "invalid-token";
const EXPIRED_BEARER_TOKEN: &str = "expired-token";
const VALID_INTERNAL_KEY: &str = "valid-internal-key";
const BEARER_USER_ID: &str = "macro|bearer@example.com";
const ACTING_USER_ID: &str = "macro|acting@example.com";
const DEFAULT_USER_ID: &str = "macro|default@example.com";

#[derive(Clone, Debug, Eq, PartialEq)]
enum ServiceCall {
    GetChannels(String),
    GetActivities(String),
}

#[derive(Clone, Default)]
struct ServiceCallTracker {
    calls: Arc<Mutex<Vec<ServiceCall>>>,
}

impl ServiceCallTracker {
    fn record(&self, call: ServiceCall) {
        self.calls.lock().unwrap().push(call);
    }

    fn calls(&self) -> Vec<ServiceCall> {
        self.calls.lock().unwrap().clone()
    }
}

struct FakeChannelListService {
    tracker: ServiceCallTracker,
}

impl ChannelListService for FakeChannelListService {
    async fn get_channels(
        &self,
        request: GetChannelsRequest,
    ) -> Result<Vec<ChannelWithLatest>, Report> {
        self.tracker
            .record(ServiceCall::GetChannels(request.macro_id.to_string()));
        Ok(Vec::new())
    }

    async fn get_activities(&self, user_id: MacroUserIdStr<'_>) -> Result<Vec<Activity>, Report> {
        self.tracker
            .record(ServiceCall::GetActivities(user_id.to_string()));
        Ok(Vec::new())
    }

    async fn get_thread_messages(
        &self,
        _request: GetThreadReplyRowsRequest,
    ) -> Result<Vec<ChannelMessage>, Report> {
        Ok(Vec::new())
    }

    async fn get_names(
        &self,
        _names: HashSet<MacroUserIdStr<'_>>,
    ) -> Result<Vec<UserName>, Report> {
        Ok(Vec::new())
    }
}

#[derive(Clone, Copy)]
struct FakeJwtValidator;

impl JwtValidator for FakeJwtValidator {
    fn validate(&self, jwt: &str) -> Result<ValidatedIdentity, Report<MacroAuthorizationError>> {
        match jwt {
            VALID_BEARER_TOKEN => Ok(ValidatedIdentity {
                user_id: BEARER_USER_ID.to_string(),
                fusion_user_id: "fusion-user-id".to_string(),
                organization_id: None,
                permissions: None,
            }),
            EXPIRED_BEARER_TOKEN => Err(Report::new(MacroAuthorizationError::CredentialsExpired)),
            _ => Err(Report::new(MacroAuthorizationError::InvalidCredentials)),
        }
    }
}

fn test_router(default_user_id: Option<&str>) -> (Router, ServiceCallTracker) {
    let tracker = ServiceCallTracker::default();
    let list_service = FakeChannelListService {
        tracker: tracker.clone(),
    };
    let authorization_service = MacroAuthorizationServiceImpl::new(
        FakeJwtValidator,
        InternalAuthConfig {
            api_key: VALID_INTERNAL_KEY.to_string(),
            default_user_id: default_user_id.map(str::to_owned),
        },
        macro_authorization::NoBotAuthorizer,
    );
    let state = ChannelListRouterState::new(
        list_service,
        MacroAuthorizationState::new(Arc::new(authorization_service)),
    );

    (channel_list_router::<_, _, ()>(state), tracker)
}

fn bearer_request(path: &str, token: &str) -> Request<Body> {
    Request::get(path)
        .header(header::AUTHORIZATION, format!("Bearer {token}"))
        .body(Body::empty())
        .unwrap()
}

#[tokio::test]
async fn valid_bearer_credentials_pass_user_id_to_channel_list_service() {
    let (router, tracker) = test_router(None);

    let response = router
        .oneshot(bearer_request("/channels", VALID_BEARER_TOKEN))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        tracker.calls(),
        vec![ServiceCall::GetChannels(BEARER_USER_ID.to_string())]
    );
}

#[tokio::test]
async fn standard_internal_credentials_pass_acting_user_to_channel_list_service() {
    let (router, tracker) = test_router(None);
    let request = Request::get("/channels")
        .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
        .header(INTERNAL_MACRO_USER_ID_HEADER, ACTING_USER_ID)
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        tracker.calls(),
        vec![ServiceCall::GetChannels(ACTING_USER_ID.to_string())]
    );
}

#[tokio::test]
async fn standard_internal_credentials_use_default_user_for_activity_service() {
    let (router, tracker) = test_router(Some(DEFAULT_USER_ID));
    let request = Request::get("/activity")
        .header(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)
        .body(Body::empty())
        .unwrap();

    let response = router.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        tracker.calls(),
        vec![ServiceCall::GetActivities(DEFAULT_USER_ID.to_string())]
    );
}

#[tokio::test]
async fn missing_credentials_are_rejected_without_invoking_list_service() {
    let (router, tracker) = test_router(None);
    let request = Request::get("/channels").body(Body::empty()).unwrap();

    let response = router.oneshot(request).await.unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(tracker.calls().is_empty());
}

#[tokio::test]
async fn invalid_credentials_are_rejected_without_invoking_list_service() {
    let (router, tracker) = test_router(None);

    let response = router
        .oneshot(bearer_request("/activity", INVALID_BEARER_TOKEN))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(tracker.calls().is_empty());
}

#[tokio::test]
async fn expired_credentials_are_rejected_without_invoking_list_service() {
    let (router, tracker) = test_router(None);

    let response = router
        .oneshot(bearer_request("/channels", EXPIRED_BEARER_TOKEN))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(tracker.calls().is_empty());
}
