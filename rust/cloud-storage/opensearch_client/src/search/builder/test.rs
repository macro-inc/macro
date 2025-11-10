use super::*;

struct TestSearchConfig;

impl SearchQueryConfig for TestSearchConfig {
    const ID_KEY: &'static str = "test_id";
    const INDEX: &'static str = "test_index";
    const USER_ID_KEY: &'static str = "test_user_id";
    const TITLE_KEY: &'static str = "test_title";
}

#[test]
fn test_search_query_builder_build() {
    let terms = vec!["search".to_string(), "term".to_string()];
    let ids = vec!["id1".to_string(), "id2".to_string()];
    let user_id = "user123";
    let page = 1;
    let page_size = 20;

    let builder = SearchQueryBuilder::<TestSearchConfig>::new(terms.clone())
        .match_type("exact")
        .page(page)
        .page_size(page_size)
        .user_id(user_id)
        .ids(ids.clone());

    let query = builder.query_builder().unwrap().build().into();
    let result = builder.build_with_query(query).unwrap();

    // Verify the structure contains expected keys
    assert!(result.get("query").is_some());
    assert!(result.get("from").is_some());
    assert!(result.get("size").is_some());
    assert!(result.get("sort").is_some());
    assert!(result.get("highlight").is_some());

    // Verify pagination values
    assert_eq!(result["from"], serde_json::json!(page * page_size));
    assert_eq!(result["size"], serde_json::json!(page_size));

    // Verify sort structure (using default)
    let expected_sort = serde_json::json!([
        {
            "updated_at_seconds": {
                "order": "desc"
            }
        },
    ]);
    assert_eq!(result["sort"], expected_sort);

    // Verify highlight structure (using default)
    let expected_highlight = serde_json::json!({
        "fields": {
            "content": {
                "type": "unified",
                "number_of_fragments": 500,
                "pre_tags": ["<macro_em>"],
                "post_tags": ["</macro_em>"],
            }
        },
        "require_field_match": true,
    });
    assert_eq!(result["highlight"], expected_highlight);

    // Verify query structure contains bool query
    assert!(result["query"]["bool"].is_object());

    // Verify should clause contains user_id and ids terms
    let should_clause = &result["query"]["bool"]["should"];
    assert!(should_clause.is_array());

    let should_array = should_clause.as_array().unwrap();
    assert_eq!(should_array.len(), 2);

    // Check for user_id term
    let user_term_found = should_array.iter().any(|item| {
        item.get("term")
            .and_then(|t| t.get("test_user_id"))
            .map(|v| v == user_id)
            .unwrap_or(false)
    });
    assert!(user_term_found);

    // Check for ids terms
    let ids_term_found = should_array.iter().any(|item| {
        item.get("terms")
            .and_then(|t| t.get("test_id"))
            .and_then(|v| v.as_array())
            .map(|arr| arr.len() == 2)
            .unwrap_or(false)
    });
    assert!(ids_term_found);
}
