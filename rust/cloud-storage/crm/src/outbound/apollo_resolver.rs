//! [`CompanyMetadataResolver`] adapter backed by the Apollo.io
//! organization-enrichment API.
//!
//! Calls `GET https://api.apollo.io/api/v1/organizations/enrich?domain={domain}`
//! with an `x-api-key` header and maps the returned `organization` object
//! onto [`DomainMetadata`]. The full payload — minus our own Apollo
//! workspace `account` record — is preserved in [`DomainMetadata::raw`].
//!
//! Best-effort: any failure (network error, non-2xx status, malformed
//! body, missing `organization`) is logged and surfaced as
//! [`DomainMetadata::default`] so the caller can persist a negative-cache
//! row and avoid re-resolving the domain.

#[cfg(test)]
mod test;

use std::time::Duration;

use chrono::{DateTime, Utc};
use serde_json::Value;

use crate::domain::{company_metadata_resolver::CompanyMetadataResolver, model::DomainMetadata};

/// Default Apollo API base URL.
const DEFAULT_BASE_URL: &str = "https://api.apollo.io";

/// Request timeout for Apollo calls — a stalled connection must not block
/// the populate worker indefinitely.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);

/// Build the reqwest client with the request timeout applied.
fn build_client() -> reqwest::Client {
    reqwest::Client::builder()
        .timeout(REQUEST_TIMEOUT)
        .build()
        .expect("apollo reqwest client should build")
}

/// Adapter that resolves [`DomainMetadata`] via Apollo.io organization
/// enrichment. Cheap to [`Clone`] — the inner [`reqwest::Client`] is
/// reference-counted.
#[derive(Clone)]
pub struct ApolloCompanyMetadataResolver {
    client: reqwest::Client,
    api_key: String,
    base_url: String,
}

impl ApolloCompanyMetadataResolver {
    /// Build a resolver with the given Apollo API key and a fresh HTTP client.
    pub fn new(api_key: String) -> Self {
        Self {
            client: build_client(),
            api_key,
            base_url: DEFAULT_BASE_URL.to_string(),
        }
    }

    /// Build a resolver pointed at a custom base URL (used in tests).
    pub fn with_base_url(api_key: String, base_url: String) -> Self {
        Self {
            client: build_client(),
            api_key,
            base_url,
        }
    }
}

impl CompanyMetadataResolver for ApolloCompanyMetadataResolver {
    #[tracing::instrument(skip(self))]
    async fn resolve(&self, domain: &str) -> DomainMetadata {
        // No key configured (e.g. local without APOLLO_API_KEY): skip the
        // call entirely rather than burning a 401 and caching an empty row.
        if self.api_key.is_empty() {
            tracing::debug!(domain, "apollo enrich: no api key configured; skipping");
            return DomainMetadata::default();
        }

        let url = format!("{}/api/v1/organizations/enrich", self.base_url);
        let response = self
            .client
            .get(&url)
            .query(&[("domain", domain)])
            .header("x-api-key", self.api_key.as_str())
            .header(reqwest::header::ACCEPT, "application/json")
            .send()
            .await;

        let body = match response {
            Ok(resp) if resp.status().is_success() => match resp.json::<Value>().await {
                Ok(body) => body,
                Err(e) => {
                    tracing::warn!(error=?e, domain, "apollo enrich: failed to parse body");
                    return DomainMetadata::default();
                }
            },
            Ok(resp) => {
                tracing::warn!(status = %resp.status(), domain, "apollo enrich: non-success status");
                return DomainMetadata::default();
            }
            Err(e) => {
                tracing::warn!(error=?e, domain, "apollo enrich: request failed");
                return DomainMetadata::default();
            }
        };

        let Some(organization) = body.get("organization") else {
            tracing::warn!(domain, "apollo enrich: response had no organization");
            return DomainMetadata::default();
        };

        map_organization(organization)
    }
}

/// Map an Apollo `organization` JSON object onto [`DomainMetadata`].
/// Tolerant of missing / mistyped fields — anything unreadable stays
/// `None` / empty. The `account` and `account_id` keys (our own Apollo
/// workspace record, not company data) are stripped from `raw`.
fn map_organization(org: &Value) -> DomainMetadata {
    let mut raw = org.clone();
    if let Some(obj) = raw.as_object_mut() {
        obj.remove("account");
        obj.remove("account_id");
    }

    DomainMetadata {
        name: str_field(org, "name"),
        description: str_field(org, "short_description"),
        icon_url: str_field(org, "logo_url"),
        apollo_organization_id: str_field(org, "id"),
        website_url: str_field(org, "website_url"),
        linkedin_url: str_field(org, "linkedin_url"),
        twitter_url: str_field(org, "twitter_url"),
        facebook_url: str_field(org, "facebook_url"),
        industry: str_field(org, "industry"),
        keywords: str_array(org, "keywords"),
        technologies: str_array(org, "technology_names"),
        estimated_num_employees: i32_field(org, "estimated_num_employees"),
        annual_revenue: i64_field(org, "annual_revenue"),
        annual_revenue_printed: str_field(org, "annual_revenue_printed"),
        total_funding: i64_field(org, "total_funding"),
        total_funding_printed: str_field(org, "total_funding_printed"),
        latest_funding_stage: str_field(org, "latest_funding_stage"),
        latest_funding_round_date: date_field(org, "latest_funding_round_date"),
        founded_year: i32_field(org, "founded_year"),
        publicly_traded_symbol: str_field(org, "publicly_traded_symbol"),
        publicly_traded_exchange: str_field(org, "publicly_traded_exchange"),
        phone: str_field(org, "phone"),
        raw_address: str_field(org, "raw_address"),
        street_address: str_field(org, "street_address"),
        city: str_field(org, "city"),
        state: str_field(org, "state"),
        postal_code: str_field(org, "postal_code"),
        country: str_field(org, "country"),
        raw: Some(raw),
    }
}

/// Read a string field; `None` when absent, null, non-string, or
/// blank after trimming.
fn str_field(org: &Value, key: &str) -> Option<String> {
    let s = org.get(key)?.as_str()?.trim();
    (!s.is_empty()).then(|| s.to_string())
}

/// Read an integer field as `i64`. Floats and strings yield `None`.
fn i64_field(org: &Value, key: &str) -> Option<i64> {
    org.get(key)?.as_i64()
}

/// Read an integer field as `i32`, dropping out-of-range values.
fn i32_field(org: &Value, key: &str) -> Option<i32> {
    i32::try_from(org.get(key)?.as_i64()?).ok()
}

/// Read an array-of-strings field, skipping non-string / blank elements.
fn str_array(org: &Value, key: &str) -> Vec<String> {
    org.get(key)
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(str::trim)
                .filter(|s| !s.is_empty())
                .map(String::from)
                .collect()
        })
        .unwrap_or_default()
}

/// Read an RFC 3339 timestamp field; `None` when absent or unparseable.
fn date_field(org: &Value, key: &str) -> Option<DateTime<Utc>> {
    let s = org.get(key)?.as_str()?;
    DateTime::parse_from_rfc3339(s)
        .ok()
        .map(|dt| dt.with_timezone(&Utc))
}
