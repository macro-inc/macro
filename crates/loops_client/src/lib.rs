#![deny(missing_docs)]
//! Loops (loops.so) client for adding contacts to our Loops audience.
//!
//! Used to push Macro sign-ups into Loops so they receive our marketing emails.

#[cfg(test)]
mod test;

use serde::Serialize;
use sha2::{Digest, Sha256};

/// Base URL for the Loops API.
const LOOPS_API_BASE_URL: &str = "https://app.loops.so/api";

const REQUEST_TIMEOUT_SECONDS: u64 = 15;

/// Loops suppresses duplicate sends for the same key within 24 hours.
const IDEMPOTENCY_KEY_HEADER: &str = "Idempotency-Key";

/// Hashes an idempotency key to a fixed 64 characters.
///
/// Loops caps the header at 100 characters, and callers build keys from
/// unbounded input — an email, or a `MacroUserId`, which embeds one. Hashing
/// keeps every key in range while staying deterministic across retries, which
/// is the whole point of the header.
fn idempotency_digest(key: &str) -> String {
    format!("{:x}", Sha256::digest(key.as_bytes()))
}

/// Normalizes an email for use as a Loops contact identifier: lowercased, with
/// any `+` tag stripped from the local part.
///
/// Every Loops call site must use this. A mobile lead captured as
/// `a+test@x.com` and the account they later register as `a+test@x.com` must
/// resolve to the same contact, or the nurture sequence never sees the
/// registration and both sequences run at once.
pub fn normalize_email(email: &str) -> String {
    let lowercase = email.to_lowercase();
    match lowercase.split_once('@') {
        Some((local, domain)) => {
            let local = local.split('+').next().unwrap_or(local);
            format!("{local}@{domain}")
        }
        None => lowercase,
    }
}

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

    /// Sends an event to Loops. Events trigger Loops automations, and upsert
    /// the contact in the same request — so this both creates the contact (if
    /// new) and fires the trigger, with no window where a loop can evaluate
    /// before the contact properties land.
    ///
    /// Returns `Ok(())` if Loops is not configured (no-op).
    ///
    /// - `email`: the contact's address; pass through [`normalize_email`] first
    /// - `event_name`: matched against the trigger configured on a Loop
    /// - `contact_properties`: JSON object of properties to set on the contact.
    ///   Each must already exist in Loops. Ignored if not an object.
    /// - `idempotency_key`: suppresses duplicate sends within 24 hours. Any
    ///   length is fine; it is hashed before being sent.
    #[tracing::instrument(skip(self, contact_properties), err)]
    pub async fn send_event(
        &self,
        email: &str,
        event_name: &str,
        contact_properties: &serde_json::Value,
        idempotency_key: Option<&str>,
    ) -> Result<(), reqwest::Error> {
        let Some(inner) = &self.inner else {
            tracing::debug!("loops not configured");
            return Ok(());
        };

        let url = format!("{LOOPS_API_BASE_URL}/v1/events/send");

        // Contact properties sit at the top level of the body, alongside
        // `email` and `eventName`. Insert them first so the required fields
        // win if a caller passes a colliding key.
        let mut payload = serde_json::Map::new();
        if let Some(properties) = contact_properties.as_object() {
            payload.extend(properties.clone());
        }
        payload.insert("email".to_string(), email.into());
        payload.insert("eventName".to_string(), event_name.into());

        let mut request = inner.client.post(&url).bearer_auth(&inner.api_key);

        if let Some(key) = idempotency_key {
            request = request.header(IDEMPOTENCY_KEY_HEADER, idempotency_digest(key));
        }

        request.json(&payload).send().await?.error_for_status()?;

        Ok(())
    }
}

/// Request body for the Loops "create contact" endpoint.
#[derive(Serialize)]
struct ContactCreateRequest<'a> {
    email: &'a str,
    source: &'a str,
}
