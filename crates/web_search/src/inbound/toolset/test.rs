use std::sync::{Arc, Mutex};

use ai_billing::DisabledAiAdmissionService;
use ai_toolset::{AsyncTool, RequestContext, ServiceContext};
use ai_usage::{UsageEvent, UsageRecorder};
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;

use super::WebToolContext;
use crate::domain::models::{
    Billed, FetchedPage, PageRequest, ProviderError, SearchQuery, WebFetchRequest,
    WebSearchRequest, WebSearchResult,
};
use crate::domain::ports::SearchProvider;
use crate::domain::service::WebSearchService;

struct Unconfigured;

#[async_trait]
impl SearchProvider for Unconfigured {
    fn pricing_model(&self) -> &'static str {
        "tavily"
    }

    async fn search(&self, _: &SearchQuery) -> Result<Billed<Vec<WebSearchResult>>, ProviderError> {
        Err(ProviderError::NotConfigured("TAVILY_API_KEY"))
    }

    async fn fetch(&self, request: &PageRequest) -> Result<Billed<FetchedPage>, ProviderError> {
        Ok(Billed {
            credits: Some(1),
            value: FetchedPage {
                url: request.url.to_string(),
                title: None,
                content: "page".into(),
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

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|web-tool@example.com".to_owned()).unwrap()
}

#[tokio::test]
async fn fetch_is_attributed_to_the_requesting_user_and_turn_entity() {
    let recorder = Arc::new(Recorder::default());
    let entity = Uuid::new_v4();
    let context = ServiceContext(WebToolContext {
        service: Arc::new(WebSearchService::new(
            Arc::new(Unconfigured),
            Arc::new(DisabledAiAdmissionService),
            recorder.clone(),
        )),
        entity: Some(entity),
    });

    let page = WebFetchRequest {
        url: "https://example.com/".into(),
        max_chars: None,
    }
    .call(context, RequestContext::new(user()))
    .await
    .unwrap();

    assert_eq!(page.content, "page");
    let events = recorder.0.lock().unwrap();
    assert_eq!(events[0].user, user());
    assert_eq!(events[0].entity, Some(entity));
}

#[tokio::test]
async fn a_missing_key_reaches_the_model_as_a_clear_error() {
    let context = ServiceContext(WebToolContext {
        service: Arc::new(WebSearchService::new(
            Arc::new(Unconfigured),
            Arc::new(DisabledAiAdmissionService),
            Arc::new(Recorder::default()),
        )),
        entity: None,
    });

    let error = WebSearchRequest {
        query: "macro".into(),
        domains: None,
        exclude_domains: None,
        since: None,
        topic: None,
        max_results: None,
        include_content: None,
    }
    .call(context, RequestContext::new(user()))
    .await
    .unwrap_err();

    assert_eq!(
        error.description,
        "web_search_not_configured: web search is not configured: TAVILY_API_KEY is not set"
    );
}
