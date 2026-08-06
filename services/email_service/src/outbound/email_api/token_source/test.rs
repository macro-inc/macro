use authentication_service_client::error::AuthServiceClientError;
use email_api_client::domain::models::{TokenError, TokenFreshness};
use email_api_client::domain::ports::ProviderTokenSource;
use uuid::Uuid;

use super::{StaticTokenSource, map_token_acquisition_error};

#[test]
fn forbidden_auth_service_response_requires_reauthorization() {
    let error = anyhow::Error::new(AuthServiceClientError::Forbidden)
        .context("failed to acquire provider token");

    assert_eq!(
        map_token_acquisition_error(error),
        TokenError::ReauthRequired
    );
}

#[test]
fn missing_auth_service_grant_requires_reauthorization() {
    let error = anyhow::Error::new(AuthServiceClientError::NotFound)
        .context("failed to acquire provider token");

    assert_eq!(
        map_token_acquisition_error(error),
        TokenError::ReauthRequired
    );
}

#[test]
fn infrastructure_failure_is_transient_and_sanitized() {
    let error = anyhow::anyhow!("redis unavailable at redis://user:secret@example.test");

    assert_eq!(
        map_token_acquisition_error(error),
        TokenError::Transient {
            message: "email provider access token is temporarily unavailable".to_string(),
        }
    );
}

#[tokio::test]
async fn static_source_returns_token_for_both_freshness_modes() {
    let source = StaticTokenSource::new("access-token");
    let link_id = Uuid::new_v4();

    for freshness in [TokenFreshness::Cached, TokenFreshness::Fresh] {
        let token = source
            .get_access_token(link_id, freshness)
            .await
            .expect("static token should be available");
        assert_eq!(token.expose_secret(), "access-token");
    }
}
