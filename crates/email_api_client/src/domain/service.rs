//! Provider-neutral email API orchestration.

use uuid::Uuid;

use super::models::{AccessToken, ApiOperationKind, EmailApiError, TokenError, TokenFreshness};
use super::ports::{ProviderRateLimiter, ProviderTokenSource};

mod attachments;
mod blocklist;
mod contacts;
mod labels;
mod messages;
mod send;
mod subscription;
mod sync;

#[cfg(test)]
mod test;
#[cfg(test)]
mod test_support;

/// Orchestrates provider-neutral email operations over capability ports.
#[derive(Clone)]
pub struct EmailApiClientServiceImpl<R, T, L> {
    repository: R,
    token_source: T,
    rate_limiter: L,
}

impl<R, T, L> EmailApiClientServiceImpl<R, T, L> {
    /// Creates an email API service from its provider and infrastructure ports.
    pub fn new(repository: R, token_source: T, rate_limiter: L) -> Self {
        Self {
            repository,
            token_source,
            rate_limiter,
        }
    }
}

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    T: ProviderTokenSource,
    L: ProviderRateLimiter,
{
    /// Acquires an access token for health probes or provider-adjacent work.
    ///
    /// Normal email operations acquire tokens internally. This explicit escape
    /// hatch supports callers that need to verify a grant or use the same grant
    /// with another Google API.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_access_token(
        &self,
        link_id: Uuid,
        freshness: TokenFreshness,
    ) -> Result<AccessToken, EmailApiError> {
        self.token_source
            .get_access_token(link_id, freshness)
            .await
            .map_err(map_token_error)
    }

    async fn prepare(
        &self,
        link_id: Uuid,
        operation: ApiOperationKind,
    ) -> Result<AccessToken, EmailApiError> {
        // Check the cheap local limiter first: under throttling this avoids
        // paying the full token dance (SELECT + Redis + possible auth-service
        // refresh + health write) per refused attempt. The limiter does not
        // consume provider quota on denial.
        self.rate_limiter
            .check_rate_limit(link_id, operation)
            .await
            .map_err(EmailApiError::from)?;

        self.get_access_token(link_id, TokenFreshness::Cached).await
    }
}

fn map_token_error(error: TokenError) -> EmailApiError {
    match error {
        TokenError::ReauthRequired => EmailApiError::AuthRequired,
        TokenError::Transient { message } => EmailApiError::Transient { message },
        TokenError::Permanent { message } => EmailApiError::Permanent { message },
    }
}
