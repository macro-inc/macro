use std::sync::{Arc, Mutex};

use ai_billing::{AiAdmissionError, AiAdmissionService, DenyReason, DisabledAiAdmissionService};
use ai_usage::{AiFeature, UsageAmount, UsageEvent, UsageRecorder};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::{WebCaller, WebSearchService};
use crate::domain::models::{
    Billed, FetchedPage, PageRequest, ProviderError, SearchQuery, WebFetch, WebFetchResponse,
    WebSearch, WebSearchError, WebSearchResponse, WebSearchResult, WebSearchTopic,
};
use crate::domain::ports::SearchProvider;

#[derive(Default)]
struct FakeProvider {
    searches: Mutex<Vec<SearchQuery>>,
    fetches: Mutex<Vec<PageRequest>>,
}

#[async_trait]
impl SearchProvider for FakeProvider {
    fn pricing_model(&self) -> &'static str {
        "fake"
    }

    async fn search(
        &self,
        query: &SearchQuery,
    ) -> Result<Billed<Vec<WebSearchResult>>, ProviderError> {
        self.searches.lock().unwrap().push(query.clone());
        Ok(Billed {
            credits: Some(1),
            value: vec![
                WebSearchResult {
                    title: "First".into(),
                    url: "https://example.com/1".into(),
                    snippet: "one".into(),
                    published_at: None,
                    content: Some("abcdef".repeat(2_000)),
                },
                WebSearchResult {
                    title: "Second".into(),
                    url: "https://example.com/2".into(),
                    snippet: "two".into(),
                    published_at: Some("2026-11-01".into()),
                    content: None,
                },
            ],
        })
    }

    async fn fetch(&self, request: &PageRequest) -> Result<Billed<FetchedPage>, ProviderError> {
        self.fetches.lock().unwrap().push(request.clone());
        Ok(Billed {
            credits: Some(1),
            value: FetchedPage {
                url: request.url.to_string(),
                title: None,
                content: "héllo wörld".into(),
            },
        })
    }
}

#[derive(Default)]
struct Recorder(Mutex<Vec<UsageEvent>>);

impl UsageRecorder for Recorder {
    fn record(&self, event: UsageEvent) {
        self.0.lock().unwrap().push(event);
    }
}

struct Denied;

impl AiAdmissionService for Denied {
    fn admit<'a>(
        &'a self,
        _: &'a MacroUserIdStr<'_>,
        _: AiFeature,
    ) -> ai_billing::AdmissionFuture<'a> {
        Box::pin(async { Err(AiAdmissionError::Denied(DenyReason::AllowanceExhausted)) })
    }
}

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|web-search@example.com".to_owned()).unwrap()
}

#[tokio::test]
async fn search_passes_defaults_and_meters_credits_to_the_user() {
    let provider = Arc::new(FakeProvider::default());
    let recorder = Arc::new(Recorder::default());
    let service = WebSearchService::new(
        provider.clone(),
        Arc::new(DisabledAiAdmissionService),
        recorder.clone(),
    );
    let entity = Uuid::new_v4();

    let response = service
        .search(
            WebCaller {
                user: user(),
                entity: Some(entity),
            },
            WebSearch {
                query: "  macro docs  ".into(),
                domains: None,
                exclude_domains: None,
                since: None,
                topic: None,
                max_results: None,
                include_content: None,
            },
        )
        .await
        .unwrap();

    assert_eq!(
        *provider.searches.lock().unwrap(),
        vec![SearchQuery {
            query: "macro docs".into(),
            domains: vec![],
            exclude_domains: vec![],
            since: None,
            topic: WebSearchTopic::General,
            max_results: 5,
            include_content: false,
        }]
    );
    assert_eq!(
        response,
        WebSearchResponse {
            results: vec![
                WebSearchResult {
                    title: "First".into(),
                    url: "https://example.com/1".into(),
                    snippet: "one".into(),
                    published_at: None,
                    content: None,
                },
                WebSearchResult {
                    title: "Second".into(),
                    url: "https://example.com/2".into(),
                    snippet: "two".into(),
                    published_at: Some("2026-11-01".into()),
                    content: None,
                },
            ],
        }
    );
    let events = recorder.0.lock().unwrap();
    assert_eq!(events.len(), 1);
    assert_eq!(events[0].feature, AiFeature::WebSearch);
    assert_eq!(events[0].user, user());
    assert_eq!(events[0].entity, Some(entity));
    assert_eq!(events[0].model, "fake");
    assert_eq!(
        events[0].amount,
        UsageAmount::ProviderCredits { credits: 1 }
    );
}

#[tokio::test]
async fn search_content_is_cut_to_eight_thousand_characters() {
    let service = WebSearchService::new(
        Arc::new(FakeProvider::default()),
        Arc::new(DisabledAiAdmissionService),
        Arc::new(Recorder::default()),
    );

    let response = service
        .search(
            WebCaller::user(user()),
            WebSearch {
                query: "macro".into(),
                domains: None,
                exclude_domains: None,
                since: None,
                topic: None,
                max_results: Some(1),
                include_content: Some(true),
            },
        )
        .await
        .unwrap();

    assert_eq!(response.results.len(), 1);
    assert_eq!(
        response.results[0].content.as_deref().map(str::len),
        Some(8_000)
    );
}

#[tokio::test]
async fn invalid_requests_never_reach_the_provider() {
    let provider = Arc::new(FakeProvider::default());
    let service = WebSearchService::new(
        provider.clone(),
        Arc::new(DisabledAiAdmissionService),
        Arc::new(Recorder::default()),
    );

    for request in [
        WebSearch {
            query: "   ".into(),
            domains: None,
            exclude_domains: None,
            since: None,
            topic: None,
            max_results: None,
            include_content: None,
        },
        WebSearch {
            query: "x".repeat(401),
            domains: None,
            exclude_domains: None,
            since: None,
            topic: None,
            max_results: None,
            include_content: None,
        },
        WebSearch {
            query: "macro".into(),
            domains: None,
            exclude_domains: None,
            since: None,
            topic: None,
            max_results: Some(21),
            include_content: None,
        },
        WebSearch {
            query: "macro".into(),
            domains: Some(vec!["not a domain".into()]),
            exclude_domains: None,
            since: None,
            topic: None,
            max_results: None,
            include_content: None,
        },
    ] {
        let error = service
            .search(WebCaller::user(user()), request)
            .await
            .unwrap_err();
        assert!(
            matches!(error, WebSearchError::InvalidRequest(_)),
            "{error:?}"
        );
    }

    for url in ["ftp://example.com/file", "/relative", "https://"] {
        let error = service
            .fetch(
                WebCaller::user(user()),
                WebFetch {
                    url: url.into(),
                    max_chars: None,
                },
            )
            .await
            .unwrap_err();
        assert!(
            matches!(error, WebSearchError::InvalidRequest(_)),
            "{url}: {error:?}"
        );
    }

    assert!(provider.searches.lock().unwrap().is_empty());
    assert!(provider.fetches.lock().unwrap().is_empty());
}

#[tokio::test]
async fn admission_refusal_skips_the_provider_and_metering() {
    let provider = Arc::new(FakeProvider::default());
    let recorder = Arc::new(Recorder::default());
    let service = WebSearchService::new(provider.clone(), Arc::new(Denied), recorder.clone());

    let error = service
        .fetch(
            WebCaller::user(user()),
            WebFetch {
                url: "https://example.com/".into(),
                max_chars: None,
            },
        )
        .await
        .unwrap_err();

    assert!(
        matches!(
            error,
            WebSearchError::Admission(AiAdmissionError::Denied(DenyReason::AllowanceExhausted))
        ),
        "{error:?}"
    );
    assert!(provider.fetches.lock().unwrap().is_empty());
    assert!(recorder.0.lock().unwrap().is_empty());
}

#[tokio::test]
async fn fetch_cuts_on_character_boundaries() {
    let recorder = Arc::new(Recorder::default());
    let service = WebSearchService::new(
        Arc::new(FakeProvider::default()),
        Arc::new(DisabledAiAdmissionService),
        recorder.clone(),
    );

    let response = service
        .fetch(
            WebCaller::user(user()),
            WebFetch {
                url: "https://example.com/page".into(),
                max_chars: Some(2),
            },
        )
        .await
        .unwrap();

    assert_eq!(
        response,
        WebFetchResponse {
            url: "https://example.com/page".into(),
            title: None,
            content: "hé".into(),
            truncated: true,
        }
    );
    assert_eq!(recorder.0.lock().unwrap().len(), 1);
}
