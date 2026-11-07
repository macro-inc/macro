//! Strict remote evaluation through PostHog's V2 `/flags` endpoint.

use crate::{FeatureFlags, FlagSnapshot, FlagValue};
use macro_user_id::user_id::MacroUserIdStr;
use reqwest::{Client, Url};
use rootcause::Report;
use serde::Deserialize;
use std::{collections::HashMap, time::Duration};

#[cfg(test)]
mod test;

/// Remote loader with one reusable HTTP connection pool.
///
/// Construct once per service and clone to share the pool. Each load makes one
/// request; snapshot reads never make requests or record exposure events.
#[derive(Clone)]
pub struct PostHogFeatureFlags {
    client: Client,
    endpoint: Url,
    project_key: String,
    timeout: Duration,
}

impl PostHogFeatureFlags {
    /// Validate configuration and create the shared client.
    ///
    /// `host` must be an HTTP(S) origin (for example `https://us.i.posthog.com`),
    /// without credentials, a path, query, or fragment. Use the ingestion origin
    /// for the project's region. `project_key` must be nonblank and `timeout`
    /// nonzero. There is no disabled mode: missing configuration is an error.
    /// Redirects and automatic retries are disabled. The timeout bounds the
    /// entire load, including reading the response body.
    pub fn new(host: &str, project_key: String, timeout: Duration) -> Result<Self, Report> {
        let mut endpoint =
            Url::parse(host).map_err(|_| rootcause::report!("Invalid PostHog origin"))?;
        if !matches!(endpoint.scheme(), "https" | "http")
            || endpoint.host_str().is_none()
            || !endpoint.username().is_empty()
            || endpoint.password().is_some()
            || endpoint.path() != "/"
            || endpoint.query().is_some()
            || endpoint.fragment().is_some()
        {
            return Err(rootcause::report!("PostHog host must be an HTTP(S) origin"));
        }
        if project_key.trim().is_empty() || project_key.trim() != project_key {
            return Err(rootcause::report!(
                "PostHog project key must be nonblank without surrounding whitespace"
            ));
        }
        if timeout.is_zero() || std::time::Instant::now().checked_add(timeout).is_none() {
            return Err(rootcause::report!(
                "PostHog timeout must be positive and finite"
            ));
        }
        endpoint.set_path("/flags/");
        endpoint.set_query(Some("v=2"));
        let client = Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .retry(reqwest::retry::never())
            .timeout(timeout)
            .build()
            .map_err(|error| LoadError::Transport(error.without_url()))?;
        Ok(Self {
            client,
            endpoint,
            project_key,
            timeout,
        })
    }

    async fn evaluate(&self, user_id: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        let response = self
            .client
            .post(self.endpoint.clone())
            .json(&serde_json::json!({
                "api_key": self.project_key,
                "distinct_id": user_id.as_ref(),
                "evaluation_runtime": "server",
                "geoip_disable": true,
            }))
            .send()
            .await
            .map_err(|error| LoadError::Transport(error.without_url()))?;
        if !response.status().is_success() {
            return Err(LoadError::HttpStatus(response.status().as_u16()).into());
        }
        // Never retain a decode error: serde's diagnostics may contain values
        // from the provider response, including user properties or flag keys.
        let body = response
            .bytes()
            .await
            .map_err(|error| LoadError::Transport(error.without_url()))?;
        let response: FlagsResponse =
            serde_json::from_slice(&body).map_err(|_| LoadError::MalformedResponse)?;
        if response.errors_while_computing_flags
            || !response.quota_limited.is_empty()
            || response.error.is_some()
            || !response.errors.is_empty()
        {
            return Err(LoadError::IncompleteEvaluation.into());
        }
        let flags = response
            .flags
            .into_iter()
            .map(|(key, flag)| {
                if flag.failed {
                    return Err(LoadError::IncompleteEvaluation);
                }
                if key.is_empty()
                    || key != flag.key
                    || flag.variant.as_ref().is_some_and(String::is_empty)
                {
                    return Err(LoadError::MalformedResponse);
                }
                let value = match (flag.enabled, flag.variant) {
                    (false, _) => FlagValue::Boolean(false),
                    (true, Some(variant)) => FlagValue::Variant(variant),
                    (true, None) => FlagValue::Boolean(true),
                };
                Ok((key, value))
            })
            .collect::<Result<Vec<_>, _>>()?;
        Ok(FlagSnapshot::new(flags))
    }
}

impl FeatureFlags for PostHogFeatureFlags {
    async fn load(&self, user_id: &MacroUserIdStr<'_>) -> Result<FlagSnapshot, Report> {
        tokio::time::timeout(self.timeout, self.evaluate(user_id))
            .await
            .map_err(|_| LoadError::Timeout)?
    }
}

#[derive(Debug, thiserror::Error)]
enum LoadError {
    #[error("PostHog transport failed")]
    Transport(#[source] reqwest::Error),
    #[error("PostHog returned HTTP status {0}")]
    HttpStatus(u16),
    #[error("PostHog returned a malformed flags response")]
    MalformedResponse,
    #[error("PostHog could not completely evaluate feature flags")]
    IncompleteEvaluation,
    #[error("PostHog flag load timed out")]
    Timeout,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FlagsResponse {
    // Required: neither a missing map nor missing health status is success.
    flags: HashMap<String, Flag>,
    errors_while_computing_flags: bool,
    #[serde(default)]
    quota_limited: Vec<String>,
    error: Option<serde_json::Value>,
    #[serde(default)]
    errors: Vec<serde_json::Value>,
}

#[derive(Deserialize)]
struct Flag {
    key: String,
    enabled: bool,
    variant: Option<String>,
    #[serde(default)]
    failed: bool,
}
