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
    description = "Search items by their name or title: document name, email subject, chat title, project name, the channel name a call belongs to. This is keyword search, not semantic search: queries only match literal words/tokens, prefixes, or exact quoted terms that appear in the indexed title/name. Use this for targeted name/title lookup, not for activity-summary questions like \"what happened today\", \"what's going on\", \"catch me up\", or \"what happened in standup today\"; those should start with ListEntities using time/type/channel filters. For emails, whitespace-separated terms are ANDed and each is a prefix match against the subject. For all other types the whole query is matched as a single adjacent phrase prefix — so pass 1-3 targeted keywords drawn from words that would literally appear in the title, not the user's natural-language description; long phrases will not match. Wrap a term in double quotes (e.g. `\"deal review\"`) to force exact-token matching instead of prefix. If the user's request combines a person with a topic, run separate searches (NameSearch for the person, ContentSearch for the topic) rather than one combined query. Leave entityTypes empty by default; only filter when the user explicitly scopes to a type.",
    title = "NameSearch"
)]
pub struct NameSearch {
    #[schemars(
        description = "The name or title to search. Pass 1-3 keywords drawn from words that would literally appear in the title, not the user's natural-language description. Whitespace-separated terms are ANDed. For non-email types the whole query is matched as a single adjacent phrase prefix, so long phrases will not match. For emails each term is matched against the subject. Wrap a term in double quotes to force exact-token matching."
    )]
    pub name: String,

    #[schemars(
        description = "Which types of items to search. Leave empty (the default) to search all types — this is almost always what you want. Only set this when the user's request clearly targets one or more specific types. Examples: ['documents'], ['emails', 'documents'], ['channels'], ['call_records']."
    )]
    #[serde(default)]
    pub entity_types: Vec<UnifiedSearchIndex>,
}

#[async_trait]
impl AsyncTool<SearchToolContext> for NameSearch {
    type Output = SearchToolResponse;

    #[tracing::instrument(skip_all, fields(user_id=?(*request_context.user_id).as_ref()), err)]
    async fn call(
        &self,
        search_context: ServiceContext<SearchToolContext>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(self=?self, "Name search params");

        if self.name.trim().is_empty() {
            return Err(ToolCallError {
                description: "name must not be empty".to_string(),
                internal_error: anyhow::anyhow!("name must not be empty"),
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
            query: self.name.to_owned(),
            match_type: MatchType::Partial,
            filters: entity_filters_from_include(self.entity_types.clone(), base_filters),
            search_on: models_search::SearchOn::Name,
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
                description: format!("failed to perform name search: {}", e),
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
