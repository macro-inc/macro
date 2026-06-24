use super::context::SearchToolContext;
use super::types::{PAGE_SIZE, SearchToolResponse};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use item_filters::{EmailFilters, EntityFilters};
use models_search::{
    MatchType,
    unified::{UnifiedSearchIndex, UnifiedSearchRequest, entity_filters_from_include},
};
use schemars::JsonSchema;
use serde::Deserialize;

#[derive(Debug, JsonSchema, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    description = "Search items by their content: document body text; email subject/body/sender/recipient/cc/bcc and the display names on those addresses; chat messages; call transcripts. This is keyword search, not semantic search: queries only match literal words/tokens, prefixes, or exact quoted terms that appear in the indexed content. Use this for targeted keyword/content lookup, not for activity-summary questions like \"what happened today\", \"what's going on\", \"catch me up\", or \"what happened in standup today\"; those should start with ListEntities using time/type/channel filters. Whitespace-separated terms are ANDed. For documents and emails, every term must match somewhere in the document — different terms can appear in different chunks/pages or different fields. For documents and emails specifically, each single-word term is matched as a prefix (so `scri` matches `script`); for emails the prefix expansion also runs against the local-part of address fields. For chats, channels, and call transcripts the whole query is matched as a single adjacent phrase prefix — so pass 1-3 targeted keywords drawn from words that would literally appear in the content, not the user's natural-language description; long phrases will not match. Wrap a term in double quotes (e.g. `\"deal review\"` or `\"alice@example.com\"`) to force exact-token / exact-phrase matching instead of prefix. If the user's request combines a person with a topic, run separate searches rather than one combined query. Leave entityTypes empty by default; only filter when the user explicitly scopes to a type.",
    title = "ContentSearch"
)]
pub struct ContentSearch {
    #[schemars(
        description = "The text to search. Pass 1-3 keywords drawn from words that would literally appear in the content, not the user's natural-language description. Whitespace-separated terms are ANDed. For documents, every term must appear somewhere in the document (different chunks/pages are fine). For emails each term is matched across subject/body/sender/recipient. For chats/channels/calls the whole query is matched as a single adjacent phrase prefix, so long phrases will not match. Wrap a term in double quotes to force exact-token (or full-email-address) matching."
    )]
    pub query: String,

    #[schemars(
        description = "Which types of items to search. Leave empty (the default) to search all types — this is almost always what you want. Only set this when the user's request clearly targets one or more specific types. Examples: ['documents'], ['emails', 'documents'], ['channels'], ['call_records']."
    )]
    #[serde(default)]
    pub entity_types: Vec<UnifiedSearchIndex>,
}

#[async_trait]
impl AsyncTool<SearchToolContext> for ContentSearch {
    type Output = SearchToolResponse;

    #[tracing::instrument(skip_all, fields(user_id=?(*request_context.user_id).as_ref()), err)]
    async fn call(
        &self,
        search_context: ServiceContext<SearchToolContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(self=?self, "Content search params");

        if self.query.trim().is_empty() {
            return Err(ToolCallError {
                description: "query must not be empty".to_string(),
                internal_error: anyhow::anyhow!("query must not be empty"),
            });
        }

        let base_filters = EntityFilters {
            email_filters: EmailFilters {
                importance: Some(true),
                ..Default::default()
            },
            ..Default::default()
        };
        let search_request = UnifiedSearchRequest {
            query: self.query.to_owned(),
            match_type: MatchType::Partial,
            filters: entity_filters_from_include(self.entity_types.clone(), base_filters),
            search_on: models_search::SearchOn::Content,
            include_crm: false,
            collapse: None,
        };

        let response = search_context
            .search_client
            .search_unified(
                (*request_context.user_id).as_ref(),
                search_request,
                None,
                PAGE_SIZE,
            )
            .await
            .map_err(|e| ToolCallError {
                description: format!("failed to perform content search: {}", e),
                internal_error: e,
            })?;

        // Drop the chat the agent is currently running inside so it never
        // surfaces itself in its own search results.
        let mut results = response.results;
        if let Some(self_chat_id) = search_context.self_chat_id {
            results.retain(|item| item.entity_id() != self_chat_id);
        }

        Ok(SearchToolResponse { results })
    }
}
