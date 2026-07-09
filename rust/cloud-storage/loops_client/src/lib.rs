#![deny(missing_docs)]
//! Loops (loops.so) client for adding contacts to our Loops audience.
//!
//! Used to push Macro sign-ups into Loops so they receive our marketing emails.

use serde::Serialize;

/// Base URL for the Loops API.
const LOOPS_API_BASE_URL: &str = "https://app.loops.so/api";

const REQUEST_TIMEOUT_SECONDS: u64 = 15;

/// Client for the Loops (loops.so) API.
///
/// When no API key is configured the client is a no-op, mirroring the
/// [`analytics_client`](../analytics_client) pattern so local/dev environments
/// don't need Loops credentials.
#[derive(Clone)]
pub struct LoopsClient {
    inner: Option<Inner>,
}

#[derive(Clone)]
struct Inner {
    client: reqwest::Client,
    api_key: String,
}

impl LoopsClient {
    /// Creates a new Loops client with the given API key.
    pub fn new(api_key: String) -> Self {
        Self {
            inner: Some(Inner {
                client: reqwest::Client::builder()
                    .timeout(std::time::Duration::from_secs(REQUEST_TIMEOUT_SECONDS))
                    .build()
                    .unwrap(),
                api_key,
            }),
        }
    }

    /// Creates a no-op Loops client (no API key configured).
    pub fn noop() -> Self {
        Self { inner: None }
    }

    /// Creates a contact in Loops, adding them to our audience (subscribed to
    /// marketing emails by default).
    ///
    /// Returns `Ok(())` if Loops is not configured (no-op). A `409 Conflict`
    /// (the contact already exists in the audience) is treated as success.
    ///
    /// - `email`: the contact's email address
    /// - `source`: a custom source label recorded on the Loops contact
    #[tracing::instrument(skip(self), err)]
    pub async fn add_contact(&self, email: &str, source: &str) -> Result<(), reqwest::Error> {
        let Some(inner) = &self.inner else {
            tracing::debug!("loops not configured");
            return Ok(());
        };

        let url = format!("{LOOPS_API_BASE_URL}/v1/contacts/create");

        let payload = ContactCreateRequest { email, source };

        let response = inner
            .client
            .post(&url)
            .bearer_auth(&inner.api_key)
            .json(&payload)
            .send()
            .await?;

        // A contact that already exists returns 409. Treat that as success —
        // the person is already in our audience, which is all we care about.
        if response.status() == reqwest::StatusCode::CONFLICT {
            tracing::info!("loops contact already exists");
            return Ok(());
        }

        response.error_for_status()?;

        Ok(())
    }
}

/// Request body for the Loops "create contact" endpoint.
#[derive(Serialize)]
struct ContactCreateRequest<'a> {
    email: &'a str,
    source: &'a str,
}
