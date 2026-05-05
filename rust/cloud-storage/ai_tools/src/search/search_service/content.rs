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
    description = "Search for items by their content. For documents, this searches the document body text. For emails, this searches across many fields at once — subject, body, sender/recipient/cc/bcc addresses, and the display names on those addresses — so a query like 'alice budget' matches emails where alice appears as sender/recipient (by address or display name) and the subject or body mentions budget. For chats, this searches the message content. For call records, this searches the call transcript text. This tool finds items based on what's inside them, not their titles or names.\n\nMulti-term behavior: every whitespace-separated term must match (AND). For emails, each term is tested with prefix matching against the text fields (subject, body, display names) and against the local-part of email-address fields, with the two field groups OR'd — so 'alice review' matches an email where alice appears in the To: line and 'review' appears in the body. Wrapping a value in double quotes (e.g. `\"alice@example.com\"` or `\"deal review\"`) keeps it as a single term and forces exact-token matching for that term — useful when you need a full email address or an exact phrase rather than a prefix. For all other entity types, the whole query is treated as a single phrase prefix, so 'release notes' looks for those words adjacent in that order.\n\nPrefer searching all types by default — leave entityTypes empty unless the user's request clearly targets a specific type. Don't narrow the search just because the query mentions a noun like 'email' or 'doc'; only filter when the user has explicitly scoped the request to that type.",
    title = "ContentSearch"
)]
pub struct ContentSearch {
    #[schemars(
        description = "The text content to search for. This searches within the body of documents, emails, messages, and call transcripts. Whitespace-separated terms are ANDed (every term must match). For non-email types the whole query is matched as an adjacent phrase. For emails each term is matched independently across subject/body/sender/recipient fields; wrap a term in double quotes to force exact-token (or full-email-address) matching instead of prefix matching."
    )]
    pub query: String,

    #[schemars(
        description = "Which types of items to search. Leave empty (the default) to search all types — this is almost always what you want. Only set this when the user's request clearly targets one or more specific types. Examples: ['documents'], ['emails', 'documents'], ['channels'], ['call_records']."
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
