use std::cmp::min;

use crate::tool_context::{RequestContext, ToolServiceContext};
use ai::tool::{AsyncTool, ToolCallError, ToolResult};
use async_trait::async_trait;
use models_search::{
    HumanReadableTimestamp,
    unified::{SimpleUnifiedSearchResponseBaseItem, UnifiedSearchRequest},
};
use schemars::{JsonSchema, Schema};
use serde::{Deserialize, Serialize};

/// maximum number of results to return to the ai client
const TRUNCATED_RESULTS_LIMIT: usize = 150;

/// when exhaustive search is disabled, fetch this many results
/// note that a result includes a content match for the same document id so this is not the same as
/// unique document matches
const DEFAULT_SEARCH_LIMIT: usize = 10;

const MAX_PAGE_SIZE: i64 = 100;
const MAX_PAGE_COUNT: i64 = 100; // this times max page size will exceed open search max result window

fn default_exhaustive_search() -> bool {
    true
}

fn default_page_size() -> i64 {
    DEFAULT_SEARCH_LIMIT as i64
}

// optionally truncate the results to a maximum of TRUNCATED_RESULTS_LIMIT
#[derive(Debug, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TruncatedUnifiedSearchResponse {
    /// The search results (truncated to `results_returned` limit if applicable)
    pub results: Vec<SimpleUnifiedSearchResponseBaseItem<HumanReadableTimestamp>>,
    /// total number of results from search
    pub total_results: usize,
    /// the number of results returned
    pub results_returned: usize,
}

#[derive(Debug, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UnifiedSearchResponseOutput {
    /// The search results
    pub response: TruncatedUnifiedSearchResponse,
    /// The JSON schema for the response so the LLM can understand it
    pub response_schema: serde_json::Value,
}

lazy_static::lazy_static! {
    static ref RESPONSE_SCHEMA: Schema = response_schema();
}

fn response_schema() -> Schema {
    let generator = ai::tool::minimized_output_schema_generator();
    generator.into_root_schema_for::<UnifiedSearchResponseOutput>()
}

#[derive(Debug, JsonSchema, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    description = "Universal search across all content types (documents, emails, AI conversations, chat/slack threads/channels, projects aka folders). This tool will return broad metadata from successful results and/or content matches. Use the Read tool next to read the results from those matches. Only ever refer to documents by name or with a document mention. Never state the id of the document in plaintext. User's are presented with the results of this tool as a UI element so there is no need to enumerate the information found from this tool.",
    title = "UnifiedSearch"
)]
pub struct UnifiedSearch {
    #[schemars(
        description = "Exhaustive search across all results matching the query. Defaults to true. Use false when the user only requires a limitied subset of results to answer the question"
    )]
    #[serde(default = "default_exhaustive_search")]
    pub exhaustive_search: bool,

    #[schemars(
        description = "Page offset. Default is 0. Use a higher offset to page through results intelligently. Set exhaustive_search to true to get all results."
    )]
    #[serde(default)]
    pub page_offset: i64,

    #[schemars(
        description = "Search count per search type (i.e. applies separately to each of documents, emails, ai_conversations, chats, projects). Max is 100. Default is 10. Does not apply when exhaustive_search is set to true."
    )]
    #[serde(default = "default_page_size")]
    pub page_size: i64,

    #[schemars(description = "Aggregated search request, see individual fields for details")]
    pub request: UnifiedSearchRequest,
}

async fn fetch_all_pages_simple(
    context: &ToolServiceContext,
    request_context: &RequestContext,
    search_request: &UnifiedSearchRequest,
) -> Result<Vec<SimpleUnifiedSearchResponseBaseItem<HumanReadableTimestamp>>, ToolCallError> {
    const BATCH_SIZE: usize = 4;
    let mut page = 0;
    let mut all_results = vec![];

    loop {
        // Create concurrent requests for the batch
        let mut tasks = Vec::with_capacity(BATCH_SIZE);
        let mut hit_pagination_limit = false;

        for i in 0..BATCH_SIZE {
            let current_page = page + i as i64;

            if current_page >= MAX_PAGE_COUNT {
                tracing::warn!(
                    page = current_page,
                    "exhaustive search exceeded max page count, stopping"
                );
                hit_pagination_limit = true;
                break;
            }

            let context = context.clone();
            let request_context = request_context.clone();
            let search_request = search_request.clone();

            let task = tokio::spawn(async move {
                let result = context
                    .search_service_client
                    .search_simple_unified(
                        &request_context.user_id,
                        search_request,
                        current_page,
                        MAX_PAGE_SIZE,
                    )
                    .await;

                (current_page, result)
            });

            tasks.push(task);
        }

        // Wait for all requests to complete
        let mut batch_has_results = false;

        for task in tasks {
            let (current_page, response) = task.await.map_err(|e| ToolCallError {
                description: format!("task join error: {}", e),
                internal_error: e.into(),
            })?;

            match response {
                Ok(response) => {
                    let result_count = response.results.len();

                    tracing::debug!(
                        page = current_page,
                        result_count,
                        "exhaustive search: fetched page in batch"
                    );

                    if result_count > 0 {
                        batch_has_results = true;
                        all_results.extend(response.results);
                    } else {
                        tracing::debug!(
                            page = current_page,
                            "exhaustive search: found empty page, stopping"
                        );
                    }
                }
                Err(e) => {
                    return Err(ToolCallError {
                        description: format!(
                            "failed to perform exhaustive unified search on page {}: {}",
                            current_page, e
                        ),
                        internal_error: e,
                    });
                }
            }
        }

        if hit_pagination_limit {
            tracing::info!(
                total_results = all_results.len(),
                last_successful_page = page,
                "exhaustive search stopped due to OpenSearch pagination limit"
            );
            break;
        }

        if !batch_has_results {
            break;
        }

        page += BATCH_SIZE as i64;
    }

    Ok(all_results)
}

#[async_trait]
impl AsyncTool<ToolServiceContext, RequestContext> for UnifiedSearch {
    type Output = UnifiedSearchResponseOutput;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        context: ToolServiceContext,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(self=?self, "Unified search params");

        let search_request = UnifiedSearchRequest {
            query: self.request.query.clone(),
            terms: self.request.terms.clone(),
            match_type: self.request.match_type,
            filters: self.request.filters.clone(),
            search_on: self.request.search_on,
            collapse: Some(false), // collapse=true will return one result per opensearch document
            include: self.request.include.clone(),
        };
        tracing::info!(search_request=?search_request, "Unified search request");

        if self.exhaustive_search {
            // Use exhaustive search with batched pagination
            return match fetch_all_pages_simple(&context, &request_context, &search_request).await {
                Ok(all_results) => {
                    let total_results = all_results.len();
                    let results_returned = min(total_results, TRUNCATED_RESULTS_LIMIT);
                    let results = if results_returned < total_results {
                        all_results.into_iter().take(results_returned).collect()
                    } else {
                        all_results
                    };

                    let response_schema = RESPONSE_SCHEMA.as_value().clone();
                    let tool_response = UnifiedSearchResponseOutput {
                        response: TruncatedUnifiedSearchResponse {
                            results,
                            total_results,
                            results_returned,
                        },
                        response_schema,
                    };
                    tracing::debug!(
                        "exhaustive search returned {results_returned} results of {total_results}"
                    );
                    ToolResult::Ok(tool_response)
                }
                Err(e) => ToolResult::Err(e),
            };
        }

        // Non-exhaustive search - single page
        let page = self.page_offset;
        let page_size = self.page_size;

        // Validate parameters
        if page < 0 {
            return Err(ToolCallError {
                description: "page_offset must be greater than or equal to 0".to_string(),
                internal_error: anyhow::anyhow!("page_offset must be greater than or equal to 0"),
            });
        } else if page > MAX_PAGE_COUNT {
            return Err(ToolCallError {
                description: format!(
                    "page_offset must be less than or equal to {}",
                    MAX_PAGE_COUNT
                ),
                internal_error: anyhow::anyhow!(format!(
                    "page_offset must be less than or equal to {}",
                    MAX_PAGE_COUNT
                )),
            });
        }

        if page_size <= 0 {
            return Err(ToolCallError {
                description: format!(
                    "page_size must be greater than 0. default is {DEFAULT_SEARCH_LIMIT}"
                ),
                internal_error: anyhow::anyhow!("page_size must be greater than 0"),
            });
        } else if page_size > MAX_PAGE_SIZE {
            return Err(ToolCallError {
                description: format!("page_size must be less than or equal to {}", MAX_PAGE_SIZE),
                internal_error: anyhow::anyhow!(format!(
                    "page_size must be less than or equal to {}",
                    MAX_PAGE_SIZE
                )),
            });
        }

        match context
            .search_service_client
            .search_simple_unified(&request_context.user_id, search_request, page, page_size)
            .await
        {
            Ok(response) => {
                let result_count = response.results.len();
                let response_schema = RESPONSE_SCHEMA.as_value().clone();
                let tool_response = UnifiedSearchResponseOutput {
                    response: TruncatedUnifiedSearchResponse {
                        results: response.results,
                        total_results: result_count,
                        results_returned: result_count,
                    },
                    response_schema,
                };
                tracing::debug!("search tool returned {result_count} results");
                ToolResult::Ok(tool_response)
            }
            Err(e) => {
                tracing::warn!("Search failed with error: {}", e);
                Err(ToolCallError {
                    description: format!("failed to perform unified search: {}", e),
                    internal_error: e,
                })
            }
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use ai::generate_tool_input_schema;
    use ai::tool::types::toolset::tool_object::validate_tool_schema;

    // run `cargo test -p ai_tools unified::tests::print_output_schema -- --nocapture --include-ignored`
    #[test]
    #[ignore = "prints the output schema"]
    fn print_output_schema() {
        let schema = RESPONSE_SCHEMA.as_value().clone();
        println!("{}", serde_json::to_string_pretty(&schema).unwrap());
    }

    // run `cargo test -p ai_tools unified::tests::print_input_schema -- --nocapture --include-ignored`
    #[test]
    #[ignore = "prints the input schema"]
    fn print_input_schema() {
        let schema = generate_tool_input_schema!(UnifiedSearch);
        println!("{}", serde_json::to_string_pretty(&schema).unwrap());
    }

    #[test]
    fn test_unified_search_schema_validation() {
        let schema = generate_tool_input_schema!(UnifiedSearch);

        // Test using the actual validate_tool_schema function
        let result = validate_tool_schema(&schema);
        assert!(result.is_ok(), "{:?}", result);

        let (name, description) = result.unwrap();
        assert_eq!(
            name, "UnifiedSearch",
            "Tool name should match the schemars title"
        );
        assert!(
            description.contains("Universal search across all content types"),
            "Description should contain expected text"
        );
    }
}
