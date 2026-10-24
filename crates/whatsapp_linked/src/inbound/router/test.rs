use super::*;

#[tokio::test]
async fn a_rate_limited_request_returns_429_with_retry_after() {
    let response = ApiError(LinkedError::RateLimited).into_response();
    assert_eq!(response.status(), StatusCode::TOO_MANY_REQUESTS);
    assert_eq!(response.headers()[header::RETRY_AFTER], "1");
    let body = axum::body::to_bytes(response.into_body(), 1024)
        .await
        .unwrap();
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap();
    assert_eq!(body["code"], "rate_limited");
}

#[test]
fn verified_owner_api_credentials_remain_distinct_from_sessions_and_bots() {
    let mut user = MacroUserAuthentication {
        is_macro_api_token: false,
        agent_id: None,
        macro_user_id: "macro|person@example.com".to_string().try_into().unwrap(),
        user_context: Default::default(),
    };
    let mut headers = HeaderMap::new();
    headers.insert(
        header::AUTHORIZATION,
        HeaderValue::from_static("Bearer signed-token"),
    );
    assert!(matches!(authority(&headers, &user), SendAuthority::Human));
    user.is_macro_api_token = true;
    assert!(matches!(
        authority(&headers, &user),
        SendAuthority::UserApiToken
    ));
    user.agent_id = Some(serde_json::from_value(serde_json::json!(Uuid::now_v7())).unwrap());
    assert!(matches!(
        authority(&headers, &user),
        SendAuthority::UserApiToken
    ));
    user.is_macro_api_token = false;
    user.agent_id = Some(serde_json::from_value(serde_json::json!(Uuid::now_v7())).unwrap());
    assert!(matches!(
        authority(&headers, &user),
        SendAuthority::Automation
    ));
    user.agent_id = None;
    headers.insert(
        macro_authorization::USER_API_KEY_HEADER,
        HeaderValue::from_static("test-key"),
    );
    assert!(matches!(
        authority(&headers, &user),
        SendAuthority::UserApiToken
    ));
}
