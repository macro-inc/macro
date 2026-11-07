//! Generation-scoped Microsoft credentials and the email domain's provider adapter.

use authentication_service_client::{AuthServiceClient, error::AuthServiceClientError};
use email::domain::mailbox::{MailboxGateway, MailboxKey};
use email_api_client_core::{models::*, ports::*, service::mailbox::MailboxApiService};
use tracing::Instrument;

mod contacts;
mod drafts;
mod watches;

#[derive(Clone)]
pub struct MicrosoftCredentialsClient(pub AuthServiceClient);

impl email::domain::mailbox::credentials::MailboxCredentialGateway for MicrosoftCredentialsClient {
    async fn acquire(
        &self,
        mailbox: MailboxAccess,
        freshness: TokenFreshness,
    ) -> Result<email::domain::mailbox::credentials::MailboxCredentialToken, TokenError> {
        let fresh = matches!(freshness, TokenFreshness::Fresh);
        let span = tracing::info_span!(
            "outlook.token.acquire",
            mailbox.link_id = %mailbox.link_id,
            mailbox.sync_generation = mailbox.sync_generation,
            outlook.token_refresh_requested = fresh,
            outlook.token_cache = tracing::field::Empty,
            outlook.outcome = tracing::field::Empty,
            http.response.status_code = tracing::field::Empty,
            otel.status_description = tracing::field::Empty,
        );
        let result = self
            .0
            .get_microsoft_access_token(
                mailbox.link_id,
                mailbox.grant_generation,
                mailbox.sync_generation,
                fresh,
            )
            .instrument(span.clone())
            .await;
        record_token(&span, &result);
        result
            .map(
                |response| email::domain::mailbox::credentials::MailboxCredentialToken {
                    token: AccessToken::new(response.access_token),
                    scopes: response.scopes,
                },
            )
            .map_err(|error| match error {
                AuthServiceClientError::Unauthorized | AuthServiceClientError::Forbidden => {
                    TokenError::ReauthRequired
                }
                _ => TokenError::Transient {
                    message: "Microsoft authorization is temporarily unavailable".into(),
                },
            })
    }
}

/// `hit` only when authentication served a cached token; a refresh, a
/// failure or an older authentication service that does not say is a `miss`.
fn record_token(
    span: &tracing::Span,
    result: &Result<
        authentication_service_client::microsoft_access_token::MicrosoftAccessToken,
        AuthServiceClientError,
    >,
) {
    let cached = matches!(result, Ok(token) if token.cached == Some(true));
    span.record("outlook.token_cache", if cached { "hit" } else { "miss" });
    let outcome = match result {
        Ok(_) => "ok",
        Err(AuthServiceClientError::Unauthorized | AuthServiceClientError::Forbidden) => {
            "auth_required"
        }
        Err(_) => "unavailable",
    };
    span.record("outlook.outcome", outcome);
    if let Err(error) = result {
        span.record("otel.status_description", tracing::field::display(error));
    }
}

/// The adapter depends only on the foreign domain service and its capability ports.
/// Concrete Graph and storage adapters are supplied by the composition root.
#[derive(Clone)]
pub struct ProviderMailboxGateway<R, T, L>(pub MailboxApiService<R, T, L>);

fn access(mailbox: MailboxKey) -> MailboxAccess {
    MailboxAccess {
        link_id: mailbox.link_id,
        sync_generation: mailbox.sync_generation,
        grant_generation: mailbox.grant_generation,
    }
}

impl<R, T, L> email::domain::mailbox::projection::MailboxAttachmentAccess
    for ProviderMailboxGateway<R, T, L>
where
    R: MailboxContentReader + ScopedMailboxRepository,
    T: MailboxTokenSource,
    L: ProviderRateLimiter,
{
    async fn download(
        &self,
        mailbox: MailboxKey,
        message_id: &str,
        attachment_id: &str,
    ) -> Result<Vec<u8>, email::domain::mailbox::MailboxError> {
        Ok(self
            .0
            .attachment(
                access(mailbox),
                &ProviderId::new(message_id)?,
                &ProviderId::new(attachment_id)?,
            )
            .await?)
    }
}

impl<R, T, L> MailboxGateway for ProviderMailboxGateway<R, T, L>
where
    R: MailboxContentReader + FolderChangeReader + MailboxRequestCount + ScopedMailboxRepository,
    T: MailboxTokenSource,
    L: ProviderRateLimiter,
{
    async fn folders(&self, mailbox: MailboxKey) -> Result<Vec<MailFolder>, EmailApiError> {
        self.0.folders(access(mailbox)).await
    }
    async fn changes(
        &self,
        mailbox: MailboxKey,
        folder: &ProviderId,
        position: Option<&StreamToken>,
    ) -> Result<MailboxChangePage, EmailApiError> {
        self.0.changes(access(mailbox), folder, position).await
    }
    async fn message(
        &self,
        mailbox: MailboxKey,
        id: &ProviderId,
        folders: &[MailFolder],
    ) -> Result<Option<MailboxMessage>, EmailApiError> {
        self.0.message(access(mailbox), id, folders).await
    }
    async fn admitted_requests(&self, mailbox: MailboxKey) -> Option<u64> {
        self.0.admitted_requests(access(mailbox)).await
    }
}

impl<R, T, L> email::domain::mailbox::commands::MailboxCommandGateway
    for ProviderMailboxGateway<R, T, L>
where
    R: MailboxContentReader
        + FolderChangeReader
        + MailboxActionWriter
        + MailboxRequestCount
        + ScopedMailboxRepository,
    T: MailboxTokenSource,
    L: ProviderRateLimiter,
{
    async fn organization(
        &self,
        mailbox: MailboxKey,
        message: &ProviderId,
        folders: &[MailFolder],
    ) -> Result<Option<MailboxOrganization>, EmailApiError> {
        self.0.organization(access(mailbox), message, folders).await
    }
    async fn apply(
        &self,
        mailbox: MailboxKey,
        message: &ProviderId,
        action: &MessageAction,
        expected_version: Option<&str>,
    ) -> Result<email_api_client_core::models::MessageWriteReceipt, EmailApiError> {
        self.0
            .apply(access(mailbox), message, action, expected_version)
            .await
    }
}
