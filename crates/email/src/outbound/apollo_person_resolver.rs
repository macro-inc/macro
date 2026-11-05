//! [`PersonProfileResolver`] backed by Apollo.io bulk people enrichment.
//!
//! Calls `POST https://api.apollo.io/api/v1/people/bulk_match` with up to ten
//! `{ "email": … }` details and an `x-api-key` header. Personal emails and
//! phone numbers are never requested. Apollo answers positionally: `matches`
//! has one entry per detail, `null` when unmatched.
//!
//! Only matches Apollo marks `high` or `medium` confidence are kept; a
//! lower or missing confidence may be someone else, so it is stored as a miss. A missing API key,
//! network error, non-2xx status (including rate limits), or malformed body is
//! logged and surfaced as [`PersonResolution::Unavailable`], so nothing is
//! cached and a later read retries.

#[cfg(test)]
mod test;

use std::time::Duration;

use serde_json::{Value, json};

use crate::domain::person_profiles::{PersonProfile, PersonProfileResolver, PersonResolution};

const DEFAULT_BASE_URL: &str = "https://api.apollo.io";

/// A stalled Apollo call must not hold the thread read open.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(8);

/// Resolves profiles through Apollo.io. Cheap to [`Clone`]: the inner
/// [`reqwest::Client`] is reference-counted.
#[derive(Clone)]
pub struct ApolloPersonProfileResolver {
    client: reqwest::Client,
    api_key: String,
    base_url: String,
}

impl std::fmt::Debug for ApolloPersonProfileResolver {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("ApolloPersonProfileResolver")
            .field("base_url", &self.base_url)
            .finish_non_exhaustive()
    }
}

impl ApolloPersonProfileResolver {
    /// Build a resolver with the given Apollo API key.
    pub fn new(api_key: String) -> Result<Self, reqwest::Error> {
        Self::with_base_url(api_key, DEFAULT_BASE_URL.to_string())
    }

    /// Build a resolver pointed at a custom base URL (used in tests).
    pub fn with_base_url(api_key: String, base_url: String) -> Result<Self, reqwest::Error> {
        Ok(Self {
            client: reqwest::Client::builder()
                .timeout(REQUEST_TIMEOUT)
                .build()?,
            api_key,
            base_url,
        })
    }
}

impl PersonProfileResolver for ApolloPersonProfileResolver {
    #[tracing::instrument(skip_all, fields(requested = addresses.len()))]
    async fn resolve(&self, addresses: &[String]) -> PersonResolution {
        if self.api_key.is_empty() {
            tracing::debug!("apollo people match: no api key configured; skipping");
            return PersonResolution::Unavailable;
        }
        if addresses.is_empty() {
            return PersonResolution::Resolved(Vec::new());
        }

        let details: Vec<Value> = addresses
            .iter()
            .map(|address| json!({ "email": address }))
            .collect();
        let response = self
            .client
            .post(format!("{}/api/v1/people/bulk_match", self.base_url))
            .query(&[
                ("reveal_personal_emails", "false"),
                ("reveal_phone_number", "false"),
            ])
            .header("x-api-key", self.api_key.as_str())
            .header(reqwest::header::ACCEPT, "application/json")
            .json(&json!({ "details": details }))
            .send()
            .await;

        let body = match response {
            Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
                Ok(body) => body,
                Err(error) => {
                    tracing::warn!(?error, "apollo people match: failed to parse body");
                    return PersonResolution::Unavailable;
                }
            },
            Ok(resp) => {
                tracing::warn!(status = %resp.status(), "apollo people match: non-success status");
                return PersonResolution::Unavailable;
            }
            Err(error) => {
                tracing::warn!(?error, "apollo people match: request failed");
                return PersonResolution::Unavailable;
            }
        };

        let Some(matches) = body
            .get("matches")
            .and_then(Value::as_array)
            .filter(|matches| matches.len() == addresses.len())
        else {
            tracing::warn!("apollo people match: matches missing or not one per request");
            return PersonResolution::Unavailable;
        };

        PersonResolution::Resolved(
            addresses
                .iter()
                .zip(matches)
                .map(|(address, person)| map_person(address, person))
                .collect(),
        )
    }
}

/// Map one Apollo `matches` entry onto a [`PersonProfile`] for `address`.
fn map_person(address: &str, person: &Value) -> PersonProfile {
    let confident = matches!(
        person.get("match_confidence").and_then(Value::as_str),
        Some("high" | "medium")
    );
    if !confident {
        return PersonProfile::unmatched(address.to_string());
    }
    PersonProfile {
        email_address: address.to_string(),
        linkedin_url: str_field(person, "linkedin_url").and_then(|url| linkedin_profile_url(&url)),
        headline: str_field(person, "headline"),
        title: str_field(person, "title"),
        organization_name: person
            .get("organization")
            .and_then(|organization| str_field(organization, "name")),
        photo_url: str_field(person, "photo_url").and_then(|url| photo_url(&url)),
    }
}

/// An HTTP(S) URL as browsers parse it, without credentials.
fn web_url(raw: &str) -> Option<url::Url> {
    let url = url::Url::parse(raw).ok()?;
    (matches!(url.scheme(), "http" | "https")
        && url.host_str().is_some()
        && url.username().is_empty()
        && url.password().is_none())
    .then_some(url)
}

/// A LinkedIn URL rewritten to HTTPS; anything whose host is not linkedin.com
/// is dropped so the link the client renders always goes to LinkedIn.
fn linkedin_profile_url(raw: &str) -> Option<String> {
    let mut url = web_url(raw)?;
    let host = url.host_str()?;
    if host != "linkedin.com" && !host.ends_with(".linkedin.com") {
        return None;
    }
    url.set_scheme("https").ok()?;
    Some(url.into())
}

/// Photos load through the image proxy, which fetches only HTTPS.
fn photo_url(raw: &str) -> Option<String> {
    web_url(raw)
        .filter(|url| url.scheme() == "https")
        .map(Into::into)
}

/// Read a string field; `None` when absent, null, non-string, or blank.
fn str_field(value: &Value, key: &str) -> Option<String> {
    let s = value.get(key)?.as_str()?.trim();
    (!s.is_empty()).then(|| s.to_string())
}
