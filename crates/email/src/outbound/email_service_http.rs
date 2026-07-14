use std::time::Duration;

use reqwest::StatusCode;

use crate::domain::ports::{FirstInboxProvisionOutcome, FirstInboxProvisioner};

#[cfg(test)]
mod test;

const INIT_TIMEOUT: Duration = Duration::from_secs(10);

/// HTTP adapter for the email service's user-facing API, authenticated as the
/// user via a bearer token. Lets other services drive email flows through the
/// same routes and authorization the user's own client would use.
#[derive(Clone, Debug)]
pub struct EmailServiceHttpClient {
    url: String,
    client: reqwest::Client,
}

impl EmailServiceHttpClient {
    /// Creates a client rooted at the email service base url.
    pub fn new(url: String) -> Self {
        Self {
            url,
            client: reqwest::Client::new(),
        }
    }
}

fn classify_init_status(status: StatusCode) -> Option<FirstInboxProvisionOutcome> {
    if status.is_success() {
        Some(FirstInboxProvisionOutcome::Provisioned)
    } else if status == StatusCode::BAD_REQUEST {
        Some(FirstInboxProvisionOutcome::Skipped)
    } else {
        None
    }
}

impl FirstInboxProvisioner for EmailServiceHttpClient {
    /// `POST /email/init`. `Skipped` covers the service's 400 no-op answers
    /// (inbox already initialized, or no Gmail grant to provision from).
    async fn provision_first_inbox(
        &self,
        access_token: &str,
    ) -> anyhow::Result<FirstInboxProvisionOutcome> {
        let res = self
            .client
            .post(format!("{}/email/init", self.url))
            .bearer_auth(access_token)
            .timeout(INIT_TIMEOUT)
            .send()
            .await?;

        let status = res.status();
        match classify_init_status(status) {
            Some(outcome) => Ok(outcome),
            None => {
                let body = res.text().await.unwrap_or_else(|_| "no body".to_string());
                anyhow::bail!("HTTP {status}: {body}")
            }
        }
    }
}
