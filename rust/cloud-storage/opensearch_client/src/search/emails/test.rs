use super::*;
use opensearch_query_builder::ToOpenSearchJson;

#[test]
fn test_build_keyword_query_string_single_term() {
    let result = build_keyword_query_string(&["hello".to_string()]);
    assert_eq!(result, "(hello | hello@*)");
}

#[test]
fn test_build_keyword_query_string_multiple_terms() {
    let result = build_keyword_query_string(&["hello".to_string(), "test".to_string()]);
    assert_eq!(result, "(hello | hello@*) + (test | test@*)");
}

#[test]
fn test_build_keyword_query_string_multi_word_term_uses_phrase() {
    // Multi-word terms come from quoted phrases via `split_search_terms`
    // and must render as a phrase so simple_query_string's AND default
    // operator doesn't decompose them into independent tokens.
    let result = build_keyword_query_string(&["hi there".to_string()]);
    assert_eq!(result, "\"hi there\"");
}

#[test]
fn test_build_keyword_query_string_uppercase_lowercased_for_email() {
    let result = build_keyword_query_string(&["Teo".to_string()]);
    assert_eq!(result, "(Teo | teo@*)");
}

#[test]
fn test_build_keyword_query_string_mixed_single_and_multi_word() {
    let result = build_keyword_query_string(&["Teo".to_string(), "hello world".to_string()]);
    assert_eq!(result, "(Teo | teo@*) + \"hello world\"");
}

#[test]
fn test_build_keyword_query_string_email_term_uses_phrase() {
    let result = build_keyword_query_string(&["alice@example.com".to_string()]);
    assert_eq!(result, "\"alice@example.com\"");
}

#[test]
fn test_build_keyword_query_string_email_term_mixed_with_word() {
    let result =
        build_keyword_query_string(&["alice@example.com".to_string(), "review".to_string()]);
    assert_eq!(result, "\"alice@example.com\" + (review | review@*)");
}

#[test]
fn test_build_text_query_string_single_term_is_prefix() {
    let result = build_text_query_string(&["scri".to_string()]);
    assert_eq!(result, "scri*");
}

#[test]
fn test_build_text_query_string_multiple_terms_are_prefixed_and_anded() {
    let result = build_text_query_string(&["scri".to_string(), "test".to_string()]);
    assert_eq!(result, "scri* + test*");
}

#[test]
fn test_build_text_query_string_multi_word_term_uses_phrase() {
    // Multi-word terms come from quoted phrases via `split_search_terms`
    // and must render as a phrase so simple_query_string's AND default
    // operator doesn't decompose them into independent tokens.
    let result = build_text_query_string(&["hi there".to_string()]);
    assert_eq!(result, "\"hi there\"");
}

#[test]
fn test_build_text_query_string_email_term_uses_phrase() {
    let result = build_text_query_string(&["alice@example.com".to_string()]);
    assert_eq!(result, "\"alice@example.com\"");
}

#[test]
fn test_build_text_query_string_short_term_skips_prefix() {
    let result = build_text_query_string(&["ab".to_string()]);
    assert_eq!(result, "(ab)");
}

#[test]
fn test_build_text_query_string_three_char_term_gets_prefix() {
    let result = build_text_query_string(&["abc".to_string()]);
    assert_eq!(result, "abc*");
}

#[test]
fn test_email_search_args_quoted_phrase_uses_phrase_query_in_sqs() -> anyhow::Result<()> {
    // Regression: a quoted phrase like `"reply test"` arrives here as a
    // single term with internal whitespace (already stripped of quotes
    // by `split_search_terms`). Both simple_query_string clauses must
    // emit it as a phrase — otherwise `default_operator: "AND"` would
    // turn `(reply test)` into `reply AND test` and match each token
    // independently anywhere in the field.
    let builder: EmailQueryBuilder = EmailSearchArgs {
        terms: vec!["reply test".to_string()],
        user_id: "macro|alice@example.com".to_string(),
        user_ids: vec![],
        thread_ids: vec![],
        link_ids: vec![],
        sender: vec![],
        cc: vec![],
        bcc: vec![],
        recipients: vec![],
        include_labels: vec![],
        exclude_labels: vec![],
        importance: None,
        page: 0,
        page_size: 20,
        match_type: "partial".to_string(),
        collapse: true,
        ids_only: false,
        subject_only: false,
    }
    .into();

    let json = builder.build_bool_query()?.build().to_json();
    let should = json["bool"]["must"][0]["bool"]["should"]
        .as_array()
        .unwrap();
    for sqs in should.iter().map(|s| &s["simple_query_string"]) {
        assert_eq!(
            sqs["query"], "\"reply test\"",
            "expected phrase query, got {sqs:?}"
        );
    }
    Ok(())
}

#[test]
fn test_email_search_args_build_injects_simple_query_string() -> anyhow::Result<()> {
    let builder: EmailQueryBuilder = EmailSearchArgs {
        terms: vec!["hello".to_string(), "test".to_string()],
        user_id: "macro|alice@example.com".to_string(),
        user_ids: vec![],
        thread_ids: vec![],
        link_ids: vec![],
        sender: vec![],
        cc: vec![],
        bcc: vec![],
        recipients: vec![],
        include_labels: vec![],
        exclude_labels: vec![],
        importance: None,
        page: 0,
        page_size: 20,
        match_type: "partial".to_string(),
        collapse: true,
        ids_only: false,
        subject_only: false,
    }
    .into();

    let json = builder.build_bool_query()?.build().to_json();
    let should = json["bool"]["must"][0]["bool"]["should"]
        .as_array()
        .unwrap();
    assert_eq!(json["bool"]["must"][0]["bool"]["minimum_should_match"], 1);
    assert_eq!(should.len(), 2);

    let keyword_sqs = should
        .iter()
        .map(|s| &s["simple_query_string"])
        .find(|s| {
            s["fields"]
                .as_array()
                .is_some_and(|f| f.contains(&serde_json::json!("sender")))
        })
        .unwrap();
    assert_eq!(keyword_sqs["query"], "(hello | hello@*) + (test | test@*)");
    assert_eq!(keyword_sqs["default_operator"], "AND");
    let keyword_fields = keyword_sqs["fields"].as_array().unwrap();
    assert!(keyword_fields.contains(&serde_json::json!("sender")));
    assert!(keyword_fields.contains(&serde_json::json!("reply_to")));
    assert!(keyword_fields.contains(&serde_json::json!("recipients")));
    assert!(keyword_fields.contains(&serde_json::json!("cc")));
    assert!(keyword_fields.contains(&serde_json::json!("bcc")));
    assert!(!keyword_fields.contains(&serde_json::json!("subject")));

    let text_sqs = should
        .iter()
        .map(|s| &s["simple_query_string"])
        .find(|s| {
            s["fields"]
                .as_array()
                .is_some_and(|f| f.contains(&serde_json::json!("subject")))
        })
        .unwrap();
    assert_eq!(text_sqs["query"], "hello* + test*");
    assert_eq!(text_sqs["default_operator"], "AND");
    let text_fields = text_sqs["fields"].as_array().unwrap();
    assert!(text_fields.contains(&serde_json::json!("subject")));
    assert!(text_fields.contains(&serde_json::json!("content")));
    assert!(text_fields.contains(&serde_json::json!("sender_name")));
    assert!(text_fields.contains(&serde_json::json!("recipient_names")));
    assert!(!text_fields.contains(&serde_json::json!("sender")));

    Ok(())
}

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
                {"term": {"_index": "emails"}},
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
                            {
                                "simple_query_string": {
                                    "default_operator": "AND",
                                    "fields": ["sender", "reply_to", "recipients", "cc", "bcc"],
                                    "query": "(test | test@*)"
                                }
                            },
                            {
                                "simple_query_string": {
                                    "default_operator": "AND",
                                    "fields": ["subject", "content", "sender_name", "recipient_names", "cc_names", "bcc_names"],
                                    "query": "test*"
                                }
                            }
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
