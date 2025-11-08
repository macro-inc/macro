use crate::tool_context::{RequestContext, ToolServiceContext};
use ai::tool::{AsyncTool, ToolCallError, ToolResult};
use async_trait::async_trait;
use model::document::list::DocumentListItem;
use models_permissions::share_permission::access_level::AccessLevel;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::cmp::min;

/// Maximum number of results to return to the AI client
const TRUNCATED_RESULTS_LIMIT: usize = 150;

/// Default page size when not specified
const DEFAULT_PAGE_SIZE: i64 = 50;

/// Maximum allowed page size
const MAX_PAGE_SIZE: i64 = 1000;

fn default_page_size() -> i64 {
    DEFAULT_PAGE_SIZE
}

#[derive(Debug, JsonSchema, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ListDocumentsResponse {
    /// The list results (truncated to `results_returned` limit if applicable)
    pub results: Vec<DocumentListItem>,
    /// Total number of results found
    pub total_results: usize,
    /// The number of results returned
    pub results_returned: usize,
}

#[derive(Debug, JsonSchema, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
#[schemars(
    description = "List documents the user has access to with optional filtering and pagination. Only applies to documents, not emails, AI conversations, chat/slack threads, projects aka folders. This tool returns document metadata including access levels and supports filtering by file type, minimum access level, and pagination. Use this tool to discover and browse documents before using the Read tool to access their content. Prefer using the search tool to search on a specific matching string within the content or the name of the entity.",
    title = "ListDocuments"
)]
pub struct ListDocuments {
    #[schemars(
        description = "Document file types to include. Examples: ['pdf'], ['md', 'txt']. Leave empty to include all document types."
    )]
    pub file_types: Option<Vec<String>>,

    #[schemars(
        description = "Minimum access level required. Defaults to 'view' if not specified."
    )]
    pub min_access_level: Option<AccessLevel>,

    #[schemars(
        description = "Page offset for pagination. Default is 0. Use higher values to get subsequent pages of results."
    )]
    #[serde(default)]
    pub page_offset: i64,

    #[schemars(
        description = "Number of results per page. Max is 100, default is 50. Use smaller values for focused results."
    )]
    #[serde(default = "default_page_size")]
    pub page_size: i64,

    #[schemars(
        description = "Exhaustive search to get all results. Defaults to false. Set to true when you need all matching documents, ignoring pagination limits."
    )]
    #[serde(default)]
    pub exhaustive_search: bool,
}

impl Default for ListDocuments {
    fn default() -> Self {
        Self {
            file_types: None,
            min_access_level: None,
            page_offset: 0,
            page_size: DEFAULT_PAGE_SIZE,
            exhaustive_search: false,
        }
    }
}

impl ListDocuments {
    fn validate_pagination(&self) -> Result<(i64, i64), ToolCallError> {
        // Validate page_offset
        if self.page_offset < 0 {
            return Err(ToolCallError {
                description: "page_offset must be greater than or equal to 0".to_string(),
                internal_error: anyhow::anyhow!("page_offset must be greater than or equal to 0"),
            });
        }

        // Validate and set page_size
        let page_size = if self.page_size <= 0 {
            DEFAULT_PAGE_SIZE
        } else if self.page_size > MAX_PAGE_SIZE {
            return Err(ToolCallError {
                description: format!("page_size must be less than or equal to {}", MAX_PAGE_SIZE),
                internal_error: anyhow::anyhow!(format!(
                    "page_size must be less than or equal to {}",
                    MAX_PAGE_SIZE
                )),
            });
        } else {
            self.page_size
        };

        Ok((page_size, self.page_offset))
    }

    async fn fetch_all_pages(
        &self,
        context: &ToolServiceContext,
        request_context: &RequestContext,
        min_access_level: AccessLevel,
        page_size: i64,
    ) -> Result<Vec<DocumentListItem>, ToolCallError> {
        let mut all_results = vec![];
        let mut page_offset = 0;

        loop {
            let page = page_offset / page_size;
            let response = context
                .scribe
                .document
                .dss_client
                .list_documents_with_access(
                    &request_context.user_id,
                    self.file_types.clone(),
                    Some(min_access_level),
                    page,
                    page_size,
                )
                .await
                .map_err(|e| ToolCallError {
                    description: format!("failed to list documents: {}", e),
                    internal_error: e,
                })?;

            let result_count = response.documents.len();
            tracing::debug!(page_offset, result_count, "exhaustive search: fetched page");

            if result_count == 0 {
                break;
            }

            all_results.extend(response.documents);

            // If we got fewer results than requested, we've reached the end
            if (result_count as i64) < page_size {
                break;
            }

            page_offset += page_size;
        }

        Ok(all_results)
    }
}

#[async_trait]
impl AsyncTool<ToolServiceContext, RequestContext> for ListDocuments {
    type Output = ListDocumentsResponse;

    #[tracing::instrument(skip_all, fields(user_id=?request_context.user_id), err)]
    async fn call(
        &self,
        context: ToolServiceContext,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        tracing::info!(self=?self, "List documents params");

        let (page_size, page_offset) = self.validate_pagination()?;
        let min_access_level = self.min_access_level.unwrap_or(AccessLevel::View);

        if self.exhaustive_search {
            // Use exhaustive search to get all results
            return match self
                .fetch_all_pages(&context, &request_context, min_access_level, page_size)
                .await
            {
                Ok(all_results) => {
                    let total_results = all_results.len();
                    let results_returned = min(total_results, TRUNCATED_RESULTS_LIMIT);
                    let results = if results_returned < total_results {
                        all_results.into_iter().take(results_returned).collect()
                    } else {
                        all_results
                    };

                    let tool_response = ListDocumentsResponse {
                        results,
                        total_results,
                        results_returned,
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
        let page = page_offset / page_size;
        match context
            .scribe
            .document
            .dss_client
            .list_documents_with_access(
                &request_context.user_id,
                self.file_types.clone(),
                Some(min_access_level),
                page,
                page_size,
            )
            .await
        {
            Ok(response) => {
                let tool_response = ListDocumentsResponse {
                    results: response.documents,
                    total_results: response.results_returned,
                    results_returned: response.results_returned,
                };

                tracing::debug!(
                    "list documents returned {} results",
                    response.results_returned
                );
                ToolResult::Ok(tool_response)
            }
            Err(e) => {
                tracing::warn!("List documents failed with error: {}", e);
                Err(ToolCallError {
                    description: format!("failed to list documents: {}", e),
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

    // run `cargo test -p ai_tools list::file::tests::print_input_schema -- --nocapture --include-ignored`
    #[test]
    #[ignore = "prints the input schema"]
    fn print_input_schema() {
        let schema = generate_tool_input_schema!(ListDocuments);
        println!("{}", serde_json::to_string_pretty(&schema).unwrap());
    }

    // run `cargo test -p ai_tools list::file::tests::print_output_schema -- --nocapture --include-ignored`
    #[test]
    #[ignore = "prints the output schema"]
    fn print_output_schema() {
        let generator = ai::tool::minimized_output_schema_generator();
        let schema = generator.into_root_schema_for::<ListDocumentsResponse>();
        println!("{}", serde_json::to_string_pretty(&schema).unwrap());
    }

    #[test]
    fn test_list_documents_schema_validation() {
        let schema = generate_tool_input_schema!(ListDocuments);

        // Test using the actual validate_tool_schema function
        let result = validate_tool_schema(&schema);
        assert!(result.is_ok(), "{:?}", result);

        let (name, description) = result.unwrap();
        assert_eq!(
            name, "ListDocuments",
            "Tool name should match the schemars title"
        );
        assert!(
            description.contains("List documents the user has access to"),
            "Description should contain expected text"
        );
    }

    #[test]
    fn test_validate_pagination() {
        // Test valid parameters
        let list_docs = ListDocuments {
            file_types: Some(vec!["pdf".to_string()]),
            min_access_level: Some(AccessLevel::Edit),
            page_offset: 0,
            page_size: 50,
            exhaustive_search: false,
        };

        let result = list_docs.validate_pagination();
        assert!(result.is_ok());
        let (page_size, page_offset) = result.unwrap();
        assert_eq!(page_size, 50);
        assert_eq!(page_offset, 0);

        // Test invalid page_size (too large)
        let invalid_page_size = ListDocuments {
            page_size: 2000,
            ..Default::default()
        };
        assert!(invalid_page_size.validate_pagination().is_err());

        // Test negative page_offset
        let invalid_offset = ListDocuments {
            page_offset: -1,
            ..Default::default()
        };
        assert!(invalid_offset.validate_pagination().is_err());

        // Test zero page_size (should use default)
        let zero_page_size = ListDocuments {
            page_size: 0,
            ..Default::default()
        };
        let result = zero_page_size.validate_pagination();
        assert!(result.is_ok());
        let (page_size, _) = result.unwrap();
        assert_eq!(page_size, DEFAULT_PAGE_SIZE);

        // Test negative page_size (should use default)
        let negative_page_size = ListDocuments {
            page_size: -10,
            ..Default::default()
        };
        let result = negative_page_size.validate_pagination();
        assert!(result.is_ok());
        let (page_size, _) = result.unwrap();
        assert_eq!(page_size, DEFAULT_PAGE_SIZE);
    }
    #[test]
    fn test_default_values() {
        let list_docs = ListDocuments::default();
        assert_eq!(list_docs.file_types, None);
        assert_eq!(list_docs.min_access_level, None);
        assert_eq!(list_docs.page_offset, 0);
        assert_eq!(list_docs.page_size, DEFAULT_PAGE_SIZE);
        assert_eq!(list_docs.exhaustive_search, false);
    }
}
