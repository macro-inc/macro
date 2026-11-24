use super::*;
use opensearch_query_builder::ToOpenSearchJson;
use serde_json::json;

#[test]
fn addresses_match_a_word_by_local_part_or_segment() {
    for (terms, addresses, segments) in [
        (vec!["hello"], "hello@*", "(hello)"),
        (
            vec!["hello", "test"],
            "hello@* + test@*",
            "(hello) + (test)",
        ),
        (vec!["Teo"], "teo@*", "(Teo)"),
        (vec!["mary-jane"], r"mary\-jane@*", r"(mary\-jane)"),
    ] {
        let terms: Vec<String> = terms.into_iter().map(str::to_string).collect();

        assert_eq!(build_address_query_string(&terms), addresses);
        assert_eq!(build_segment_query_string(&terms, false), segments);
    }
}

#[test]
fn addresses_match_a_phrase_or_a_dotted_term_as_one_run_of_segments() {
    // A quoted phrase arrives as one term with whitespace inside, its quotes
    // already stripped by `split_search_terms`.
    for (term, quoted) in [
        ("hi there", r#""hi there""#),
        ("hi\tthere", "\"hi\tthere\""),
        ("example.com", r#""example.com""#),
        ("alice@example.com", r#""alice@example.com""#),
    ] {
        let terms = [term.to_string(), "review".to_string()];

        assert_eq!(
            build_address_query_string(&terms),
            format!("{quoted} + review@*")
        );
        assert_eq!(
            build_segment_query_string(&terms, false),
            format!("{quoted} + (review)")
        );
    }
}

#[test]
fn test_build_text_query_string_single_term_is_prefix() {
    let result = build_text_query_string(&["scri".to_string()], "partial", false);
    assert_eq!(result, "scri*");
}

#[test]
fn test_build_text_query_string_multiple_terms_are_prefixed_and_anded() {
    let result =
        build_text_query_string(&["scri".to_string(), "test".to_string()], "partial", false);
    assert_eq!(result, "scri* + test*");
}

#[test]
fn test_build_text_query_string_exact_drops_prefix_wildcard() {
    let result = build_text_query_string(&["scri".to_string(), "test".to_string()], "exact", false);
    assert_eq!(result, "(scri) + (test)");
}

#[test]
fn test_build_text_query_string_multi_word_term_uses_phrase() {
    // Multi-word terms come from quoted phrases via `split_search_terms`
    // and must render as a phrase so simple_query_string's AND default
    // operator doesn't decompose them into independent tokens.
    let result = build_text_query_string(&["hi there".to_string()], "partial", false);
    assert_eq!(result, "\"hi there\"");
}

#[test]
fn test_build_text_query_string_email_term_uses_phrase() {
    let result = build_text_query_string(&["alice@example.com".to_string()], "partial", false);
    assert_eq!(result, "\"alice@example.com\"");
}

#[test]
fn test_build_text_query_string_short_term_skips_prefix() {
    let result = build_text_query_string(&["ab".to_string()], "partial", false);
    assert_eq!(result, "(ab)");
}

#[test]
fn test_build_text_query_string_three_char_term_gets_prefix() {
    let result = build_text_query_string(&["abc".to_string()], "partial", false);
    assert_eq!(result, "abc*");
}

#[test]
fn test_email_search_args_quoted_phrase_uses_phrase_query_in_sqs() -> anyhow::Result<()> {
    // Regression: a quoted phrase like `"reply test"` arrives here as a
    // single term with internal whitespace (already stripped of quotes
    // by `split_search_terms`). Every simple_query_string clause must
    // emit it as a phrase — otherwise `default_operator: "AND"` would
    // turn `(reply test)` into `reply AND test` and match each token
    // independently anywhere in the field.
    let builder: EmailQueryBuilder = EmailSearchArgs {
        terms: vec!["reply test".to_string()],
        user_id: "macro|alice@example.com".to_string(),
        user_ids: vec![],
        thread_ids: vec![],
        required_thread_ids: vec![],
        link_ids: vec![],
        exclude_link_ids: vec![],
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
        tag_option_ids: vec![],
        match_all_tags: false,
        text_conditions: vec![],
        label_conditions: vec![],
        exclude_thread_ids: vec![],
        sent_after_millis: None,
        sent_before_millis: None,
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
        required_thread_ids: vec![],
        link_ids: vec![],
        exclude_link_ids: vec![],
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
        tag_option_ids: vec![],
        match_all_tags: false,
        text_conditions: vec![],
        label_conditions: vec![],
        exclude_thread_ids: vec![],
        sent_after_millis: None,
        sent_before_millis: None,
    }
    .into();

    let json = builder.build_bool_query()?.build().to_json();
    let should = json["bool"]["must"][0]["bool"]["should"]
        .as_array()
        .unwrap();
    assert_eq!(json["bool"]["must"][0]["bool"]["minimum_should_match"], 1);
    assert_eq!(should.len(), 3);
    assert_eq!(
        should[0],
        json!({
            "simple_query_string": {
                "query": "hello@* + test@*",
                "fields": ["sender", "reply_to", "recipients", "cc", "bcc"],
                "default_operator": "AND"
            }
        })
    );
    assert_eq!(
        should[1],
        json!({
            "simple_query_string": {
                "query": "(hello) + (test)",
                "fields": [
                    "sender.parts",
                    "reply_to.parts",
                    "recipients.parts",
                    "cc.parts",
                    "bcc.parts"
                ],
                "default_operator": "AND"
            }
        })
    );

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
    assert!(!text_fields.contains(&serde_json::json!("sender.parts")));

    Ok(())
}

#[test]
fn an_excluded_link_s_mail_never_matches_whatever_grants_it() -> anyhow::Result<()> {
    let json = EmailQueryBuilder::new(vec!["invoice".to_string()])
        .user_ids(vec!["macro|owner@example.com".to_string()])
        .ids(vec!["shared-thread".to_string()])
        .exclude_link_ids(vec!["deleting-link".to_string()])
        .build_bool_query()?
        .build()
        .to_json();

    let must_not = json["bool"]["must_not"].as_array().unwrap();
    assert!(
        must_not.contains(&serde_json::json!({ "terms": { "link_id": ["deleting-link"] } })),
        "{json}"
    );
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
                                    "query": "test@*"
                                }
                            },
                            {
                                "simple_query_string": {
                                    "default_operator": "AND",
                                    "fields": ["sender.parts", "reply_to.parts", "recipients.parts", "cc.parts", "bcc.parts"],
                                    "query": "(test)"
                                }
                            },
                            {
                                "simple_query_string": {
                                    "default_operator": "AND",
                                    "fields": ["subject", "content", "sender_name", "recipient_names", "cc_names", "bcc_names"],
                                    "query": "(test)"
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
    assert_eq!(must_not.len(), 2);

    let nested_bool = &must_not[0]["bool"];
    let filter = nested_bool["filter"].as_array().unwrap();
    assert_eq!(filter.len(), 1);
    let depriority = filter[0]["terms"]["labels"].as_array().unwrap();
    assert_eq!(depriority.len(), 4);

    let inner_must_not = nested_bool["must_not"].as_array().unwrap();
    assert_eq!(inner_must_not.len(), 1);
    let priority = inner_must_not[0]["terms"]["labels"].as_array().unwrap();
    assert_eq!(priority.len(), 3);

    // Macro's own notification sender is excluded from signal outright.
    assert_eq!(
        must_not[1],
        json!({
            "wildcard": {
                "sender": { "value": "*@notification.macro.com", "case_insensitive": true }
            }
        })
    );

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
    let noise_bool = filters
        .iter()
        .find(|f| f["bool"]["should"].is_array())
        .expect("should have nested importance filter");
    assert_eq!(noise_bool["bool"]["minimum_should_match"], 1);

    let should = noise_bool["bool"]["should"].as_array().unwrap();
    assert_eq!(should.len(), 2);

    // Depriority-labeled without a priority label...
    let depriority_bool = &should[0]["bool"];
    let depriority = depriority_bool["filter"][0]["terms"]["labels"]
        .as_array()
        .unwrap();
    assert_eq!(depriority.len(), 4);
    let priority = depriority_bool["must_not"][0]["terms"]["labels"]
        .as_array()
        .unwrap();
    assert_eq!(priority.len(), 3);

    // ...or from Macro's own notification sender.
    assert_eq!(
        should[1],
        json!({
            "wildcard": {
                "sender": { "value": "*@notification.macro.com", "case_insensitive": true }
            }
        })
    );

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
    // Should have all three: the explicit exclude_label, the importance
    // nested bool, and the Macro notification sender exclusion.
    assert_eq!(must_not.len(), 3);

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
    let has_importance_filter = filters.iter().any(|f| f["bool"]["should"].is_array());
    assert!(has_importance_filter);

    Ok(())
}

#[test]
fn test_build_bool_query_tag_filter_emits_flat_terms() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(vec!["foo".to_string()])
        .match_type("partial")
        .user_id("user123")
        .tag_option_ids(vec![
            "00000001-0000-0000-0003-000000000001".to_string(),
            "00000001-0000-0000-0003-000000000002".to_string(),
        ]);

    let json = builder.build_bool_query()?.build().to_json();
    let filter = json["bool"]["filter"].as_array().expect("filter array");

    let nested: Vec<&serde_json::Value> = filter
        .iter()
        .filter(|f| f.get("nested").is_some())
        .collect();
    assert_eq!(
        nested.len(),
        1,
        "tags collapse to one nested clause: {filter:?}"
    );

    let tags = &nested[0]["nested"];
    assert_eq!(tags["path"], "properties");
    assert_eq!(tags["ignore_unmapped"], true);
    // No definition_id term: match is on the globally-unique option ids alone.
    assert_eq!(
        tags["query"],
        serde_json::json!({
            "terms": {"properties.values": [
                "00000001-0000-0000-0003-000000000001",
                "00000001-0000-0000-0003-000000000002"
            ]}
        })
    );

    Ok(())
}

#[test]
fn test_build_bool_query_tag_filter_empty_skipped() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(vec!["foo".to_string()])
        .match_type("partial")
        .user_id("user123")
        .tag_option_ids(vec![]);

    let json = builder.build_bool_query()?.build().to_json();
    let filter = json["bool"]["filter"].as_array().expect("filter array");
    assert!(
        !filter.iter().any(|f| f.get("nested").is_some()),
        "empty tag_option_ids should emit no nested clause: {filter:?}"
    );
    Ok(())
}

fn access_filter(json: &serde_json::Value) -> &serde_json::Value {
    &json["bool"]["filter"][0]
}

#[test]
fn test_shared_threads_widen_the_mailbox_access() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(vec!["test".to_string()])
        .match_type("partial")
        .user_id("macro|viewer@example.com")
        .user_ids(vec!["macro|viewer@example.com".to_string()])
        .ids(vec!["shared-thread".to_string()]);

    let json = builder.build_bool_query()?.build().to_json();

    assert_eq!(
        access_filter(&json),
        &json!({
            "bool": {
                "minimum_should_match": 1,
                "should": [
                    { "terms": { "entity_id": ["shared-thread"] } },
                    { "terms": { "user_id": ["macro|viewer@example.com"] } }
                ]
            }
        })
    );
    Ok(())
}

#[test]
fn test_ids_only_searches_only_the_listed_threads() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(vec!["test".to_string()])
        .match_type("partial")
        .user_id("macro|viewer@example.com")
        .user_ids(vec!["macro|viewer@example.com".to_string()])
        .ids(vec!["shared-thread".to_string()])
        .ids_only(true);

    let json = builder.build_bool_query()?.build().to_json();

    assert_eq!(
        access_filter(&json),
        &json!({ "terms": { "entity_id": ["shared-thread"] } })
    );
    Ok(())
}

#[test]
fn test_required_thread_ids_narrow_on_top_of_access() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(vec!["test".to_string()])
        .match_type("partial")
        .user_id("macro|viewer@example.com")
        .user_ids(vec!["macro|viewer@example.com".to_string()])
        .required_thread_ids(vec!["thread-a".to_string(), "thread-b".to_string()]);

    let json = builder.build_bool_query()?.build().to_json();

    assert_eq!(
        access_filter(&json),
        &json!({ "terms": { "user_id": ["macro|viewer@example.com"] } })
    );
    let filters = json["bool"]["filter"].as_array().unwrap();
    assert!(
        filters.contains(&json!({ "terms": { "entity_id": ["thread-a", "thread-b"] } })),
        "expected a required thread filter, got {filters:?}"
    );
    Ok(())
}

fn subject_condition(text: &str, exclude: bool) -> EmailTextCondition {
    EmailTextCondition {
        fields: EmailTextFields::Subject,
        text: text.to_string(),
        exclude,
    }
}

#[test]
fn a_subject_condition_matches_the_subject_alone() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(vec!["menu".to_string()])
        .match_type("partial")
        .user_id("user123")
        .text_conditions(vec![subject_condition("lunch", false)]);

    let json = builder.build_bool_query()?.build().to_json();
    let must = json["bool"]["must"].as_array().unwrap();

    assert_eq!(must.len(), 2);
    assert_eq!(
        must[1],
        json!({
            "bool": {
                "should": [{
                    "simple_query_string": {
                        "query": "lunch*",
                        "fields": ["subject"],
                        "default_operator": "AND"
                    }
                }],
                "minimum_should_match": 1
            }
        })
    );
    Ok(())
}

#[test]
fn an_excluded_condition_leaves_its_messages_out() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(vec!["menu".to_string()])
        .match_type("partial")
        .user_id("user123")
        .text_conditions(vec![subject_condition("team lunch", true)]);

    let json = builder.build_bool_query()?.build().to_json();

    assert_eq!(json["bool"]["must"].as_array().unwrap().len(), 1);
    assert_eq!(
        json["bool"]["must_not"][0]["bool"]["should"][0]["simple_query_string"]["query"],
        "\"team lunch\""
    );
    Ok(())
}

#[test]
fn a_from_condition_matches_the_sender_by_name_or_address() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(Vec::new())
        .match_type("partial")
        .user_id("user123")
        .text_conditions(vec![EmailTextCondition {
            fields: EmailTextFields::From,
            text: "ana".to_string(),
            exclude: false,
        }]);

    let json = builder.build_bool_query()?.build().to_json();

    assert_eq!(
        json["bool"]["must"],
        json!([{
            "bool": {
                "should": [
                    {
                        "simple_query_string": {
                            "query": "ana@*",
                            "fields": ["sender"],
                            "default_operator": "AND"
                        }
                    },
                    {
                        "simple_query_string": {
                            "query": "(ana)",
                            "fields": ["sender.parts"],
                            "default_operator": "AND"
                        }
                    },
                    {
                        "simple_query_string": {
                            "query": "ana*",
                            "fields": ["sender_name"],
                            "default_operator": "AND"
                        }
                    }
                ],
                "minimum_should_match": 1
            }
        }])
    );
    Ok(())
}

#[test]
fn a_search_of_conditions_alone_keeps_the_access_filter() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(Vec::new())
        .match_type("partial")
        .user_id("user123")
        .sent_between(Some(1_000), Some(2_000));

    let json = builder.build_bool_query()?.build().to_json();

    assert!(json["bool"]["must"].is_null());
    assert_eq!(
        access_filter(&json),
        &json!({ "term": { "user_id": "user123" } })
    );
    let filters = json["bool"]["filter"].as_array().unwrap();
    assert!(filters.contains(&json!({
        "script": {
            "script": {
                "source": "doc['sent_at_millis'].size() > 0 \
                    && doc['sent_at_millis'].value.toInstant().toEpochMilli() >= params.after \
                    && doc['sent_at_millis'].value.toInstant().toEpochMilli() < params.before",
                "lang": "painless",
                "params": { "after": 1_000, "before": 2_000 }
            }
        }
    })));
    Ok(())
}

#[test]
fn one_sent_bound_checks_only_that_bound() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(vec!["menu".to_string()])
        .match_type("partial")
        .user_id("user123")
        .sent_between(None, Some(2_000));

    let json = builder.build_bool_query()?.build().to_json();
    let script = json["bool"]["filter"]
        .as_array()
        .unwrap()
        .iter()
        .find_map(|filter| filter.get("script"))
        .expect("the sent bound is a script filter");

    assert_eq!(script["script"]["params"], json!({ "before": 2_000 }));
    assert!(
        !script["script"]["source"]
            .as_str()
            .unwrap()
            .contains("params.after")
    );
    Ok(())
}

#[test]
fn a_label_condition_matches_a_label_or_a_tag() -> anyhow::Result<()> {
    let builder = EmailQueryBuilder::new(vec!["menu".to_string()])
        .match_type("partial")
        .user_id("user123")
        .label_conditions(vec![
            EmailLabelCondition {
                labels: vec!["Fundraising".to_string()],
                tag_option_ids: vec!["opt-1".to_string()],
                exclude: false,
            },
            EmailLabelCondition {
                labels: vec!["Updates".to_string()],
                tag_option_ids: Vec::new(),
                exclude: true,
            },
            EmailLabelCondition {
                labels: Vec::new(),
                tag_option_ids: Vec::new(),
                exclude: true,
            },
        ])
        .exclude_thread_ids(vec!["thread-1".to_string()]);

    let json = builder.build_bool_query()?.build().to_json();

    let carries = json["bool"]["filter"]
        .as_array()
        .unwrap()
        .iter()
        .find(|filter| filter["bool"]["minimum_should_match"] == 1)
        .expect("the label condition is a filter");
    let should = carries["bool"]["should"].as_array().unwrap();
    assert_eq!(should[0], json!({ "terms": { "labels": ["Fundraising"] } }));
    assert!(should[1]["nested"].is_object());

    assert_eq!(
        json["bool"]["must_not"],
        json!([
            {
                "bool": {
                    "should": [{ "terms": { "labels": ["Updates"] } }],
                    "minimum_should_match": 1
                }
            },
            { "terms": { "entity_id": ["thread-1"] } }
        ])
    );
    Ok(())
}

fn phrase_prefix(field: &str, term: &str) -> serde_json::Value {
    json!({"match_phrase_prefix": {field: {"query": term, "max_expansions": 256}}})
}

#[test]
fn a_hyphenated_word_matches_its_words_together_in_one_field() {
    let terms = vec!["menu".to_string(), "follow-up".to_string()];

    let json = terms_query(&terms, "partial", &[], &["subject", "content"], false).to_json();

    assert_eq!(
        json,
        json!({
            "bool": {
                "should": [{
                    "bool": {
                        "must": [
                            {
                                "simple_query_string": {
                                    "query": "menu*",
                                    "fields": ["subject", "content"],
                                    "default_operator": "AND"
                                }
                            },
                            {
                                "bool": {
                                    "should": [
                                        phrase_prefix("subject", "follow-up"),
                                        phrase_prefix("content", "follow-up")
                                    ],
                                    "minimum_should_match": 1
                                }
                            }
                        ]
                    }
                }],
                "minimum_should_match": 1
            }
        })
    );
}

#[test]
fn a_hyphenated_word_alone_needs_no_query_string() {
    let terms = vec!["re-org".to_string()];

    let json = terms_query(&terms, "partial", &[], &["subject"], false).to_json();

    assert_eq!(
        json["bool"]["should"][0],
        json!({
            "bool": {
                "must": [{
                    "bool": {
                        "should": [phrase_prefix("subject", "re-org")],
                        "minimum_should_match": 1
                    }
                }]
            }
        })
    );
}

#[test]
fn a_term_of_one_word_or_an_exact_short_or_quoted_one_stays_in_the_query_string() {
    for (terms, match_type, query) in [
        (vec!["follow-up"], "exact", "(follow\\-up)"),
        (vec!["follow-up"], "regexp", "follow-up*"),
        (vec!["東京"], "partial", "(東京)"),
        (vec!["the follow-up"], "partial", "\"the follow\\-up\""),
        (vec!["node.js"], "partial", "node.js*"),
        (vec!["follow-"], "partial", "follow*"),
        (vec!["Re:"], "partial", "(Re)"),
        (vec!["c++"], "partial", "(c)"),
        (vec!["नमस्ते"], "partial", "नमस्ते*"),
        // One token each: a Thai run, and the words of `CO₂` and `10½`.
        (vec!["สวัสดี"], "partial", "สวัสดี*"),
        (vec!["CO₂"], "partial", "\"CO₂\""),
        (vec!["10½"], "partial", "\"10½\""),
    ] {
        let terms: Vec<String> = terms.into_iter().map(str::to_string).collect();

        let json = terms_query(&terms, match_type, &[], &["subject"], false).to_json();

        assert_eq!(
            json["bool"]["should"][0]["simple_query_string"]["query"], query,
            "{terms:?} in {match_type} match"
        );
    }
}

#[test]
fn a_run_unicode_splits_into_words_matches_as_a_phrase_prefix() {
    for term in ["東京都", "AT&T", "x²y", "ไทย-ลาว"] {
        let terms = vec![term.to_string()];

        let json = terms_query(&terms, "partial", &[], &["subject"], false).to_json();

        assert_eq!(
            json["bool"]["should"][0]["bool"]["must"][0]["bool"]["should"][0],
            phrase_prefix("subject", term),
            "{term}"
        );
    }
}

#[test]
fn a_terms_punctuation_is_never_read_as_query_syntax() {
    for (term, address, segments, text) in [
        ("-lunch", "lunch@*", "(lunch)", "lunch*"),
        ("--force", "force@*", "(force)", "force*"),
        ("(Lunch", "lunch@*", "(Lunch)", "Lunch*"),
        ("-नमस्ते", "नमस्ते@*", "(नमस्ते)", "नमस्ते*"),
        ("-สวัสดี", "สวัสดี@*", "(สวัสดี)", "สวัสดี*"),
        ("-", r"\-@*", r"(\-)", r"(\-)"),
        ("a+", "a@*", "(a)", "(a)"),
        ("lunch*", "lunch@*", "(lunch)", "lunch*"),
        ("C♯", "c♯@*", "(C♯)", "(C♯)"),
        ("-lunch🎉", r"\-lunch🎉@*", r"(\-lunch🎉)", r#""\-lunch🎉""#),
        (
            r#"-team "lunch"#,
            r#""\-team \"lunch""#,
            r#""\-team \"lunch""#,
            r#""\-team \"lunch""#,
        ),
        (
            r"team lunch\",
            r#""team lunch\\""#,
            r#""team lunch\\""#,
            r#""team lunch\\""#,
        ),
        (
            "ana+news@probe.example",
            r#""ana\+news@probe.example""#,
            r#""ana\+news@probe.example""#,
            r#""ana\+news@probe.example""#,
        ),
    ] {
        let terms = [term.to_string()];

        assert_eq!(build_address_query_string(&terms), address);
        assert_eq!(build_segment_query_string(&terms, false), segments);
        assert_eq!(build_text_query_string(&terms, "partial", false), text);
    }
    for (term, literal) in [
        ("lunch~2", r"lunch\~2"),
        ("lunch|menu", r"lunch\|menu"),
        (r"lunch\|menu", r"lunch\\\|menu"),
        ("lunch(menu)", r"lunch\(menu\)"),
        ("lunch*menu", r"lunch\*menu"),
    ] {
        let terms = [term.to_string()];

        assert_eq!(build_address_query_string(&terms), format!("{literal}@*"));
        assert_eq!(
            build_segment_query_string(&terms, false),
            format!("({literal})")
        );
        assert_eq!(
            build_text_query_string(&terms, "exact", false),
            format!("({literal})")
        );
    }
}

#[test]
fn regexp_syntax_runs_as_typed_over_every_address_field() {
    let terms = vec!["lunch|menu".to_string(), "-lunch".to_string()];

    let json = terms_query(
        &terms,
        "regexp",
        EMAIL_KEYWORD_FIELDS,
        EMAIL_TEXT_FIELDS,
        false,
    )
    .to_json();

    assert_eq!(
        json["bool"]["should"],
        json!([
            {
                "simple_query_string": {
                    "query": "(lunch|menu | lunch|menu@*) + (-lunch | -lunch@*)",
                    "fields": EMAIL_KEYWORD_FIELDS,
                    "default_operator": "AND"
                }
            },
            {
                "simple_query_string": {
                    "query": "lunch|menu* + -lunch*",
                    "fields": EMAIL_TEXT_FIELDS,
                    "default_operator": "AND"
                }
            }
        ])
    );
}

/// The three clauses of a search of `terms`: whole addresses, address
/// segments and text.
fn term_clauses(terms: Vec<String>, match_type: &str) -> anyhow::Result<serde_json::Value> {
    let json = EmailQueryBuilder::new(terms)
        .match_type(match_type)
        .user_id("user123")
        .build_bool_query()?
        .build()
        .to_json();
    Ok(json["bool"]["must"][0]["bool"]["should"].clone())
}

#[test]
fn a_search_of_too_many_clauses_matches_every_term_in_one_clause_per_field() -> anyhow::Result<()> {
    let hyphenated = |count: usize| -> Vec<String> {
        let mut terms = vec!["menu".to_string(), "ab".to_string()];
        terms.extend((0..count).map(|i| format!("word{i}-up")));
        terms
    };
    let query = |json: &serde_json::Value| {
        let query = json["simple_query_string"]["query"].as_str();
        query.unwrap_or_default().to_string()
    };

    // 27 cost a clause per token in the address segments and text fields each,
    // under the limit with the two words.
    let full = term_clauses(hyphenated(27), "partial")?;
    assert!(query(&full[1]).starts_with(r"(menu) + (ab) + (word0\-up) + "));
    assert_eq!(query(&full[2]["bool"]["must"][0]), "menu* + (ab)");
    assert_eq!(
        full[2]["bool"]["must"][1]["bool"]["should"][0],
        phrase_prefix("subject", "word0-up")
    );

    let compact = term_clauses(hyphenated(34), "partial")?;
    assert!(query(&compact[0]).starts_with(r"menu@* + ab@* + word0\-up@* + "));
    assert!(query(&compact[1]).starts_with(r#""menu" + "ab" + "word0\-up" + "#));
    assert!(query(&compact[2]).starts_with(r#"menu* + "ab" + "word0\-up" + "#));

    let exact = term_clauses(hyphenated(34), "exact")?;
    assert!(query(&exact[2]).starts_with(r#""menu" + "ab" + "word0\-up" + "#));
    Ok(())
}

#[test]
fn text_conditions_count_toward_the_clauses_of_a_search() -> anyhow::Result<()> {
    let subject_query = |count: usize| -> anyhow::Result<serde_json::Value> {
        let conditions = (0..count).map(|i| EmailTextCondition {
            fields: EmailTextFields::Any,
            text: format!("word{i}-up"),
            exclude: true,
        });
        let json = EmailQueryBuilder::new(vec!["follow-up".to_string()])
            .match_type("partial")
            .user_id("user123")
            .text_conditions(conditions.collect())
            .build_bool_query()?
            .build()
            .to_json();
        Ok(json["bool"]["must"][0]["bool"]["should"][2].clone())
    };

    assert_eq!(
        subject_query(1)?["bool"]["must"][0]["bool"]["should"][0],
        phrase_prefix("subject", "follow-up")
    );
    assert_eq!(
        subject_query(40)?["simple_query_string"]["query"],
        r#""follow\-up""#
    );
    Ok(())
}

#[test]
fn a_term_costs_a_clause_per_token_where_it_is_not_quoted() {
    for (term, cost) in [
        ("lunch", 16),
        ("-lunch", 16),
        ("สวัสดี", 16),
        ("team lunch", 16),
        ("team\nlunch", 16),
        ("ana@probe.example", 16),
        ("follow-up", 5 + 5 * 2 + 6 * 2),
        ("2025-03-01", 5 + 5 * 3 + 6 * 3),
        ("東京", 5 + 5 * 2 + 6 * 2),
        ("🎉😀word-l", 5 + 5 * 4 + 6 * 4),
        ("probe.example/a-b", 5 + 5 + 6 * 3),
    ] {
        assert_eq!(
            clauses(term, EMAIL_KEYWORD_FIELDS, EMAIL_TEXT_FIELDS),
            cost,
            "{term}"
        );
    }
}
