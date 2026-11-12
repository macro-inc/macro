use super::*;
use authentication_service_client::{AuthServiceClient, error::AuthServiceClientError};
use email_api_client::domain::models::{AccessToken, EmailApiError, TokenFreshness};
use std::sync::Arc;

mod token_scopes;

pub struct GoogleConnectionProvider {
    pub gmail: crate::outbound::email_api::GmailApi,
    pub auth: Arc<AuthServiceClient>,
}

impl ConnectionProvider for GoogleConnectionProvider {
    type ScopeErr = InboxPersistenceError;
    type RelocationErr = AuthServiceClientError;

    async fn register_watch(&self, link: &Link) -> Result<String, EmailApiError> {
        self.gmail
            .register_subscription_without_cache(link)
            .await
            .map(|subscription| subscription.cursor.as_str().to_owned())
    }

    async fn fresh_token(&self, link: Uuid) -> Result<AccessToken, EmailApiError> {
        self.gmail
            .get_access_token(link, TokenFreshness::Fresh)
            .await
    }

    async fn token_scopes(&self, token: &AccessToken) -> Result<Vec<String>, Self::ScopeErr> {
        token_scopes::fetch_token_scopes(token.expose_secret())
            .await
            .map_err(Into::into)
    }

    async fn relocate_grant(
        &self,
        email: &str,
        owner: &str,
        shared_owner: &str,
    ) -> Result<String, Self::RelocationErr> {
        self.auth
            .relocate_inbox_grant(email, owner, shared_owner)
            .await
    }
}
