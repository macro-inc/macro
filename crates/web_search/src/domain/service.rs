//! Web search and fetch for a user: validation, AI admission, the provider
//! call, and usage metering. HTTP and tool adapters share this service.

use std::sync::Arc;

use ai_billing::AiAdmissionService;
use ai_usage::{AiFeature, UsageContext, UsageRecorder};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::models::{
    Billed, DEFAULT_FETCH_CHARS, DEFAULT_RESULTS, MAX_DOMAINS, MAX_EXCLUDED_DOMAINS,
    MAX_FETCH_CHARS, MAX_QUERY_CHARS, MAX_RESULTS, PageRequest, SEARCH_CONTENT_CHARS, SearchQuery,
    WebFetch, WebFetchResponse, WebSearch, WebSearchError, WebSearchResponse, WebSearchResult,
};
use super::ports::SearchProvider;

#[cfg(test)]
mod test;

/// Who a request is for, for admission and usage attribution.
#[derive(Debug, Clone)]
pub struct WebCaller {
    /// The user whose allowance pays for the request.
    pub user: MacroUserIdStr<'static>,
    /// The entity the request relates to (a chat or agent session), if any.
    pub entity: Option<Uuid>,
}

impl WebCaller {
    /// A request attributed only to `user`.
    pub fn user(user: MacroUserIdStr<'static>) -> Self {
        Self { user, entity: None }
    }
}

/// Web search and fetch, admitted against and metered to the caller's AI allowance.
#[derive(Clone)]
pub struct WebSearchService {
    provider: Arc<dyn SearchProvider>,
    admission: Arc<dyn AiAdmissionService>,
    recorder: Arc<dyn UsageRecorder>,
}

impl WebSearchService {
    /// Compose a provider with the host's admission policy and usage recorder.
    pub fn new(
        provider: Arc<dyn SearchProvider>,
        admission: Arc<dyn AiAdmissionService>,
        recorder: Arc<dyn UsageRecorder>,
    ) -> Self {
        Self {
            provider,
            admission,
            recorder,
        }
    }

    /// Search the web for `caller`.
    #[tracing::instrument(name = "web.search", skip_all, err, fields(
        web.provider = self.provider.pricing_model(),
        web.max_results = tracing::field::Empty,
        web.result_count = tracing::field::Empty,
        web.credits = tracing::field::Empty,
    ))]
    pub async fn search(
        &self,
        caller: WebCaller,
        request: WebSearch,
    ) -> Result<WebSearchResponse, WebSearchError> {
        let query = validate_search(request)?;
        tracing::Span::current().record("web.max_results", query.max_results);
        self.admission
            .admit(&caller.user, AiFeature::WebSearch)
            .await?;

        let Billed { value, credits } = self.provider.search(&query).await?;
        self.record(caller, credits);

        let results: Vec<WebSearchResult> = value
            .into_iter()
            .take(usize::from(query.max_results))
            .map(|result| WebSearchResult {
                content: result
                    .content
                    .filter(|_| query.include_content)
                    .map(|content| truncate(content, SEARCH_CONTENT_CHARS).0),
                ..result
            })
            .collect();
        tracing::Span::current().record("web.result_count", results.len());
        Ok(WebSearchResponse { results })
    }

    /// Read one page for `caller`.
    #[tracing::instrument(name = "web.fetch", skip_all, err, fields(
        web.provider = self.provider.pricing_model(),
        web.truncated = tracing::field::Empty,
        web.credits = tracing::field::Empty,
    ))]
    pub async fn fetch(
        &self,
        caller: WebCaller,
        request: WebFetch,
    ) -> Result<WebFetchResponse, WebSearchError> {
        let (page, max_chars) = validate_fetch(request)?;
        self.admission
            .admit(&caller.user, AiFeature::WebSearch)
            .await?;

        let Billed { value, credits } = self.provider.fetch(&page).await?;
        self.record(caller, credits);

        let (content, truncated) = truncate(value.content, max_chars);
        tracing::Span::current().record("web.truncated", truncated);
        Ok(WebFetchResponse {
            url: value.url,
            title: value.title,
            content,
            truncated,
        })
    }

    fn record(&self, caller: WebCaller, credits: Option<u64>) {
        let Some(credits) = credits else {
            tracing::warn!("web search provider reported no usage; nothing recorded");
            return;
        };
        tracing::Span::current().record("web.credits", credits);
        self.recorder.record(
            UsageContext::new(AiFeature::WebSearch, caller.user)
                .with_entity(caller.entity)
                .into_provider_credits_event(self.provider.pricing_model().to_owned(), credits),
        );
    }
}

fn validate_search(request: WebSearch) -> Result<SearchQuery, WebSearchError> {
    let query = request.query.trim().to_owned();
    if query.is_empty() || query.chars().count() > MAX_QUERY_CHARS {
        return Err(WebSearchError::InvalidRequest(format!(
            "query must be between 1 and {MAX_QUERY_CHARS} characters"
        )));
    }

    let max_results = request.max_results.unwrap_or(DEFAULT_RESULTS);
    if !(1..=MAX_RESULTS).contains(&max_results) {
        return Err(WebSearchError::InvalidRequest(format!(
            "maxResults must be between 1 and {MAX_RESULTS}"
        )));
    }

    let domains = validate_domains(request.domains, MAX_DOMAINS, "domains")?;
    let exclude_domains = validate_domains(
        request.exclude_domains,
        MAX_EXCLUDED_DOMAINS,
        "excludeDomains",
    )?;

    Ok(SearchQuery {
        query,
        domains,
        exclude_domains,
        since: request.since,
        topic: request.topic.unwrap_or_default(),
        max_results,
        include_content: request.include_content.unwrap_or(false),
    })
}

fn validate_domains(
    domains: Option<Vec<String>>,
    limit: usize,
    field: &str,
) -> Result<Vec<String>, WebSearchError> {
    let domains: Vec<String> = domains
        .unwrap_or_default()
        .into_iter()
        .map(|domain| domain.trim().to_owned())
        .collect();
    if domains.len() > limit {
        return Err(WebSearchError::InvalidRequest(format!(
            "{field} accepts at most {limit} domains"
        )));
    }
    if domains
        .iter()
        .any(|domain| domain.is_empty() || domain.contains(char::is_whitespace))
    {
        return Err(WebSearchError::InvalidRequest(format!(
            "{field} must be domain names such as example.com"
        )));
    }
    Ok(domains)
}

fn validate_fetch(request: WebFetch) -> Result<(PageRequest, usize), WebSearchError> {
    let url = url::Url::parse(request.url.trim())
        .map_err(|_| WebSearchError::InvalidRequest("url must be an absolute URL".into()))?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(WebSearchError::InvalidRequest(
            "url must be an http or https URL with a host".into(),
        ));
    }

    let max_chars = request.max_chars.unwrap_or(DEFAULT_FETCH_CHARS);
    if !(1..=MAX_FETCH_CHARS).contains(&max_chars) {
        return Err(WebSearchError::InvalidRequest(format!(
            "maxChars must be between 1 and {MAX_FETCH_CHARS}"
        )));
    }

    Ok((PageRequest { url }, max_chars as usize))
}

/// Cut `text` to at most `max_chars` characters, reporting whether it was cut.
fn truncate(text: String, max_chars: usize) -> (String, bool) {
    match text.char_indices().nth(max_chars) {
        Some((end, _)) => (text[..end].to_owned(), true),
        None => (text, false),
    }
}
