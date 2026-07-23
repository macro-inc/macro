use axum::http::{HeaderValue, header};

use super::*;

#[derive(Clone, Debug, PartialEq, Eq)]
struct TestExtension(&'static str);

#[tokio::test]
async fn extractor_preserves_request_metadata_for_lazy_extractors() {
    let mut request = Request::builder()
        .method("POST")
        .uri("/soup/graphql?operation=test")
        .header(header::AUTHORIZATION, "Bearer token")
        .body(())
        .expect("valid request");
    request
        .extensions_mut()
        .insert(TestExtension("request context"));
    let (mut parts, ()) = request.into_parts();

    let context = GraphqlSoupRequestParts::from_request_parts(&mut parts, &())
        .await
        .expect("request-parts extraction is infallible");
    parts.headers.insert(
        header::AUTHORIZATION,
        HeaderValue::from_static("Bearer changed"),
    );
    parts.extensions.remove::<TestExtension>();
    let stored = context.parts.into_inner();

    assert_eq!(stored.method, "POST");
    assert_eq!(stored.uri, "/soup/graphql?operation=test");
    assert_eq!(stored.headers[header::AUTHORIZATION], "Bearer token");
    assert_eq!(
        stored.extensions.get::<TestExtension>(),
        Some(&TestExtension("request context"))
    );
}
