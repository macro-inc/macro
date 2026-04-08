use std::collections::HashSet;

use axum::{Router, http::Request};
use hmac::{Hmac, Mac};
use http_body_util::BodyExt;
use macro_auth::middleware::decode_jwt::JwtValidationArgs;
use macro_user_id::user_id::MacroUserIdStr;
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
        request::{GetNotificationsByEventItemIdsRequest, UpdateNotificationsRequest},
        signing::SignedUrl,
    },
    service::NotificationReader,
};

use super::NotificationRouterState;

/// A mock `NotificationReader` that panics on all methods.
/// Tests that reject at the extractor level will never reach these methods.
struct UnreachableService;

impl NotificationReader for UnreachableService {
    fn update_notifications(
        &self,
        _req: UpdateNotificationsRequest,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!("should not be called") }
    }

    fn get_user_notifications<T: DeserializeOwned + Send>(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _limit: Option<u32>,
        _cursor: Query<Uuid, CreatedAt, ()>,
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
        _device_token: &str,
        _device_type: &DeviceType,
    ) -> impl Future<Output = Result<(), Report>> + Send {
        async { unreachable!("should not be called") }
    }

    fn get_disabled_notification_types(
        &self,
        _user_id: MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Vec<DisabledNotificationType>, Report>> + Send {
        async { unreachable!("should not be called") }
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
    let state = NotificationRouterState::new(
        UnreachableService,
        &BLOCKABLE,
        hmac_key,
        JwtValidationArgs::new_testing(),
    );

    let device_router = super::device::device_router::<UnreachableService>();
    Router::new()
        .nest(
            "/user_notifications",
            super::router::<UnreachableService, serde_json::Value>(),
        )
        .nest("/device", device_router)
        .with_state(state)
}

/// Send a request to the router and return the status code.
async fn status(router: &Router, method: &str, uri: &str, body: Option<&str>) -> StatusCode {
    let builder = Request::builder().uri(uri).method(method);
    let builder = if body.is_some() {
        builder.header("content-type", "application/json")
    } else {
        builder
    };
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
    let builder = Request::builder()
        .uri(uri)
        .method(method)
        .header("authorization", "Bearer invalid.jwt.token");
    let builder = if body.is_some() {
        builder.header("content-type", "application/json")
    } else {
        builder
    };
    let req = builder
        .body(axum::body::Body::from(body.unwrap_or_default().to_string()))
        .unwrap();
    router.clone().oneshot(req).await.unwrap().status()
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

    fn get_user_notifications<T: DeserializeOwned + Send>(
        &self,
        _user_id: MacroUserIdStr<'_>,
        _limit: Option<u32>,
        _cursor: Query<Uuid, CreatedAt, ()>,
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

/// The base URL that `Environment::new_or_prod()` (Production) resolves to.
const NOTIFICATION_BASE_URL: &str = "https://notifications.macro.com";

fn presigned_router() -> Router {
    let hmac_key = Hmac::<Sha256>::new_from_slice(HMAC_KEY).unwrap();
    let state = NotificationRouterState::new(
        PresignedTestService,
        &BLOCKABLE,
        hmac_key,
        JwtValidationArgs::new_testing(),
    );

    Router::new()
        .nest(
            "/user_notifications",
            super::router::<PresignedTestService, serde_json::Value>(),
        )
        .with_state(state)
}

/// Build a presigned disable URL path+query for use as a request URI.
///
/// Signs the full absolute URL (`https://notifications.macro.com/...`) and
/// returns only the path+query portion (e.g. `/user_notifications/preferences/...?id=...&sig=...`).
fn signed_disable_uri(notification_type: &str, user_id: &str) -> String {
    let hmac_key = Hmac::<Sha256>::new_from_slice(HMAC_KEY).unwrap();
    let mut unsigned = url::Url::parse(&format!(
        "{NOTIFICATION_BASE_URL}/user_notifications/preferences/{notification_type}/disable"
    ))
    .unwrap();
    // Use query_pairs_mut so the encoding matches what SignedUrl::verify expects
    // (application/x-www-form-urlencoded round-trip).
    unsigned.query_pairs_mut().append_pair("id", user_id);
    let signed = SignedUrl::new(unsigned, hmac_key);
    let signed_url = signed.as_ref();
    // Return path + query for use as request URI
    format!("{}?{}", signed_url.path(), signed_url.query().unwrap())
}

#[tokio::test]
async fn presigned_disable_succeeds_without_jwt() {
    let router = presigned_router();
    let uri = signed_disable_uri("test_type", "macro|user@example.com");

    let req = Request::builder()
        .uri(&uri)
        .method("GET")
        .body(axum::body::Body::empty())
        .unwrap();
    let resp = router.oneshot(req).await.unwrap();

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
        .oneshot(
            Request::builder()
                .uri(&uri)
                .method("GET")
                .body(axum::body::Body::empty())
                .unwrap(),
        )
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
