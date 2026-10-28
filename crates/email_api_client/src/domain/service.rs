//! Provider-neutral email API orchestration.

use uuid::Uuid;

use super::models::{
    AccessToken, ApiOperationKind, EmailApiError, RateLimitOrigin, RequestPermit, TokenError,
    TokenFreshness,
};
use super::ports::{ProviderRequestGate, ProviderTokenSource};

mod attachments;
mod blocklist;
mod contacts;
mod labels;
/// Credential and quota orchestration for generation-bound mailbox operations.
pub mod mailbox;
mod messages;
pub use messages::SEPARATE_LABEL_WRITES_BELOW;
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
    gate: L,
}

impl<R, T, L> EmailApiClientServiceImpl<R, T, L> {
    /// Creates an email API service from its provider and infrastructure ports.
    pub fn new(repository: R, token_source: T, gate: L) -> Self {
        Self {
            repository,
            token_source,
            gate,
        }
    }
}

impl<R, T, L> EmailApiClientServiceImpl<R, T, L>
where
    T: ProviderTokenSource,
    L: ProviderRequestGate,
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

    /// Runs one provider call with the cached token, without retrying.
    ///
    /// Admission and token failures are logged in the calling operation's
    /// span; the call's own errors are left to the caller.
    async fn call_with_token<O, F, Fut>(
        &self,
        link_id: Uuid,
        operation: ApiOperationKind,
        call: F,
    ) -> Result<O, EmailApiError>
    where
        F: FnOnce(AccessToken) -> Fut,
        Fut: Future<Output = Result<O, EmailApiError>>,
    {
        self.attempt(
            link_id,
            operation,
            self.get_access_token(link_id, TokenFreshness::Cached),
            call,
        )
        .await?
    }

    /// Runs a provider read with the cached token, retrying once with a fresh
    /// token if the provider rejects it, and logs a failure in the calling
    /// operation's span.
    ///
    /// Callers declare `retry_count = 0` on their span; a retry sets it to 1.
    /// Like every provider call, they also declare the empty fields that
    /// [`Self::admit`] records.
    async fn read_with_token<O, F, Fut>(
        &self,
        link_id: Uuid,
        operation: ApiOperationKind,
        read: F,
    ) -> Result<O, EmailApiError>
    where
        F: Fn(AccessToken) -> Fut,
        Fut: Future<Output = Result<O, EmailApiError>>,
    {
        self.retry_with_fresh_token(link_id, operation, read)
            .await?
            .inspect_err(log_operation_error)
    }

    /// Runs a provider read with the cached token, retrying once with a fresh
    /// token if the provider rejects it.
    ///
    /// A cached token can outlive its grant. Only a fresh fetch reaches the
    /// authentication service, which either renews the token or reports the
    /// revoked grant so the token source marks the link for reauthorization.
    ///
    /// Like [`Self::attempt`], admission and token failures are logged and
    /// returned as the outer error; the provider's final answer is left to the
    /// caller.
    async fn retry_with_fresh_token<O, F, Fut>(
        &self,
        link_id: Uuid,
        operation: ApiOperationKind,
        read: F,
    ) -> Result<Result<O, EmailApiError>, EmailApiError>
    where
        F: Fn(AccessToken) -> Fut,
        Fut: Future<Output = Result<O, EmailApiError>>,
    {
        let cached = self.get_access_token(link_id, TokenFreshness::Cached);
        match self.attempt(link_id, operation, cached, &read).await? {
            Err(EmailApiError::AuthRequired) => {
                tracing::Span::current().record("retry_count", 1);
                let fresh = self.get_access_token(link_id, TokenFreshness::Fresh);
                self.attempt(link_id, operation, fresh, &read).await
            }
            result => Ok(result),
        }
    }

    /// Makes one provider call under an admission permit.
    ///
    /// The gate is checked before `token` runs: under throttling this avoids
    /// paying the token dance (SELECT + Redis + possible auth-service refresh +
    /// health write) per refused attempt. An admission or token failure is
    /// logged and returned as the outer error; the provider's answer is the
    /// inner result, which also decides whether the mailbox cools down. If
    /// the caller is cancelled first, the dropped permit releases itself.
    async fn attempt<O, F, Fut>(
        &self,
        link_id: Uuid,
        operation: ApiOperationKind,
        token: impl Future<Output = Result<AccessToken, EmailApiError>>,
        call: F,
    ) -> Result<Result<O, EmailApiError>, EmailApiError>
    where
        F: FnOnce(AccessToken) -> Fut,
        Fut: Future<Output = Result<O, EmailApiError>>,
    {
        let permit = self.admit(link_id, operation).await?;
        let result = match token.await.inspect_err(log_operation_error) {
            Ok(token) => Ok(call(token).await),
            Err(error) => Err(error),
        };
        let provider_error = result.as_ref().ok().and_then(|call| call.as_ref().err());
        self.gate.finish(permit, provider_error).await;
        result
    }

    /// Takes an admission permit, logging a refusal in the calling
    /// operation's span.
    ///
    /// Calling operations declare `gate_in_flight` and `gate_cap` as empty
    /// span fields. They record the mailbox's load at admission next to the
    /// request's outcome, which is how Gmail's real concurrency limit can be
    /// measured.
    async fn admit(
        &self,
        link_id: Uuid,
        operation: ApiOperationKind,
    ) -> Result<RequestPermit, EmailApiError> {
        let permit = self
            .gate
            .acquire(link_id, operation)
            .await
            .map_err(EmailApiError::from)
            .inspect_err(log_operation_error)?;
        if let Some(load) = permit.load() {
            tracing::Span::current()
                .record("gate_in_flight", load.in_flight)
                .record("gate_cap", load.cap);
        }
        Ok(permit)
    }
}

/// Logs a failed operation in the current span.
///
/// Unlike `#[instrument(err)]`, whose level is fixed, this distinguishes a
/// local rate-limit refusal: expected backpressure where no provider request
/// was made and the caller decides when to retry. It is logged at
/// DEBUG; every other failure, including provider throttling, stays at ERROR.
fn log_operation_error(error: &EmailApiError) {
    match error {
        EmailApiError::RateLimited {
            origin: RateLimitOrigin::Local,
            ..
        } => tracing::debug!(error = %error),
        EmailApiError::RateLimited { origin, .. } => {
            tracing::error!(error = %error, origin = ?origin)
        }
        _ => tracing::error!(error = %error),
    }
}

fn map_token_error(error: TokenError) -> EmailApiError {
    match error {
        TokenError::ReauthRequired => EmailApiError::AuthRequired,
        TokenError::Transient { message } => EmailApiError::Transient { message },
        TokenError::Permanent { message } => EmailApiError::Permanent { message },
    }
}
