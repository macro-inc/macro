use crate::{
    PROJECT_INDEX, Result, delegate_methods,
    error::{OpensearchClientError, ResponseExt},
    search::{
        builder::{SearchQueryBuilder, SearchQueryConfig},
        model::{Hit, SearchResponse},
    },
};

use crate::SearchOn;
use opensearch_query_builder::{BoolQueryBuilder, Highlight, HighlightField, ToOpenSearchJson};
use serde::{Deserialize, Serialize};
use serde_json::Value;

#[derive(Clone, Default)]
struct ProjectSearchConfig;

impl SearchQueryConfig for ProjectSearchConfig {
    const ID_KEY: &'static str = "project_id";
    const INDEX: &'static str = PROJECT_INDEX;
    const USER_ID_KEY: &'static str = "user_id";
    const TITLE_KEY: &'static str = "project_name";

    fn default_sort() -> Value {
        serde_json::json!([
            {
                "updated_at_seconds": {
                    "order": "desc"
                }
            },
            {
                Self::ID_KEY: {
                    "order": "asc"
                }
            }
        ])
    }

    // Projects have no "content" to highlight match on, so match on the TITLE_KEY instead
    fn default_highlight() -> Value {
        Highlight::new()
            .field(
                Self::TITLE_KEY,
                HighlightField::new()
                    .highlight_type("unified")
                    .number_of_fragments(500)
                    .pre_tags(vec!["<macro_em>".to_string()])
                    .post_tags(vec!["</macro_em>".to_string()])
                    .require_field_match(true),
            )
            .to_json()
    }
}

#[derive(Default)]
struct ProjectQueryBuilder {
    inner: SearchQueryBuilder<ProjectSearchConfig>,
}

impl ProjectQueryBuilder {
    pub fn new(terms: Vec<String>) -> Self {
        Self {
            inner: SearchQueryBuilder::new(terms),
        }
    }

    // Copy function signature from SearchQueryBuilder
    delegate_methods! {
        fn match_type(match_type: &str) -> Self;
        fn page(page: i64) -> Self;
        fn page_size(page_size: i64) -> Self;
        fn user_id(user_id: &str) -> Self;
        fn search_on(search_on: SearchOn) -> Self;
        fn collapse(collapse: bool) -> Self;
        fn ids(ids: Vec<String>) -> Self;
        fn ids_only(ids_only: bool) -> Self;
    }

    fn query_builder(self) -> Result<(SearchQueryBuilder<ProjectSearchConfig>, BoolQueryBuilder)> {
        let query_object = self.inner.query_builder()?;

        Ok((self.inner, query_object))
    }

    pub fn build(self) -> Result<Value> {
        let (builder, query_object) = self.query_builder()?;
        let base_query = builder.build_with_query(query_object.build())?;

        Ok(base_query)
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectIndex {
    pub project_id: String,
    pub user_id: String,
    pub parent_project_id: Option<String>,
    pub project_name: String,
    pub created_at_seconds: i64,
    pub updated_at_seconds: i64,
}

#[derive(Debug, Default)]
pub struct ProjectSearchArgs {
    pub terms: Vec<String>,
    pub user_id: String,
    pub page: i64,
    pub page_size: i64,
    pub match_type: String,
    pub project_ids: Vec<String>,
    pub search_on: SearchOn,
    pub collapse: bool,
    pub ids_only: bool,
}

impl ProjectSearchArgs {
    pub fn build(self) -> Result<Value> {
        let builder = ProjectQueryBuilder::new(self.terms)
            .match_type(&self.match_type)
            .page_size(self.page_size)
            .page(self.page)
            .user_id(&self.user_id)
            .search_on(self.search_on)
            .collapse(self.collapse)
            .ids(self.project_ids)
            .ids_only(self.ids_only);
        builder.build()
    }
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ProjectSearchResponse {
    pub project_id: String,
    pub user_id: String,
    pub project_name: String,
    pub created_at: i64,
    pub updated_at: i64,
    pub content: Option<Vec<String>>,
}

#[derive(Debug, serde::Serialize, serde::Deserialize)]
pub struct HighlightProject {
    pub project_name: Vec<String>,
}

impl From<Hit<ProjectIndex, HighlightProject>> for ProjectSearchResponse {
    fn from(hit: Hit<ProjectIndex, HighlightProject>) -> Self {
        Self {
            project_id: hit._source.project_id,
            user_id: hit._source.user_id,
            project_name: hit._source.project_name,
            created_at: hit._source.created_at_seconds,
            updated_at: hit._source.updated_at_seconds,
            content: hit.highlight.map(|h| h.project_name),
        }
    }
}

pub(crate) async fn search_projects(
    client: &opensearch::OpenSearch,
    args: ProjectSearchArgs,
) -> Result<Vec<ProjectSearchResponse>> {
    let query_body = args.build()?;

    let response = client
        .search(opensearch::SearchParts::Index(&[PROJECT_INDEX]))
        .body(query_body)
        .send()
        .await
        .map_client_error()
        .await?;

    let json_value: serde_json::Value =
        response
            .json()
            .await
            .map_err(|e| OpensearchClientError::DeserializationFailed {
                details: e.to_string(),
                method: Some("search_projects".to_string()),
            })?;

    let result: SearchResponse<ProjectIndex, HighlightProject> = serde_json::from_value(json_value)
        .map_err(|e| OpensearchClientError::DeserializationFailed {
            details: e.to_string(),
            method: Some("search_projects".to_string()),
        })?;

    Ok(result
        .hits
        .hits
        .into_iter()
        .map(ProjectSearchResponse::from)
        .collect())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_project_query_builder_basic_build() {
        let terms = vec!["project".to_string(), "search".to_string()];
        let result = ProjectQueryBuilder::new(terms.clone())
            .user_id("user123")
            .page(0)
            .page_size(10)
            .match_type("exact")
            .build()
            .unwrap();

        // Verify structure contains expected keys
        assert!(result.get("query").is_some());
        assert!(result.get("from").is_some());
        assert!(result.get("size").is_some());
        assert!(result.get("sort").is_some());
        assert!(result.get("highlight").is_some());

        // Verify pagination
        assert_eq!(result["from"], serde_json::json!(0));
        assert_eq!(result["size"], serde_json::json!(10));

        // Verify default sort for projects
        let expected_sort = serde_json::json!([
            {
                "updated_at_seconds": {
                    "order": "desc"
                }
            },
            {
                "project_id": {
                    "order": "asc"
                }
            }
        ]);
        assert_eq!(result["sort"], expected_sort);

        let expected_highlight = serde_json::json!({
            "fields": {
                "project_name": {
                    "type": "unified",
                    "number_of_fragments": 500,
                    "pre_tags": ["<macro_em>"],
                    "post_tags": ["</macro_em>"],
                    "require_field_match": true,
                }
            }
        });
        // Verify empty highlight (project-specific)
        assert_eq!(result["highlight"], expected_highlight);
    }

    #[test]
    fn test_project_query_builder_name_search_mode() {
        let terms = vec!["project".to_string()];
        let result = ProjectQueryBuilder::new(terms.clone())
            .user_id("user123")
            .search_on(SearchOn::Name)
            .build()
            .unwrap();

        // In Name search mode, it should search on name/title field
        // which creates a different query structure focused on title matching
        assert!(result.get("query").is_some());
        assert!(result["query"]["bool"].is_object());
    }

    #[test]
    fn test_project_query_builder_full_mode() {
        let terms = vec!["project".to_string()];
        let result = ProjectQueryBuilder::new(terms.clone())
            .user_id("user123")
            .search_on(SearchOn::Content)
            .build()
            .unwrap();

        // In Content search mode, it should use the regular query builder
        assert!(result.get("query").is_some());
        assert!(result["query"]["bool"].is_object());
    }

    #[test]
    fn test_project_query_builder_with_project_ids() {
        let terms = vec!["project".to_string()];
        let project_ids = vec!["proj1".to_string(), "proj2".to_string()];

        let result = ProjectQueryBuilder::new(terms.clone())
            .user_id("user123")
            .search_on(SearchOn::Content)
            .ids(project_ids.clone())
            .build()
            .unwrap();

        // The ids() method delegates to inner builder which adds to "should" clause, not "must"
        let should_clause = &result["query"]["bool"]["should"];
        assert!(should_clause.is_array());

        let should_array = should_clause.as_array().unwrap();

        // Look for project_id terms in should clause (where they actually end up)
        let project_terms_found = should_array.iter().any(|item| {
            item.get("terms")
                .and_then(|t| t.get("project_id"))
                .and_then(|v| v.as_array())
                .map(|arr| arr.len() == 2)
                .unwrap_or(false)
        });
        assert!(project_terms_found);
    }

    #[test]
    fn test_project_query_builder_combined_filters() {
        let terms = vec!["project".to_string()];
        let project_ids = vec!["proj1".to_string(), "proj2".to_string()];

        let result = ProjectQueryBuilder::new(terms.clone())
            .user_id("user123")
            .search_on(SearchOn::Content)
            .ids(project_ids.clone())
            .page(1)
            .page_size(20)
            .build()
            .unwrap();

        // Verify pagination
        assert_eq!(result["from"], serde_json::json!(20)); // page 1 * page_size 20
        assert_eq!(result["size"], serde_json::json!(20));

        // Verify both should and must clauses exist
        assert!(result["query"]["bool"]["should"].is_array());
        assert!(result["query"]["bool"]["must"].is_array());

        let should_array = result["query"]["bool"]["should"].as_array().unwrap();

        // Should also contain project_id terms from ids() - they both go to should clause
        let project_terms_found = should_array.iter().any(|item| {
            item.get("terms")
                .and_then(|t| t.get("project_id"))
                .is_some()
        });
        assert!(project_terms_found);
    }

    #[test]
    fn test_project_query_builder_empty_filters() {
        let terms = vec!["project".to_string()];

        let result = ProjectQueryBuilder::new(terms.clone())
            .user_id("user123")
            .search_on(SearchOn::Content)
            .ids(vec![])
            .build()
            .unwrap();

        // With empty filters, no additional terms should be added
        // The base query structure should still be valid
        assert!(result.get("query").is_some());
        assert!(result["query"]["bool"].is_object());
    }

    #[test]
    fn test_project_query_builder_different_match_types() {
        let terms = vec!["project".to_string()];

        let exact_result = ProjectQueryBuilder::new(terms.clone())
            .user_id("user123")
            .match_type("exact")
            .search_on(SearchOn::Content)
            .build()
            .unwrap();

        let partial_result = ProjectQueryBuilder::new(terms.clone())
            .user_id("user123")
            .match_type("partial")
            .search_on(SearchOn::Content)
            .build()
            .unwrap();

        // Both should build successfully with different internal query structures
        assert!(exact_result.get("query").is_some());
        assert!(partial_result.get("query").is_some());

        // They should have the same overall structure but different query internals
        assert_eq!(exact_result.get("sort"), partial_result.get("sort"));
        assert_eq!(
            exact_result.get("highlight"),
            partial_result.get("highlight")
        );
    }

    #[test]
    fn test_ids_only() {
        let terms = vec!["project".to_string()];
        let project_ids = vec!["proj1".to_string(), "proj2".to_string()];
        let user_id = "user123";
        let page = 1;
        let page_size = 10;
        let from = page * page_size;

        let reference = serde_json::json!({
            "query": {
                "bool": {
                    "should": [
                        {
                            "terms": {
                                "project_id": project_ids
                            }
                        }
                    ],
                    "minimum_should_match": 1,
                    "must": [
                        {
                            "bool": {
                                "should": [
                                    {
                                        "match_phrase": {
                                            "project_name": terms[0]
                                        }
                                    },
                                ],
                                "minimum_should_match": 1
                            }
                        },
                    ],
                }
            },
            "from": from,
            "size": page_size,
            "collapse": {
                "field": "project_id"
            },
            "sort": [
                {
                    "updated_at_seconds": {
                        "order": "desc"
                    }
                },
                {
                    "project_id": {
                        "order": "asc"
                    }
                }
            ],
            "highlight": {
                "fields": {
                    "project_name": {
                        "type": "unified",
                        "number_of_fragments": 500,
                        "pre_tags": ["<macro_em>"],
                        "post_tags": ["</macro_em>"],
                        "require_field_match": true,
                    }
                }
            },
        });

        let generated = ProjectQueryBuilder::new(terms)
            .match_type("exact")
            .page_size(page_size)
            .page(page)
            .user_id(user_id)
            .ids(project_ids)
            .ids_only(true)
            .search_on(SearchOn::Name)
            .build()
            .unwrap();

        assert_eq!(&generated, &reference);
    }

    #[test]
    fn test_project_search_args_build() {
        let args = ProjectSearchArgs {
            terms: vec!["test".to_string()],
            user_id: "user123".to_string(),
            page: 1,
            page_size: 15,
            match_type: "partial".to_string(), // Use valid match type
            project_ids: vec!["proj1".to_string()],
            search_on: SearchOn::Content,
            collapse: false,
            ids_only: false,
        };

        let result = args.build().unwrap();

        // Verify all parameters are correctly applied
        assert_eq!(result["from"], serde_json::json!(15)); // page 1 * page_size 15
        assert_eq!(result["size"], serde_json::json!(15));

        // Verify query structure exists
        assert!(result["query"]["bool"].is_object());

        // In Content search mode with filters, should have both should and must clauses
        assert!(result["query"]["bool"]["should"].is_array());
        assert!(result["query"]["bool"]["must"].is_array());
    }
}

#[test]
fn test_project_content_search_syntactically_invalid() {
    let terms = vec!["project".to_string()];
    let project_ids = vec!["proj1".to_string(), "proj2".to_string()];
    let user_id = "user123";
    let page = 1;
    let page_size = 10;
    let from = page * page_size;

    // When using SearchOn::Content on projects, it will search the "content" field
    // But projects don't have a content field, they only have project_name
    // The query builds successfully but is semantically invalid - it searches a non-existent field
    let reference = serde_json::json!({
        "query": {
            "bool": {
                "should": [
                    {
                        "terms": {
                            "project_id": project_ids
                        }
                    }
                ],
                "minimum_should_match": 1,
                "must": [
                    {
                        "bool": {
                            "should": [
                                {
                                    "match_phrase": {
                                        "content": terms[0]
                                    }
                                },
                            ],
                            "minimum_should_match": 1
                        }
                    },
                ],
            }
        },
        "from": from,
        "size": page_size,
        "sort": [
            {
                "updated_at_seconds": {
                    "order": "desc"
                }
            },
            {
                "project_id": {
                    "order": "asc"
                }
            }
        ],
        "highlight": {
            "fields": {
                "project_name": {
                    "type": "unified",
                    "number_of_fragments": 500,
                    "pre_tags": ["<macro_em>"],
                    "post_tags": ["</macro_em>"],
                    "require_field_match": true,
                }
            }
        },
    });

    let generated = ProjectQueryBuilder::new(terms)
        .match_type("exact")
        .page_size(page_size)
        .page(page)
        .user_id(user_id)
        .ids(project_ids)
        .ids_only(true)
        .search_on(SearchOn::Content)
        .build()
        .unwrap();

    assert_eq!(&generated, &reference);
}
