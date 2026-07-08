use std::time::Duration;

use reqwest::{Method, StatusCode};

use super::EmailServiceClientExternal;

#[cfg(test)]
mod test;

const INIT_EMAIL_TIMEOUT: Duration = Duration::from_secs(10);

/// Outcome of a `POST /email/init` provisioning attempt.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InitEmailOutcome {
    /// The inbox was provisioned and a backfill was started.
    Provisioned,
    /// The service answered 400: the inbox is already initialized or the user
    /// holds no Gmail grant to provision from. Expected, not an error.
    Skipped,
}

fn classify_init_status(status: StatusCode) -> Option<InitEmailOutcome> {
    if status.is_success() {
        Some(InitEmailOutcome::Provisioned)
    } else if status == StatusCode::BAD_REQUEST {
        Some(InitEmailOutcome::Skipped)
    } else {
        None
    }
}

impl EmailServiceClientExternal {
    /// Provisions the caller's primary inbox via `POST /email/init`.
    ///
    /// Init is idempotent, so a failed attempt is safe to retry.
    pub async fn init_email(&self, jwt: &str) -> anyhow::Result<InitEmailOutcome> {
        let res = self
            .request(Method::POST, "/email/init", jwt)
            .timeout(INIT_EMAIL_TIMEOUT)
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
