//! The connected user's Linear issues, read from Linear's GraphQL API
//! through the Pipedream Connect proxy.

use std::sync::Arc;

use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::models::{ConnectProxyError, ProxyRequest, ProxyResponse};
use pipedream_mcp::domain::ports::ConnectProxy;

use crate::domain::models::{ImportSource, LinearIssue};
use crate::domain::ports::{ApiSourceError, LinearSource};

mod parse;
#[cfg(test)]
mod test;

const LINEAR_GRAPHQL_URL: &str = "https://api.linear.app/graphql";
/// Issues per GraphQL page.
const PAGE_SIZE: usize = 100;
/// Linear refuses pages larger than this.
const MAX_PAGE_SIZE: usize = 250;
/// Linear documents `orderBy: updatedAt` without a direction, so discovery
/// reads a few pages and orders them itself; most users fit in one.
const MAX_PAGES: usize = 3;

/// Selection lives in GraphQL so closed issues never leave Linear; the
/// domain re-checks the state type anyway.
const ASSIGNED_OPEN_ISSUES: &str = include_str!("linear_api_source/assigned_open_issues.graphql");

/// Reads Linear through the user's Pipedream `linear` connection.
pub struct LinearApiSource<P> {
    proxy: Arc<P>,
}

impl<P> LinearApiSource<P> {
    /// Read through the host's Connect proxy.
    pub fn new(proxy: Arc<P>) -> Self {
        Self { proxy }
    }
}

impl<P: ConnectProxy> LinearApiSource<P> {
    async fn query(
        &self,
        user: &MacroUserIdStr<'static>,
        variables: serde_json::Value,
    ) -> Result<serde_json::Value, ApiSourceError> {
        let body = serde_json::json!({ "query": ASSIGNED_OPEN_ISSUES, "variables": variables });
        let response = self
            .proxy
            .send(
                user,
                linear_app_slug(),
                ProxyRequest::post_json(LINEAR_GRAPHQL_URL, body),
            )
            .await;
        classify(response)
    }
}

/// The Pipedream app the API path reads through.
fn linear_app_slug() -> &'static str {
    ImportSource::Linear.pipedream_app_slugs()[0]
}

/// Map one proxied response to GraphQL `data` or a typed failure.
fn classify(
    response: Result<ProxyResponse, ConnectProxyError>,
) -> Result<serde_json::Value, ApiSourceError> {
    let response = match response {
        Ok(response) => response,
        Err(ConnectProxyError::NotConnected { .. }) => {
            return Err(ApiSourceError::NotConnected(ImportSource::Linear));
        }
        Err(error) => return Err(ApiSourceError::Other(error.into())),
    };
    let rate_limited = || ApiSourceError::RateLimited {
        app: ImportSource::Linear,
        retry_after: response.retry_after,
    };
    match response.status {
        429 => return Err(rate_limited()),
        401 | 403 => return Err(ApiSourceError::Unauthorized(ImportSource::Linear)),
        _ => {}
    }
    let body: serde_json::Value = response.json().map_err(|error| {
        anyhow::anyhow!(
            "Linear returned {} with an unreadable body: {error}",
            response.status
        )
    })?;
    if parse::is_rate_limited(&body) {
        return Err(rate_limited());
    }
    if !response.is_success() || body.get("errors").is_some_and(|errors| !errors.is_null()) {
        return Err(anyhow::anyhow!(
            "Linear returned {}: {}",
            response.status,
            parse::error_messages(&body)
        )
        .into());
    }
    Ok(body)
}

impl<P: ConnectProxy> LinearSource for LinearApiSource<P> {
    #[tracing::instrument(skip(self, user), err(level = "debug"))]
    async fn assigned_open_issues(
        &self,
        user: &MacroUserIdStr<'static>,
        at_least: usize,
    ) -> Result<Vec<LinearIssue>, ApiSourceError> {
        let mut cursor: Option<String> = None;
        let mut issues = Vec::new();
        for _ in 0..MAX_PAGES {
            let body = self
                .query(
                    user,
                    serde_json::json!({ "first": PAGE_SIZE.max(at_least).min(MAX_PAGE_SIZE), "after": cursor }),
                )
                .await?;
            let page = parse::parse_assigned_issues_page(&body)?;
            issues.extend(page.issues);
            match page.next_cursor {
                Some(next) => cursor = Some(next),
                None => break,
            }
        }
        Ok(issues)
    }
}
