//! Microsoft Graph v1.0 adapter. Credentials and retry policy belong to callers.

mod calendar;
mod categories;
mod contacts;
mod drafts;
mod invitations;
mod messages;
mod route;
mod rules;
mod sync;
mod transport;
mod wire;

#[cfg(test)]
mod test;

use std::time::Duration;

use reqwest::Client;
use url::Url;

use email_api_client_core::models::EmailApiError;
use email_api_client_core::{
    models::MailboxAccess,
    ports::{
        MailboxRejectedTokenRefresh, MailboxRequestCount, MailboxRequestGate,
        ScopedMailboxRepository,
    },
};
use std::sync::Arc;

const GRAPH_ROOT: &str = "https://graph.microsoft.com/v1.0/";
const IMMUTABLE_ID_PREFERENCE: &str = "IdType=\"ImmutableId\"";
/// Graph reads `$top` on a delta request as a cap on the whole round, not a
/// page size: it stops at that many items and hands back the deltaLink, so
/// the rest of the folder is never listed. Delta pages are sized with this
/// preference instead, sent as its own `Prefer` line so the immutable-id one
/// stays as it is.
const DELTA_PAGE_PREFERENCE: &str = "odata.maxpagesize=100";

/// Microsoft Graph provider adapter with no embedded credential or mailbox identity.
#[derive(Clone)]
pub struct OutlookApiClientRepository {
    client: Client,
    root: Url,
    mailbox: Option<MailboxAccess>,
    gate: Option<Arc<dyn MailboxRequestGate>>,
    rejected_token_refresh: Option<Arc<dyn MailboxRejectedTokenRefresh>>,
    refreshed_token: Arc<std::sync::Mutex<Option<email_api_client_core::models::AccessToken>>>,
}

impl OutlookApiClientRepository {
    /// Calendar callers supply exact-binding refresh without embedding credentials.
    pub fn with_rejected_token_refresh(
        mut self,
        refresh: Arc<dyn MailboxRejectedTokenRefresh>,
    ) -> Self {
        self.rejected_token_refresh = Some(refresh);
        self
    }
    /// All processes handling this application share the injected request gate.
    pub fn with_gate(gate: Arc<dyn MailboxRequestGate>) -> Result<Self, EmailApiError> {
        let mut repository = Self::new()?;
        repository.gate = Some(gate);
        Ok(repository)
    }
    /// Build a public-cloud Graph adapter with redirects and automatic retries disabled.
    pub fn new() -> Result<Self, EmailApiError> {
        let root = Url::parse(GRAPH_ROOT)
            .map_err(|_| transport::invalid_response("Graph root is not a URL"))?;
        Self::with_root(root)
    }

    fn with_root(root: Url) -> Result<Self, EmailApiError> {
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(10))
            .build()
            .map_err(|_| EmailApiError::Permanent {
                message: "could not initialize Microsoft Graph client".into(),
            })?;
        Ok(Self {
            client,
            root,
            mailbox: None,
            gate: None,
            rejected_token_refresh: None,
            refreshed_token: Arc::new(std::sync::Mutex::new(None)),
        })
    }

    #[cfg(test)]
    fn for_test(root: &str) -> Self {
        Self::with_root(Url::parse(root).unwrap()).unwrap()
    }
}

impl MailboxRequestCount for OutlookApiClientRepository {
    async fn admitted_requests(&self, mailbox: MailboxAccess) -> Option<u64> {
        self.gate.as_ref()?.admitted(mailbox).await
    }
}

impl ScopedMailboxRepository for OutlookApiClientRepository {
    fn for_mailbox(&self, mailbox: MailboxAccess) -> Self {
        Self {
            mailbox: Some(mailbox),
            refreshed_token: Arc::new(std::sync::Mutex::new(None)),
            ..self.clone()
        }
    }
}
