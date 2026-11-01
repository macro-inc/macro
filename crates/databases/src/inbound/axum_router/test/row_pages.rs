//! The table rows route refuses a caller without a grant before the service,
//! which panics if reached.

use axum::body::Body;
use axum::http::{Request, header};
use tower::ServiceExt;

use super::*;

#[tokio::test]
async fn a_caller_without_a_grant_cannot_read_rows() {
    let database = Uuid::from_u128(0x0dbb);
    let table = Uuid::from_u128(0x7ab1);

    let response = fakes::ungranted_rows_router()
        .oneshot(
            Request::post(format!("/{database}/tables/{table}/rows"))
                .header(header::AUTHORIZATION, "Bearer valid")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
}
