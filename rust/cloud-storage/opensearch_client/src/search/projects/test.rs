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
            }
        },
        "require_field_match": true,
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
                }
            },
            "require_field_match": true,
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
                }
            },
            "require_field_match": true,
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
