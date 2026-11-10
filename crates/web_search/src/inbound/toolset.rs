//! `WebSearch` and `WebFetch` agent tools, for every model and host.

use std::sync::Arc;

use ai_toolset::{
    AsyncTool, AsyncToolCollection, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations,
    ToolCallError, ToolResult,
};
use async_trait::async_trait;
use macro_uuid::Uuid;

use crate::domain::models::{
    WebFetch, WebFetchResponse, WebSearch, WebSearchError, WebSearchResponse,
};
use crate::domain::service::{WebCaller, WebSearchService};

#[cfg(test)]
mod test;

/// The use case plus the entity the calling turn belongs to.
#[derive(Clone)]
pub struct WebToolContext {
    /// Web search, admitted and metered to the requesting user.
    pub service: Arc<WebSearchService>,
    /// Entity usage is attributed to (the chat or agent session), if any.
    pub entity: Option<Uuid>,
}

/// The web tools.
pub fn web_toolset() -> AsyncToolCollection<WebToolContext> {
    AsyncToolCollection::new()
        .add_tool::<WebSearch, WebToolContext>()
        .add_tool::<WebFetch, WebToolContext>()
}

impl ToolAnnotated for WebSearch {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Search the web")
        .with_open_world()
        .without_idempotent();
}

impl ToolAnnotated for WebFetch {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Fetch a web page")
        .with_open_world()
        .without_idempotent();
}

fn tool_error(error: WebSearchError) -> ToolCallError {
    ToolCallError {
        description: format!("{}: {error}", error.code()),
        internal_error: error.into(),
    }
}

#[async_trait]
impl AsyncTool<WebToolContext> for WebSearch {
    type Output = WebSearchResponse;

    async fn call(
        &self,
        service_context: ServiceContext<WebToolContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        service_context
            .service
            .search(
                WebCaller {
                    user: request_context.user_id,
                    entity: service_context.entity,
                },
                self.clone(),
            )
            .await
            .map_err(tool_error)
    }
}

#[async_trait]
impl AsyncTool<WebToolContext> for WebFetch {
    type Output = WebFetchResponse;

    async fn call(
        &self,
        service_context: ServiceContext<WebToolContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        service_context
            .service
            .fetch(
                WebCaller {
                    user: request_context.user_id,
                    entity: service_context.entity,
                },
                self.clone(),
            )
            .await
            .map_err(tool_error)
    }
}
