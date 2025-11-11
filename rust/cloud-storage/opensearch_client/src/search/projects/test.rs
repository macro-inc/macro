use super::*;
use opensearch_query_builder::ToOpenSearchJson;

#[test]
fn test_build_search_request() -> anyhow::Result<()> {
    let builder = ProjectQueryBuilder::new(vec!["test".to_string()])
        .match_type("exact")
        .page_size(20)
        .page(1)
        .user_id("user123")
        .search_on(SearchOn::Name)
        .collapse(true)
        .ids(vec!["proj1".to_string(), "proj2".to_string()]);

    let result = builder.build_search_request()?;

    let expected = serde_json::json!({
        "from": 20,
        "size": 20,
        "collapse": {
            "field": "project_id"
        },
        "sort": ProjectSearchConfig::default_sort_types().iter().map(|s| s.to_json()).collect::<Vec<_>>(),
        "highlight": ProjectSearchConfig::default_highlight().to_json(),
        "query": {
            "bool": {
                "must": [
                    {
                        "match_phrase": {
                            "project_name": "test"
                        }
                    },
                ],
                "should": [
                    {
                        "terms": {
                            "project_id": ["proj1", "proj2"]
                        }
                    },
                    {
                        "term": {
                            "user_id": "user123"
                        }
                    }
                ],
                "minimum_should_match": 1,
            }
        }
    });

    assert_eq!(result.to_json(), expected);

    Ok(())
}
