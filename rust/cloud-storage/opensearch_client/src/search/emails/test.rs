use super::*;
use opensearch_query_builder::ToOpenSearchJson;

#[test]
fn test_build_bool_query() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(vec!["test".to_string()])
        .match_type("exact")
        .page_size(20)
        .page(1)
        .user_id("user123")
        .collapse(true)
        .ids(vec!["thread1".to_string(), "thread2".to_string()])
        .link_ids(vec!["link1".to_string(), "link2".to_string()])
        .sender(vec!["sender@example.com".to_string()])
        .cc(vec!["cc@example.com".to_string()])
        .bcc(vec!["bcc@example.com".to_string()])
        .recipients(vec!["recipient@example.com".to_string()]);

    let result = builder.build_bool_query()?;

    let expected = serde_json::json!({
        "bool": {
            "filter": [
                {
                    "bool": {
                        "minimum_should_match": 1,
                        "should": [
                            {"terms": {"entity_id": ["thread1", "thread2"]}},
                            {"term": {"user_id": "user123"}}
                        ]
                    }
                },
                {"term": {"_index": "emails_alias"}},
                {"terms": {"link_id": ["link1", "link2"]}},
                {
                    "bool": {
                        "minimum_should_match": 1,
                        "should": [
                            {"wildcard": {"sender": {"case_insensitive": true, "value": "*sender@example.com*"}}}
                        ]
                    }
                },
                {
                    "bool": {
                        "minimum_should_match": 1,
                        "should": [
                            {"wildcard": {"cc": {"case_insensitive": true, "value": "*cc@example.com*"}}}
                        ]
                    }
                },
                {
                    "bool": {
                        "minimum_should_match": 1,
                        "should": [
                            {"wildcard": {"bcc": {"case_insensitive": true, "value": "*bcc@example.com*"}}}
                        ]
                    }
                },
                {
                    "bool": {
                        "minimum_should_match": 1,
                        "should": [
                            {"wildcard": {"recipients": {"case_insensitive": true, "value": "*recipient@example.com*"}}}
                        ]
                    }
                }
            ],
            "must": [
                {
                    "bool": {
                        "minimum_should_match": 1,
                        "should": [
                            {"match_phrase": {"content": "test"}}
                        ]
                    }
                }
            ]
        }
    });

    assert_eq!(result.build().to_json(), expected);

    Ok(())
}

#[test]
fn test_importance_true_excludes_depriority_unless_priority() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(vec!["test".to_string()])
        .match_type("partial")
        .page_size(10)
        .page(0)
        .user_id("user123")
        .collapse(false)
        .importance(Some(true));

    let bool_query = builder.build_bool_query()?;
    let json = bool_query.build().to_json();

    let must_not = json["bool"]["must_not"].as_array().unwrap();
    assert_eq!(must_not.len(), 1);

    let nested_bool = &must_not[0]["bool"];
    let filter = nested_bool["filter"].as_array().unwrap();
    assert_eq!(filter.len(), 1);
    let depriority = filter[0]["terms"]["labels"].as_array().unwrap();
    assert_eq!(depriority.len(), 4);

    let inner_must_not = nested_bool["must_not"].as_array().unwrap();
    assert_eq!(inner_must_not.len(), 1);
    let priority = inner_must_not[0]["terms"]["labels"].as_array().unwrap();
    assert_eq!(priority.len(), 3);

    Ok(())
}

#[test]
fn test_importance_false_filters_to_depriority_only() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(vec!["test".to_string()])
        .match_type("partial")
        .page_size(10)
        .page(0)
        .user_id("user123")
        .collapse(false)
        .importance(Some(false));

    let bool_query = builder.build_bool_query()?;
    let json = bool_query.build().to_json();

    let filters = json["bool"]["filter"].as_array().unwrap();
    let nested_bool = filters
        .iter()
        .find(|f| f["bool"]["filter"].is_array() && f["bool"]["must_not"].is_array())
        .expect("should have nested importance filter");

    let depriority = nested_bool["bool"]["filter"][0]["terms"]["labels"]
        .as_array()
        .unwrap();
    assert_eq!(depriority.len(), 4);

    let priority = nested_bool["bool"]["must_not"][0]["terms"]["labels"]
        .as_array()
        .unwrap();
    assert_eq!(priority.len(), 3);

    Ok(())
}

#[test]
fn test_importance_none_no_importance_filter() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(vec!["test".to_string()])
        .match_type("partial")
        .page_size(10)
        .page(0)
        .user_id("user123")
        .collapse(false)
        .importance(None);

    let bool_query = builder.build_bool_query()?;
    let json = bool_query.build().to_json();

    assert!(json["bool"]["must_not"].is_null());

    Ok(())
}

#[test]
fn test_importance_true_with_exclude_labels_both_apply() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(vec!["test".to_string()])
        .match_type("partial")
        .page_size(10)
        .page(0)
        .user_id("user123")
        .collapse(false)
        .importance(Some(true))
        .exclude_labels(vec!["INBOX".to_string()]);

    let bool_query = builder.build_bool_query()?;
    let json = bool_query.build().to_json();

    let must_not = json["bool"]["must_not"].as_array().unwrap();
    // Should have both: the explicit exclude_label AND the importance nested bool
    assert_eq!(must_not.len(), 2);

    // One should be the INBOX term exclusion
    let has_inbox_exclusion = must_not.iter().any(|q| q["term"]["labels"] == "INBOX");
    assert!(has_inbox_exclusion);

    // One should be the nested importance bool
    let has_importance = must_not.iter().any(|q| q["bool"]["filter"].is_array());
    assert!(has_importance);

    Ok(())
}

#[test]
fn test_importance_false_with_exclude_labels_both_apply() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(vec!["test".to_string()])
        .match_type("partial")
        .page_size(10)
        .page(0)
        .user_id("user123")
        .collapse(false)
        .importance(Some(false))
        .exclude_labels(vec!["CATEGORY_SOCIAL".to_string()]);

    let bool_query = builder.build_bool_query()?;
    let json = bool_query.build().to_json();

    let must_not = json["bool"]["must_not"].as_array().unwrap();
    // Should have the explicit CATEGORY_SOCIAL exclusion
    let has_social_exclusion = must_not
        .iter()
        .any(|q| q["term"]["labels"] == "CATEGORY_SOCIAL");
    assert!(has_social_exclusion);

    // Should have the importance filter in filter array
    let filters = json["bool"]["filter"].as_array().unwrap();
    let has_importance_filter = filters
        .iter()
        .any(|f| f["bool"]["filter"].is_array() && f["bool"]["must_not"].is_array());
    assert!(has_importance_filter);

    Ok(())
}
