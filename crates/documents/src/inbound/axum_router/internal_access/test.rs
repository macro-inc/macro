use super::*;
use axum::http::Request;
use entity_access::domain::models::AccessLevel;

#[tokio::test]
async fn rejects_request_without_internal_user() {
    let (mut parts, _) = Request::builder().body(()).unwrap().into_parts();

    let result = InternalAccessExtractor::from_request_parts(&mut parts, &()).await;

    assert!(matches!(result, Err(InternalAccessRejection::NotInternal)));
}

#[tokio::test]
async fn accepts_request_with_internal_user() {
    let mut request = Request::builder().body(()).unwrap();
    request.extensions_mut().insert(InternalUser {
        access_level: AccessLevel::Owner,
    });
    let (mut parts, _) = request.into_parts();

    let result = InternalAccessExtractor::from_request_parts(&mut parts, &()).await;

    assert!(result.is_ok());
}
