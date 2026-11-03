//! HTTP adapter for searching the web as the authenticated caller.

use super::context::{ApiContext, DcsAuthorizationService};
use ai_billing::inbound::admission::admission_status;
use ai_tools::AnthropicToolContext;
use ai_toolset::RequestContext;
use ai_usage::{AiFeature, UsageContext};
use anthropic::toolset::{ServerToolError, WebSearchQuery, search_web};
use anthropic::types::response::web_search::{SearchResult, WebSearchContent};
use axum::{
    Json,
    extract::{FromRef, State, rejection::JsonRejection},
    http::StatusCode,
    response::IntoResponse,
};
use macro_authorization::{MacroAuthorizationExtractor, UserOrInternal};
use serde::{Deserialize, Serialize};
use utoipa::ToSchema;

#[cfg(test)]
mod test;

const MAX_QUERY_CHARS: usize = 400;
const MAX_DOMAINS: usize = 20;
const MAX_RESULTS: usize = 30;

/// What to search the web for.
#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WebSearchRequest {
    /// The search query, up to 400 characters.
    pub query: String,
    /// Only return pages from these domains, such as `docs.rs`; omit to search
    /// the whole web. At most 20.
    #[serde(default)]
    pub domains: Vec<String>,
    /// Return at most this many results, from 1 to 30 (the default).
    #[serde(default)]
    pub max_results: Option<usize>,
}

/// Pages the search found, most relevant first.
#[derive(Debug, Deserialize, Serialize, ToSchema)]
pub struct WebSearchResponse {
    /// Found pages, deduplicated by URL.
    pub results: Vec<WebSearchResult>,
}

/// One page found by a web search.
#[derive(Debug, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct WebSearchResult {
    /// The page title.
    pub title: String,
    /// The page URL.
    pub url: String,
    /// How old the page is, as free text from the search index ("April 30,
    /// 2025" or "3 days ago"), when known. Not a parseable date.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub page_age: Option<String>,
}

/// Sanitized, machine-readable failure of a web search.
#[derive(Debug, Serialize, ToSchema, thiserror::Error)]
#[error("{error}")]
pub struct WebSearchErrorBody {
    /// Human-readable explanation without provider credentials or diagnostics.
    pub error: String,
    /// Stable failure code.
    pub code: String,
    #[serde(skip)]
    status: StatusCode,
}

impl WebSearchErrorBody {
    fn new(status: StatusCode, code: &str, error: impl Into<String>) -> Self {
        Self {
            error: error.into(),
            code: code.to_owned(),
            status,
        }
    }

    fn invalid(error: impl Into<String>) -> Self {
        Self::new(StatusCode::BAD_REQUEST, "invalid_web_search_request", error)
    }
}

impl IntoResponse for WebSearchErrorBody {
    fn into_response(self) -> axum::response::Response {
        (self.status, Json(self)).into_response()
    }
}

#[utoipa::path(
    post,
    path = "/web/search",
    operation_id = "searchWeb",
    request_body = WebSearchRequest,
    responses(
        (status = 200, description = "Pages found for the query", body = WebSearchResponse),
        (status = 400, description = "Invalid query, domains, or result limit", body = WebSearchErrorBody),
        (status = 401, description = "Unauthorized"),
        (status = 402, description = "AI allowance exhausted", body = WebSearchErrorBody),
        (status = 429, description = "The search provider is rate limiting searches", body = WebSearchErrorBody),
        (status = 502, description = "The search provider failed", body = WebSearchErrorBody),
        (status = 503, description = "Usage validation unavailable", body = WebSearchErrorBody),
    )
)]
#[tracing::instrument(
    skip_all,
    fields(user_id = %user.authorization.user.macro_user_id, result_count = tracing::field::Empty),
    err
)]
pub async fn search_web_handler(
    State(state): State<ApiContext>,
    user: MacroAuthorizationExtractor<DcsAuthorizationService, UserOrInternal>,
    request: Result<Json<WebSearchRequest>, JsonRejection>,
) -> Result<Json<WebSearchResponse>, WebSearchErrorBody> {
    let Json(request) = request.map_err(|_| {
        WebSearchErrorBody::invalid(
            "expected JSON with a query and optional domains and maxResults",
        )
    })?;
    let query = request.query.trim();
    if query.is_empty() || query.chars().count() > MAX_QUERY_CHARS {
        return Err(WebSearchErrorBody::invalid(format!(
            "query must be 1 to {MAX_QUERY_CHARS} characters"
        )));
    }
    if request.domains.len() > MAX_DOMAINS {
        return Err(WebSearchErrorBody::invalid(format!(
            "at most {MAX_DOMAINS} domains"
        )));
    }
    if request
        .max_results
        .is_some_and(|max| !(1..=MAX_RESULTS).contains(&max))
    {
        return Err(WebSearchErrorBody::invalid(format!(
            "maxResults must be 1 to {MAX_RESULTS}"
        )));
    }

    let user_id = user.authorization.user.macro_user_id.clone();
    let mut context = AnthropicToolContext::from_ref(&state.tool_service_context);
    context.admission = state.ai_admission.clone();
    context.usage_context = UsageContext::new(AiFeature::DynamicCompletionsApi, user_id.clone());
    let response = search_web(
        &context,
        &RequestContext::new(user_id),
        &WebSearchQuery {
            query: query.to_owned(),
            allowed_domains: request.domains,
        },
    )
    .await
    .map_err(|error| match error {
        ServerToolError::Admission(admission) => WebSearchErrorBody::new(
            admission_status(admission),
            admission.code(),
            admission.to_string(),
        ),
        ServerToolError::Provider(error) => {
            tracing::error!(error = ?error, "web search provider call failed");
            WebSearchErrorBody::new(
                StatusCode::BAD_GATEWAY,
                "web_search_failed",
                "the web search failed; try again shortly",
            )
        }
    })?;

    let found = match response.content {
        WebSearchContent::Results(found) => found,
        WebSearchContent::Error(error) => {
            let (status, code) = match error.error_code.as_str() {
                "invalid_input" | "query_too_long" => {
                    (StatusCode::BAD_REQUEST, "invalid_web_search_request")
                }
                "too_many_requests" => (StatusCode::TOO_MANY_REQUESTS, "web_search_rate_limited"),
                _ => (StatusCode::BAD_GATEWAY, "web_search_failed"),
            };
            return Err(WebSearchErrorBody::new(
                status,
                code,
                format!("the web search failed: {}", error.error_code),
            ));
        }
    };
    let results = found
        .into_iter()
        .take(request.max_results.unwrap_or(MAX_RESULTS))
        .map(|result| {
            let SearchResult::WebSearchResult {
                title,
                url,
                page_age,
                ..
            } = result;
            WebSearchResult {
                title,
                url,
                page_age,
            }
        })
        .collect::<Vec<_>>();
    tracing::Span::current().record("result_count", results.len());
    Ok(Json(WebSearchResponse { results }))
}
