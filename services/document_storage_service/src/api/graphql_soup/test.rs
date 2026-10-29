use super::graphql_response;
use axum::{
    body::{HttpBody, to_bytes},
    http::{HeaderValue, StatusCode},
};

#[tokio::test]
async fn serialization_preserves_data_headers_and_body_length() {
    let mut result = async_graphql::Response::new(async_graphql::value!({ "rows": [1, 2] }));
    result
        .http_headers
        .insert("x-profile-test", HeaderValue::from_static("preserved"));
    let response = graphql_response(result);
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response.headers()["content-type"],
        "application/graphql-response+json"
    );
    assert_eq!(response.headers()["x-profile-test"], "preserved");
    let bytes = response.body().size_hint().exact().unwrap();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(bytes, body.len() as u64);
    assert_eq!(body.as_ref(), br#"{"data":{"rows":[1,2]}}"#);
}

#[tokio::test]
async fn serialization_preserves_graphql_errors() {
    let result = async_graphql::Response::from_errors(vec![async_graphql::ServerError::new(
        "refused", None,
    )]);
    let response = graphql_response(result);
    assert_eq!(response.status(), StatusCode::OK);
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    assert_eq!(
        body.as_ref(),
        br#"{"data":null,"errors":[{"message":"refused"}]}"#
    );
}
