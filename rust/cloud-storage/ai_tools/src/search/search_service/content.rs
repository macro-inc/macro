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
    description = "Search for items by their content. For documents, this searches the document body text. For emails, this searches the email message body. For chats, this searches the message content. This tool finds items based on what's inside them, not their titles or names.",
    title = "ContentSearch"
)]
pub struct ContentSearch {
    #[schemars(
        description = "The text content to search for. This searches within the body of documents, emails, and messages."
    )]
    pub query: String,

    #[schemars(
        description = "Which types of items to search. Leave empty to search all types. Examples: ['documents'], ['emails', 'documents'], ['channels']"
    )]
    #[serde(default)]
    pub entity_types: Vec<UnifiedSearchIndex>,
}

#[async_trait]
impl AsyncTool<Arc<SearchServiceClient>> for ContentSearch {
    type Output = SearchToolResponse;

    #[tracing::instrument(skip_all, fields(user_id=?(*request_context.user_id).as_ref()), err)]
    async fn call(
        &self,
        search_client: ServiceContext<Arc<SearchServiceClient>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(self=?self, "Content search params");

        if self.query.trim().is_empty() {
            return Err(ToolCallError {
                description: "query must not be empty".to_string(),
                internal_error: anyhow::anyhow!("query must not be empty"),
            });
        }

        let search_request = UnifiedSearchRequest {
            query: Some(self.query.to_owned()),
            terms: None,
            match_type: MatchType::Partial,
            filters: None,
            search_on: models_search::SearchOn::Content,
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
                description: format!("failed to perform content search: {}", e),
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
    fn test_content_search_schema_validation() {
        let schema = generate_tool_input_schema!(ContentSearch);

        let result = validate_tool_schema(&schema);
        assert!(result.is_ok(), "{:?}", result);

        let (name, description) = result.unwrap();
        assert_eq!(
            name, "ContentSearch",
            "Tool name should match the schemars title"
        );
        assert!(
            description.contains("Search for items by their content"),
            "Description should contain expected text"
        );
    }
}
