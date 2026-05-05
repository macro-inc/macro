use super::types::{PAGE_SIZE, SearchToolResponse};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use item_filters::{EmailFilters, EntityFilters};
use models_search::{
    MatchType,
    unified::{UnifiedSearchIndex, UnifiedSearchRequest, entity_filters_from_include},
};
use schemars::JsonSchema;
use search_service_client::SearchServiceClient;
use serde::Deserialize;
use std::sync::Arc;

#[derive(Debug, JsonSchema, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    description = "Search for items by their name or title. For documents, this searches the document name. For emails, this searches the subject line. For chats, this searches the chat title. For projects (folders), this searches the project name. For call records, this searches the channel name the call took place in. This tool finds items based on what they're called, not their content.\n\nMulti-term behavior: every whitespace-separated term must match (AND). For emails, each term is matched with prefix semantics against the subject. Wrapping a value in double quotes (e.g. `\"deal review\"`) keeps it as a single term and forces exact-token matching for that term rather than a prefix. For all other entity types, the whole query is treated as a single phrase prefix, so 'release notes' looks for those words adjacent in that order in the name/title.\n\nPrefer searching all types by default — leave entityTypes empty unless the user's request clearly targets a specific type. Don't narrow the search just because the query mentions a noun like 'email' or 'doc'; only filter when the user has explicitly scoped the request to that type.",
    title = "NameSearch"
)]
pub struct NameSearch {
    #[schemars(
        description = "The name or title to search for. For emails, this is the subject line. For channels, this can be the channel name or participant names. For call records, this is the channel name the call belongs to. Whitespace-separated terms are ANDed (every term must match). For non-email types the whole query is matched as an adjacent phrase. For emails each term is matched independently against the subject; wrap a term in double quotes to force exact-token matching instead of prefix matching."
    )]
    pub name: String,

    #[schemars(
        description = "Which types of items to search. Leave empty (the default) to search all types — this is almost always what you want. Only set this when the user's request clearly targets one or more specific types. Examples: ['documents'], ['emails', 'documents'], ['channels'], ['call_records']."
    )]
    #[serde(default)]
    pub entity_types: Vec<UnifiedSearchIndex>,
}

#[async_trait]
impl AsyncTool<Arc<SearchServiceClient>> for NameSearch {
    type Output = SearchToolResponse;

    #[tracing::instrument(skip_all, fields(user_id=?(*request_context.user_id).as_ref()), err)]
    async fn call(
        &self,
        search_client: ServiceContext<Arc<SearchServiceClient>>,
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
            collapse: Some(true),
        };

        let response = search_client
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

        Ok(SearchToolResponse {
            results: response.results,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ai_toolset::generate_tool_input_schema;
    use ai_toolset::tool_object::validate_tool_schema;

    #[test]
    fn test_name_search_schema_validation() {
        let schema = generate_tool_input_schema!(NameSearch);

        let result = validate_tool_schema(&schema);
        assert!(result.is_ok(), "{:?}", result);

        let (name, description) = result.unwrap();
        assert_eq!(
            name, "NameSearch",
            "Tool name should match the schemars title"
        );
        assert!(
            description.contains("Search for items by their name"),
            "Description should contain expected text"
        );
    }
}
