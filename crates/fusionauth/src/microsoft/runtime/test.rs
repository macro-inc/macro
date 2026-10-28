use super::*;
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{method, path},
};

#[tokio::test]
async fn refresh_preserves_absent_replacement_and_redacts_errors() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
            "access_token":"access", "expires_in":3600
        })))
        .expect(1)
        .mount(&server)
        .await;
    let result = refresh(
        &client().unwrap(),
        format!("{}/token", server.uri()).parse().unwrap(),
        "client",
        "secret",
        "refresh",
    )
    .await
    .unwrap();
    assert!(result.refresh_token.is_none());
    assert!(result.scope.is_empty());
    assert_eq!(result.expires_in, 3600);
    server.reset().await;
    Mock::given(method("POST"))
        .respond_with(ResponseTemplate::new(400).set_body_json(serde_json::json!({
            "error":"invalid_grant", "error_description":"secret refresh token"
        })))
        .expect(1)
        .mount(&server)
        .await;
    let error = refresh(
        &client().unwrap(),
        format!("{}/token", server.uri()).parse().unwrap(),
        "client",
        "secret",
        "refresh",
    )
    .await
    .err()
    .unwrap();
    assert!(matches!(
        error,
        MicrosoftRuntimeError::ReauthorizationRequired
    ));
    assert!(!format!("{error:?}").contains("secret"));
}

#[tokio::test]
async fn refresh_never_retries_or_follows_redirects() {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/token"))
        .respond_with(
            ResponseTemplate::new(307)
                .insert_header("Location", format!("{}/capture", server.uri())),
        )
        .expect(1)
        .mount(&server)
        .await;
    Mock::given(path("/capture"))
        .respond_with(ResponseTemplate::new(200))
        .expect(0)
        .mount(&server)
        .await;
    assert!(
        refresh(
            &client().unwrap(),
            format!("{}/token", server.uri()).parse().unwrap(),
            "client",
            "secret",
            "refresh"
        )
        .await
        .is_err()
    );
}
