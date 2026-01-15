use super::types::{PAGE_SIZE, SearchToolResponse};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use async_trait::async_trait;
use models_search::{
    MatchType,
    unified::{UnifiedSearchIndex, UnifiedSearchRequest},
};
use schemars::JsonSchema;
use search_service_client::SearchServiceClient;
use serde::Deserialize;
use std::sync::Arc;

#[derive(Debug, JsonSchema, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    description = "Search for items by their name or title. For documents, this searches the document name. For emails, this searches the subject line. For chats, this searches the chat title. For projects (folders), this searches the project name. This tool finds items based on what they're called, not their content.",
    title = "NameSearch"
)]
pub struct NameSearch {
    #[schemars(
        description = "The name or title to search for. For emails, this is the subject line. For channels, this can be the channel name or participant names."
    )]
    pub name: String,

    #[schemars(
        description = "Which types of items to search. Leave empty to search all types. Examples: ['documents'], ['emails', 'documents'], ['channels']"
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

        let search_request = UnifiedSearchRequest {
            query: Some(self.name.to_owned()),
            terms: None,
            match_type: MatchType::Partial,
            filters: None,
            search_on: models_search::SearchOn::Name,
            collapse: Some(true),
            include: self.entity_types.clone(),
            disable_recency: false,
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
