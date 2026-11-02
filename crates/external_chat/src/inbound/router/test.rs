use super::*;

#[tokio::test]
async fn a_rate_limited_request_returns_429_with_retry_after() {
    let response = ApiError(ExternalChatError::RateLimited).into_response();
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
    let agent = || Some(serde_json::from_value(serde_json::json!(Uuid::now_v7())).unwrap());
    for (origin, agent_id, expected) in [
        (CredentialOrigin::Session, None, SendAuthority::Human),
        (
            CredentialOrigin::Session,
            agent(),
            SendAuthority::Automation,
        ),
        (
            CredentialOrigin::MacroApiJwt,
            None,
            SendAuthority::UserApiToken,
        ),
        (
            CredentialOrigin::MacroApiJwt,
            agent(),
            SendAuthority::UserApiToken,
        ),
        (
            CredentialOrigin::UserApiKey,
            None,
            SendAuthority::UserApiToken,
        ),
        (CredentialOrigin::Bot, None, SendAuthority::Automation),
        (CredentialOrigin::Harness, None, SendAuthority::Automation),
        (CredentialOrigin::Internal, None, SendAuthority::Automation),
    ] {
        let user = MacroUserAuthentication {
            origin,
            agent_id,
            macro_user_id: "macro|person@example.com".to_string().try_into().unwrap(),
            user_context: Default::default(),
        };
        assert_eq!(authority(&user), expected, "{origin:?}");
    }
}
