use super::fakes;
use axum::{
    body::Body,
    http::{Request, StatusCode},
};
use entity_access::domain::models::AccessLevel;
use tower::ServiceExt;

#[tokio::test]
async fn appearance_requires_edit_and_forwards_the_saved_value() {
    for (level, expected) in [
        (AccessLevel::View, StatusCode::UNAUTHORIZED),
        (AccessLevel::Edit, StatusCode::OK),
        (AccessLevel::Owner, StatusCode::OK),
    ] {
        let (router, service) = fakes::appearance_router(level);
        let response = router
            .oneshot(
                Request::put("/00000000-0000-0000-0000-000000000001/appearance")
                    .header("authorization", "Bearer valid")
                    .header("content-type", "application/json")
                    .body(Body::from(r#"{"color":"blue"}"#))
                    .unwrap(),
            )
            .await
            .unwrap();
        assert_eq!(response.status(), expected);
        assert_eq!(
            service.appearances.lock().unwrap().len(),
            usize::from(expected == StatusCode::OK)
        );
    }
}
