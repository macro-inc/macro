use std::{
    collections::{HashMap, HashSet},
    sync::Arc,
};

use axum::{Router, http::Request};
use hmac::{Hmac, Mac};
use http_body_util::BodyExt;
use macro_authorization::{
    INTERNAL_API_KEY_HEADER, INTERNAL_MACRO_USER_ID_HEADER, InternalIdentityClaims,
    MacroAuthorizationError, MacroAuthorizationService, MacroAuthorizationState,
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use model_user::UserContext;
use models_pagination::{CreatedAt, Paginated, Query};
use reqwest::StatusCode;
use rootcause::Report;
use serde::de::DeserializeOwned;
use sha2::Sha256;
use tower::util::ServiceExt;
use uuid::Uuid;

use crate::domain::{
    models::{
        DisabledNotificationType, UserNotificationRow,
        device::DeviceType,
        request::{
            GetNotificationsByEventItemIdsRequest, UpdateNotificationsForEntitiesRequest,
            UpdateNotificationsRequest,
        },
        signing::SignedUrl,
    },
    service::NotificationReader,
};

use super::NotificationRouterState;

const VALID_BEARER_TOKEN: &str = "valid-token";
const VALID_AUTHORIZATION_HEADER: &str = "Bearer valid-token";
const VALID_INTERNAL_KEY: &str = "valid-internal-key";
const VALID_USER_ID: &str = "macro|user@example.com";

#[derive(Clone)]
struct FakeAuthorizationService;

impl MacroAuthorizationService for FakeAuthorizationService {
    async fn authorize(&self, token: &str) -> Result<UserContext, Report<MacroAuthorizationError>> {
        if token != VALID_BEARER_TOKEN {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        Ok(UserContext {
            user_id: VALID_USER_ID.to_string(),
            fusion_user_id: "fusion-user-id".to_string(),
            organization_id: None,
            permissions: None,
        })
    }

    async fn authorize_internal(
        &self,
        provided_key: &str,
        claims: InternalIdentityClaims,
    ) -> Result<Option<UserContext>, Report<MacroAuthorizationError>> {
        if provided_key != VALID_INTERNAL_KEY {
            return Err(Report::new(MacroAuthorizationError::InvalidCredentials));
        }

        let Some(user_id) = claims.user_id else {
            return Ok(None);
        };

        Ok(Some(UserContext {
            user_id,
            fusion_user_id: claims.fusion_user_id.unwrap_or_default(),
            organization_id: claims.organization_id,
            permissions: None,
        }))
    }
}

/// A mock `NotificationReader` that only permits reading preferences for the test user.
/// Tests that reject at the extractor level will not reach any methods.
struct AuthenticationTestService;

impl NotificationReader for AuthenticationTestService {
    fn update_notifications(
        &self,
        _req: UpdateNotificationsRequest,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!("should not be called") }
    }

    fn update_notifications_and_return<T: DeserializeOwned + Send>(
        &self,
        _req: UpdateNotificationsRequest,
    ) -> impl Future<Output = Result<Vec<UserNotificationRow<T>>, Report>> + Send {
        async { unreachable!("should not be called") }
    }

    fn update_notifications_for_entities<T: DeserializeOwned + Send>(
        &self,
        _req: UpdateNotificationsForEntitiesRequest,
    ) -> impl Future<Output = Result<Vec<UserNotificationRow<T>>, Report>> + Send {
        async { unreachable!("should not be called") }
    }

    fn get_user_notifications<T: DeserializeOwned + Send>(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _limit: Option<u32>,
        _cursor: Query<Uuid, CreatedAt, ()>,
        _filters: crate::domain::models::request::NotificationListFilters,
    ) -> impl Future<Output = Result<Paginated<UserNotificationRow<T>, String>, Report>> + Send
    {
        async { unreachable!("should not be called") }
    }

    fn get_user_notifications_by_event_item_ids<T: DeserializeOwned + Send>(
        &self,
        _req: GetNotificationsByEventItemIdsRequest<'_>,
    ) -> impl Future<Output = Result<Paginated<UserNotificationRow<T>, String>, Report>> + Send
    {
        async { unreachable!("should not be called") }
    }

    fn get_entity_notifications_batch<T: DeserializeOwned + Send>(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _entity_refs: Vec<Entity<'static>>,
    ) -> impl Future<Output = Result<HashMap<Entity<'static>, Vec<UserNotificationRow<T>>>, Report>> + Send
    {
        async { unreachable!("should not be called") }
    }

    fn get_user_notification_by_id<T: DeserializeOwned + Send>(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_id: Uuid,
    ) -> impl Future<Output = Result<Option<UserNotificationRow<T>>, Report>> + Send {
        async { unreachable!("should not be called") }
    }

    fn delete_user_notification(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_id: Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!("should not be called") }
    }

    fn bulk_delete_user_notifications(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_ids: &[Uuid],
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!("should not be called") }
    }

    fn register_device(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _device_token: &str,
        _device_type: &DeviceType,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!("should not be called") }
    }

    fn unregister_device(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _device_token: &str,
        _device_type: &DeviceType,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!("should not be called") }
    }

    fn get_disabled_notification_types(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<DisabledNotificationType>, Report>> + Send {
        async move {
            assert_eq!(user_id.to_string(), VALID_USER_ID);
            Ok(Vec::new())
        }
    }

    fn disable_notification_type(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _type_name: &str,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!("should not be called") }
    }

    fn enable_notification_type(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _type_name: &str,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!("should not be called") }
    }
}

static BLOCKABLE: std::sync::LazyLock<HashSet<&'static str>> =
    std::sync::LazyLock::new(|| HashSet::from(["test_type"]));

fn test_router() -> Router {
    let hmac_key = Hmac::<Sha256>::new_from_slice(b"test-key").unwrap();
    let authorization_state = MacroAuthorizationState::new(Arc::new(FakeAuthorizationService));
    let state = NotificationRouterState::new(
        AuthenticationTestService,
        &BLOCKABLE,
        hmac_key,
        authorization_state,
    );

    let device_router =
        super::device::device_router::<AuthenticationTestService, FakeAuthorizationService>();
    Router::new()
        .nest(
            "/user_notifications",
            super::router::<AuthenticationTestService, FakeAuthorizationService, serde_json::Value>(
            ),
        )
        .nest("/device", device_router)
        .with_state(state)
}

/// Send a request to the router and return the status code.
async fn status(router: &Router, method: &str, uri: &str, body: Option<&str>) -> StatusCode {
    status_with_headers(router, method, uri, body, &[]).await
}

/// Send a request with headers to the router and return the status code.
async fn status_with_headers(
    router: &Router,
    method: &str,
    uri: &str,
    body: Option<&str>,
    headers: &[(&'static str, &'static str)],
) -> StatusCode {
    let mut builder = Request::builder().uri(uri).method(method);
    for &(name, value) in headers {
        builder = builder.header(name, value);
    }
    if body.is_some() {
        builder = builder.header("content-type", "application/json");
    }
    let req = builder
        .body(axum::body::Body::from(body.unwrap_or_default().to_string()))
        .unwrap();
    router.clone().oneshot(req).await.unwrap().status()
}

/// Send a request with an invalid bearer token and return the status code.
async fn status_with_bad_token(
    router: &Router,
    method: &str,
    uri: &str,
    body: Option<&str>,
) -> StatusCode {
    status_with_headers(
        router,
        method,
        uri,
        body,
        &[("authorization", "Bearer invalid.jwt.token")],
    )
    .await
}

// -- No token tests ---------------------------------------------------------

#[tokio::test]
async fn no_token_bulk_mark_seen() {
    let router = test_router();
    let body = r#"{"notification_ids":[]}"#;
    assert_eq!(
        status(
            &router,
            "PATCH",
            "/user_notifications/bulk/seen",
            Some(body)
        )
        .await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn no_token_bulk_mark_done() {
    let router = test_router();
    let body = r#"{"notification_ids":[]}"#;
    assert_eq!(
        status(
            &router,
            "PATCH",
            "/user_notifications/bulk/done",
            Some(body)
        )
        .await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn no_token_bulk_mark_undone() {
    let router = test_router();
    let body = r#"{"notification_ids":[]}"#;
    assert_eq!(
        status(
            &router,
            "PATCH",
            "/user_notifications/bulk/undone",
            Some(body)
        )
        .await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn no_token_bulk_delete() {
    let router = test_router();
    let body = r#"{"notification_ids":[]}"#;
    assert_eq!(
        status(&router, "DELETE", "/user_notifications/bulk", Some(body)).await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn no_token_get_preferences() {
    let router = test_router();
    assert_eq!(
        status(&router, "GET", "/user_notifications/preferences", None).await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn no_token_disable_preference() {
    let router = test_router();
    assert_eq!(
        status(
            &router,
            "PUT",
            "/user_notifications/preferences/test_type/disable",
            None
        )
        .await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn no_token_enable_preference() {
    let router = test_router();
    assert_eq!(
        status(
            &router,
            "PUT",
            "/user_notifications/preferences/test_type/enable",
            None
        )
        .await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn no_token_register_device() {
    let router = test_router();
    let body = r#"{"token":"tok","device_type":"Ios"}"#;
    assert_eq!(
        status(&router, "POST", "/device/register", Some(body)).await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn no_token_unregister_device() {
    let router = test_router();
    let body = r#"{"token":"tok","device_type":"Ios"}"#;
    assert_eq!(
        status(&router, "DELETE", "/device/unregister", Some(body)).await,
        StatusCode::UNAUTHORIZED
    );
}

// -- Invalid token tests ----------------------------------------------------

#[tokio::test]
async fn invalid_token_bulk_mark_seen() {
    let router = test_router();
    let body = r#"{"notification_ids":[]}"#;
    assert_eq!(
        status_with_bad_token(
            &router,
            "PATCH",
            "/user_notifications/bulk/seen",
            Some(body)
        )
        .await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn invalid_token_bulk_mark_done() {
    let router = test_router();
    let body = r#"{"notification_ids":[]}"#;
    assert_eq!(
        status_with_bad_token(
            &router,
            "PATCH",
            "/user_notifications/bulk/done",
            Some(body)
        )
        .await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn invalid_token_bulk_mark_undone() {
    let router = test_router();
    let body = r#"{"notification_ids":[]}"#;
    assert_eq!(
        status_with_bad_token(
            &router,
            "PATCH",
            "/user_notifications/bulk/undone",
            Some(body)
        )
        .await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn invalid_token_bulk_delete() {
    let router = test_router();
    let body = r#"{"notification_ids":[]}"#;
    assert_eq!(
        status_with_bad_token(&router, "DELETE", "/user_notifications/bulk", Some(body)).await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn invalid_token_get_preferences() {
    let router = test_router();
    assert_eq!(
        status_with_bad_token(&router, "GET", "/user_notifications/preferences", None).await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn invalid_token_disable_preference() {
    let router = test_router();
    assert_eq!(
        status_with_bad_token(
            &router,
            "PUT",
            "/user_notifications/preferences/test_type/disable",
            None
        )
        .await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn invalid_token_enable_preference() {
    let router = test_router();
    assert_eq!(
        status_with_bad_token(
            &router,
            "PUT",
            "/user_notifications/preferences/test_type/enable",
            None
        )
        .await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn invalid_token_register_device() {
    let router = test_router();
    let body = r#"{"token":"tok","device_type":"Ios"}"#;
    assert_eq!(
        status_with_bad_token(&router, "POST", "/device/register", Some(body)).await,
        StatusCode::UNAUTHORIZED
    );
}

#[tokio::test]
async fn invalid_token_unregister_device() {
    let router = test_router();
    let body = r#"{"token":"tok","device_type":"Ios"}"#;
    assert_eq!(
        status_with_bad_token(&router, "DELETE", "/device/unregister", Some(body)).await,
        StatusCode::UNAUTHORIZED
    );
}

// -- Valid authorization tests ----------------------------------------------

#[tokio::test]
async fn valid_bearer_token_reaches_per_user_handler() {
    let router = test_router();
    assert_eq!(
        status_with_headers(
            &router,
            "GET",
            "/user_notifications/preferences",
            None,
            &[("authorization", VALID_AUTHORIZATION_HEADER)],
        )
        .await,
        StatusCode::OK
    );
}

#[tokio::test]
async fn valid_internal_key_and_acting_user_reach_per_user_handler() {
    let router = test_router();
    assert_eq!(
        status_with_headers(
            &router,
            "GET",
            "/user_notifications/preferences",
            None,
            &[
                (INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY),
                (INTERNAL_MACRO_USER_ID_HEADER, VALID_USER_ID),
            ],
        )
        .await,
        StatusCode::OK
    );
}

#[tokio::test]
async fn internal_request_without_acting_user_is_unauthorized() {
    let router = test_router();
    assert_eq!(
        status_with_headers(
            &router,
            "GET",
            "/user_notifications/preferences",
            None,
            &[(INTERNAL_API_KEY_HEADER, VALID_INTERNAL_KEY)],
        )
        .await,
        StatusCode::UNAUTHORIZED
    );
}

// -- Presigned disable preference tests -------------------------------------

/// A mock `NotificationReader` that returns `Ok(())` for `disable_notification_type`
/// and panics on everything else.
struct PresignedTestService;

impl NotificationReader for PresignedTestService {
    fn update_notifications(
        &self,
        _req: UpdateNotificationsRequest,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!() }
    }

    fn update_notifications_and_return<T: DeserializeOwned + Send>(
        &self,
        _req: UpdateNotificationsRequest,
    ) -> impl Future<Output = Result<Vec<UserNotificationRow<T>>, Report>> + Send {
        async { unreachable!() }
    }

    fn update_notifications_for_entities<T: DeserializeOwned + Send>(
        &self,
        _req: UpdateNotificationsForEntitiesRequest,
    ) -> impl Future<Output = Result<Vec<UserNotificationRow<T>>, Report>> + Send {
        async { unreachable!() }
    }

    fn get_user_notifications<T: DeserializeOwned + Send>(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _limit: Option<u32>,
        _cursor: Query<Uuid, CreatedAt, ()>,
        _filters: crate::domain::models::request::NotificationListFilters,
    ) -> impl Future<Output = Result<Paginated<UserNotificationRow<T>, String>, Report>> + Send
    {
        async { unreachable!() }
    }

    fn get_user_notifications_by_event_item_ids<T: DeserializeOwned + Send>(
        &self,
        _req: GetNotificationsByEventItemIdsRequest<'_>,
    ) -> impl Future<Output = Result<Paginated<UserNotificationRow<T>, String>, Report>> + Send
    {
        async { unreachable!() }
    }

    fn get_entity_notifications_batch<T: DeserializeOwned + Send>(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _entity_refs: Vec<Entity<'static>>,
    ) -> impl Future<Output = Result<HashMap<Entity<'static>, Vec<UserNotificationRow<T>>>, Report>> + Send
    {
        async { unreachable!() }
    }

    fn get_user_notification_by_id<T: DeserializeOwned + Send>(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_id: Uuid,
    ) -> impl Future<Output = Result<Option<UserNotificationRow<T>>, Report>> + Send {
        async { unreachable!() }
    }

    fn delete_user_notification(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_id: Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!() }
    }

    fn bulk_delete_user_notifications(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _notification_ids: &[Uuid],
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!() }
    }

    fn register_device(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _device_token: &str,
        _device_type: &DeviceType,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!() }
    }

    fn unregister_device(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _device_token: &str,
        _device_type: &DeviceType,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!() }
    }

    fn get_disabled_notification_types(
        &self,
        _user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<DisabledNotificationType>, Report>> + Send {
        async { unreachable!() }
    }

    fn disable_notification_type(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _type_name: &str,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { Ok(()) }
    }

    fn enable_notification_type(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _type_name: &str,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!() }
    }
}

const HMAC_KEY: &[u8] = b"test-key";

const LEGACY_NOTIFICATION_ORIGIN: &str = "https://notifications.macro.com";

fn presigned_router() -> Router {
    let hmac_key = Hmac::<Sha256>::new_from_slice(HMAC_KEY).unwrap();
    let authorization_state = MacroAuthorizationState::new(Arc::new(FakeAuthorizationService));
    let state = NotificationRouterState::new(
        PresignedTestService,
        &BLOCKABLE,
        hmac_key,
        authorization_state,
    );

    let inner = Router::new()
        .nest(
            "/user_notifications",
            super::router::<PresignedTestService, FakeAuthorizationService, serde_json::Value>(),
        )
        .with_state(state);
    Router::new()
        .merge(inner.clone())
        .nest("/notification", inner)
}

fn signed_disable_uri_at(origin: &str, notification_type: &str, user_id: &str) -> String {
    let hmac_key = Hmac::<Sha256>::new_from_slice(HMAC_KEY).unwrap();
    let mut unsigned = crate::domain::models::signing::append_path(
        url::Url::parse(origin).unwrap(),
        &format!("/user_notifications/preferences/{notification_type}/disable"),
    );
    unsigned.query_pairs_mut().append_pair("id", user_id);
    let signed = SignedUrl::new(unsigned, hmac_key);
    let signed_url = signed.as_ref();
    format!("{}?{}", signed_url.path(), signed_url.query().unwrap())
}

fn signed_disable_uri(notification_type: &str, user_id: &str) -> String {
    signed_disable_uri_at(LEGACY_NOTIFICATION_ORIGIN, notification_type, user_id)
}

fn presigned_get(uri: &str, host: &str) -> Request<axum::body::Body> {
    Request::builder()
        .uri(uri)
        .method("GET")
        .header("host", host)
        .body(axum::body::Body::empty())
        .unwrap()
}

#[tokio::test]
async fn presigned_disable_succeeds_without_jwt() {
    let router = presigned_router();
    let uri = signed_disable_uri("test_type", "macro|user@example.com");

    let resp = router
        .oneshot(presigned_get(&uri, "notifications.macro.com"))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&body);
    assert!(
        text.contains("unsubscribed"),
        "expected success HTML, got: {text}"
    );
}

#[tokio::test]
async fn presigned_disable_succeeds_with_valid_hmac() {
    let router = presigned_router();
    let uri = signed_disable_uri("test_type", "macro|user@example.com");

    let resp = router
        .oneshot(presigned_get(&uri, "notifications.macro.com"))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn presigned_disable_succeeds_on_gateway_prefix() {
    let router = presigned_router();
    let uri = signed_disable_uri_at(
        "https://gateway.macro.com/notification",
        "test_type",
        "macro|user@example.com",
    );

    let resp = router
        .oneshot(presigned_get(&uri, "gateway.macro.com"))
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::OK);
}

#[tokio::test]
async fn presigned_disable_fails_with_invalid_hmac() {
    let router = presigned_router();
    // Construct a URI with a bogus signature
    let uri = "/user_notifications/preferences/test_type/disable\
               ?id=macro|user@example.com&sig=0000000000000000000000000000000000000000000000000000000000000000";

    let resp = router
        .oneshot(
            Request::builder()
                .uri(uri)
                .method("GET")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(resp.status(), StatusCode::BAD_REQUEST);
    let body = resp.into_body().collect().await.unwrap().to_bytes();
    let text = String::from_utf8_lossy(&body);
    assert!(
        text.contains("Invalid signature"),
        "expected rejection HTML, got: {text}"
    );
}
