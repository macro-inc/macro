use std::{
    collections::HashSet,
    sync::{Arc, Mutex},
};

use axum::{
    Router,
    body::Body,
    http::{Request, StatusCode, header},
};
use chrono::{TimeZone, Utc};
use http_body_util::BodyExt;
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalAuthConfig, JwtValidator,
    MacroAuthorizationError, MacroAuthorizationServiceImpl, MacroAuthorizationState,
    ValidatedIdentity,
};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::Base64Str;
use rootcause::Report;
use tower::ServiceExt;
use uuid::Uuid;

use super::*;
use crate::domain::models::{
    ChannelMessage, ChannelWithParticipants, GetThreadReplyRowsRequest, LatestMessage, UserName,
};

const VALID_BEARER_TOKEN: &str = "valid-token";
const INVALID_BEARER_TOKEN: &str = "invalid-token";
const EXPIRED_BEARER_TOKEN: &str = "expired-token";
const VALID_INTERNAL_KEY: &str = "valid-internal-key";
const BEARER_USER_ID: &str = "macro|bearer@example.com";
const ACTING_USER_ID: &str = "macro|acting@example.com";
const DEFAULT_USER_ID: &str = "macro|default@example.com";

#[derive(Clone, Debug, Eq, PartialEq)]
enum ServiceCall {
    GetChannels {
        user_id: String,
        limit: Option<u32>,
        cursor_id: Option<Uuid>,
    },
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
    channels: Vec<ChannelWithLatest>,
}

impl ChannelListService for FakeChannelListService {
    async fn get_channels(
        &self,
        request: GetChannelsRequest,
    ) -> Result<Vec<ChannelWithLatest>, Report> {
        let (cursor_id, _) = request.query.vals();
        let limit = request.limit.map_or(usize::MAX, |limit| limit as usize);
        self.tracker.record(ServiceCall::GetChannels {
            user_id: request.macro_id.to_string(),
            limit: request.limit,
            cursor_id: cursor_id.copied(),
        });
        Ok(self.channels.iter().take(limit).cloned().collect())
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

fn test_router_with_channels(
    default_user_id: Option<&str>,
    channels: Vec<ChannelWithLatest>,
) -> (Router, ServiceCallTracker) {
    let tracker = ServiceCallTracker::default();
    let list_service = FakeChannelListService {
        tracker: tracker.clone(),
        channels,
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

fn test_router(default_user_id: Option<&str>) -> (Router, ServiceCallTracker) {
    test_router_with_channels(default_user_id, Vec::new())
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
        vec![ServiceCall::GetChannels {
            user_id: BEARER_USER_ID.to_string(),
            limit: Some(DEFAULT_CHANNEL_LIST_LIMIT.saturating_add(1)),
            cursor_id: None,
        }]
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
        vec![ServiceCall::GetChannels {
            user_id: ACTING_USER_ID.to_string(),
            limit: Some(DEFAULT_CHANNEL_LIST_LIMIT.saturating_add(1)),
            cursor_id: None,
        }]
    );
}

fn list_channel(id: Uuid, updated_at_seconds: i64) -> ChannelWithLatest {
    let timestamp = Utc.timestamp_opt(updated_at_seconds, 0).unwrap();
    ChannelWithLatest {
        channel: ChannelWithParticipants {
            channel: ChannelListItem {
                id,
                name: Some(format!("channel-{id}")),
                channel_type: DomainChannelType::Private,
                kind: DomainChannelKind::default(),
                org_id: None,
                team_id: None,
                auto_join_team: false,
                created_at: timestamp,
                updated_at: timestamp,
                owner_id: MacroUserIdStr::try_from(BEARER_USER_ID.to_string()).unwrap(),
            },
            participants: Vec::new(),
            is_participant: true,
        },
        latest_message: LatestMessage::default(),
        viewed_at: None,
        interacted_at: None,
        frecency_score: None,
    }
}

#[tokio::test]
async fn channel_list_returns_an_opaque_cursor_page_and_honors_limit() {
    let first_id = Uuid::from_u128(1);
    let second_id = Uuid::from_u128(2);
    let (router, tracker) = test_router_with_channels(
        None,
        vec![list_channel(first_id, 2), list_channel(second_id, 1)],
    );

    let response = router
        .oneshot(bearer_request("/channels?limit=1", VALID_BEARER_TOKEN))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let page: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert_eq!(page["items"][0]["id"], first_id.to_string());
    assert!(page["next_cursor"].as_str().is_some());
    assert_eq!(
        tracker.calls(),
        vec![ServiceCall::GetChannels {
            user_id: BEARER_USER_ID.to_string(),
            limit: Some(2),
            cursor_id: None,
        }]
    );
}

#[tokio::test]
async fn channel_list_omits_cursor_when_a_full_page_exhausts_results() {
    let channel_id = Uuid::from_u128(1);
    let (router, _) = test_router_with_channels(None, vec![list_channel(channel_id, 1)]);

    let response = router
        .oneshot(bearer_request("/channels?limit=1", VALID_BEARER_TOKEN))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let body = response.into_body().collect().await.unwrap().to_bytes();
    let page: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(page["items"].as_array().unwrap().len(), 1);
    assert_eq!(page["items"][0]["id"], channel_id.to_string());
    assert!(page["next_cursor"].is_null());
}

#[tokio::test]
async fn channel_list_passes_the_next_page_cursor_to_the_service() {
    let cursor_id = Uuid::from_u128(42);
    let cursor = Base64Str::encode_json(models_pagination::Cursor {
        id: cursor_id,
        limit: 25,
        val: models_pagination::CursorVal {
            sort_type: SimpleSortMethod::UpdatedAt,
            last_val: Utc.timestamp_opt(10, 0).unwrap(),
        },
        filter: (),
    });
    let encoded_cursor = cursor
        .to_string()
        .replace('+', "%2B")
        .replace('/', "%2F")
        .replace('=', "%3D");
    let (router, tracker) = test_router(None);

    let response = router
        .oneshot(bearer_request(
            &format!("/channels?limit=25&cursor={encoded_cursor}"),
            VALID_BEARER_TOKEN,
        ))
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        tracker.calls(),
        vec![ServiceCall::GetChannels {
            user_id: BEARER_USER_ID.to_string(),
            limit: Some(26),
            cursor_id: Some(cursor_id),
        }]
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
