//! Seeds the email-tagging routine for a new account.

use std::time::Duration;

use macro_authorization::INTERNAL_API_KEY_HEADER;
use rootcause::{Report, prelude::*};

/// HTTP client for the scheduled-action signup seed.
pub struct StarterRoutineClient {
    client: reqwest::Client,
    base_url: String,
    internal_key: String,
}

impl StarterRoutineClient {
    /// `internal_key` is the fleet-wide key the scheduled-action service
    /// validates. Redirects stay off so a failed internal POST cannot follow
    /// into an unrelated success.
    pub fn new(internal_key: String, base_url: String) -> Result<Self, Report> {
        Ok(Self {
            client: reqwest::Client::builder()
                .timeout(Duration::from_secs(30))
                .redirect(reqwest::redirect::Policy::none())
                .build()?,
            base_url,
            internal_key,
        })
    }

    /// Create the account's email-tagging routine, or leave the stored one
    /// as it is when signup runs again.
    #[tracing::instrument(skip(self, user_id), err)]
    pub async fn ensure(&self, user_id: &str) -> Result<(), Report> {
        let url = format!(
            "{}/scheduled-actions/user/{}/email-triage",
            self.base_url.trim_end_matches('/'),
            urlencoding::encode(user_id),
        );
        let response = self
            .client
            .post(url)
            .header(INTERNAL_API_KEY_HEADER, &self.internal_key)
            .send()
            .await
            .context("failed to seed email triage routine")?;
        let status = response.status();
        if !status.is_success() {
            tracing::error!(%status, "scheduled-action service rejected the email triage seed");
            return Err(rootcause::report!("email triage routine was not seeded"));
        }
        Ok(())
    }
}

#[cfg(test)]
mod test {
    use super::*;
    use std::sync::{Arc, Mutex};
    use tokio::io::{AsyncReadExt, AsyncWriteExt};

    #[tokio::test]
    async fn posts_the_encoded_user_with_the_internal_key() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        let seen = Arc::new(Mutex::new(String::new()));
        let recorded = Arc::clone(&seen);
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0; 2048];
            let read = socket.read(&mut buf).await.unwrap();
            *recorded.lock().unwrap() = String::from_utf8_lossy(&buf[..read]).into_owned();
            let _ = socket
                .write_all(b"HTTP/1.1 200 OK\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
                .await;
        });

        let client = StarterRoutineClient::new("fleet-key".into(), format!("http://{address}/"))
            .expect("client");
        client.ensure("macro|new@macro.com").await.expect("seed");

        let request = seen.lock().unwrap().clone();
        assert!(request.starts_with(
            "POST /scheduled-actions/user/macro%7Cnew%40macro.com/email-triage HTTP/1.1"
        ));
        assert!(
            request
                .to_ascii_lowercase()
                .contains("x-internal-auth-key: fleet-key")
        );
    }

    #[tokio::test]
    async fn a_rejected_seed_is_an_error() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let address = listener.local_addr().unwrap();
        tokio::spawn(async move {
            let (mut socket, _) = listener.accept().await.unwrap();
            let mut buf = vec![0; 1024];
            let _ = socket.read(&mut buf).await;
            let _ = socket
                .write_all(b"HTTP/1.1 500 Internal Server Error\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
                .await;
        });
        let client =
            StarterRoutineClient::new("fleet-key".into(), format!("http://{address}")).unwrap();
        assert!(client.ensure("macro|new@macro.com").await.is_err());
    }
}
