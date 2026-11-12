use super::*;
use opensearch_query_builder::ToOpenSearchJson;
use serde_json::json;

#[test]
fn test_build_address_part_query_string_single_term_is_whole_segment() {
    let result = build_address_part_query_string(&["Teo".to_string()]);
    assert_eq!(result, "Teo");
}

#[test]
fn test_build_address_query_string_single_term_is_lowercased_local_part() {
    let result = build_address_query_string(&["Teo".to_string()]);
    assert_eq!(result, "teo@*");
}

#[test]
fn test_build_address_query_strings_and_multiple_terms() {
    let terms = ["hello".to_string(), "test".to_string()];
    assert_eq!(build_address_part_query_string(&terms), "hello + test");
    assert_eq!(build_address_query_string(&terms), "hello@* + test@*");
}

#[test]
fn test_build_address_query_strings_multi_word_term_uses_phrase() {
    // Multi-word terms come from quoted phrases via `split_search_terms`
    // and must render as a phrase so simple_query_string's AND default
    // operator doesn't decompose them into independent tokens.
    let terms = ["hi there".to_string()];
    assert_eq!(build_address_part_query_string(&terms), "\"hi there\"");
    assert_eq!(build_address_query_string(&terms), "\"hi there\"");
}

#[test]
fn test_build_address_query_strings_dotted_and_email_terms_use_phrase() {
    for term in ["example.com", "alice@example.com"] {
        let terms = [term.to_string()];
        let phrase = format!("\"{term}\"");
        assert_eq!(build_address_part_query_string(&terms), phrase);
        assert_eq!(build_address_query_string(&terms), phrase);
    }
}

#[test]
fn test_build_address_query_strings_mixed_phrase_and_word() {
    let terms = ["alice@example.com".to_string(), "Review".to_string()];
    assert_eq!(
        build_address_part_query_string(&terms),
        "\"alice@example.com\" + Review"
    );
    assert_eq!(
        build_address_query_string(&terms),
        "\"alice@example.com\" + review@*"
    );
}

#[test]
fn test_build_text_query_string_single_term_is_prefix() {
    let result = build_text_query_string(&["scri".to_string()], "partial");
    assert_eq!(result, "scri*");
}

#[test]
fn test_build_text_query_string_multiple_terms_are_prefixed_and_anded() {
    let result = build_text_query_string(&["scri".to_string(), "test".to_string()], "partial");
    assert_eq!(result, "scri* + test*");
}

#[test]
fn test_build_text_query_string_exact_drops_prefix_wildcard() {
    let result = build_text_query_string(&["scri".to_string(), "test".to_string()], "exact");
    assert_eq!(result, "(scri) + (test)");
}

#[test]
fn test_build_text_query_string_multi_word_term_uses_phrase() {
    // Multi-word terms come from quoted phrases via `split_search_terms`
    // and must render as a phrase so simple_query_string's AND default
    // operator doesn't decompose them into independent tokens.
    let result = build_text_query_string(&["hi there".to_string()], "partial");
    assert_eq!(result, "\"hi there\"");
}

#[test]
fn test_build_text_query_string_email_term_uses_phrase() {
    let result = build_text_query_string(&["alice@example.com".to_string()], "partial");
    assert_eq!(result, "\"alice@example.com\"");
}

#[test]
fn test_build_text_query_string_short_term_skips_prefix() {
    let result = build_text_query_string(&["ab".to_string()], "partial");
    assert_eq!(result, "(ab)");
}

#[test]
fn test_build_text_query_string_three_char_term_gets_prefix() {
    let result = build_text_query_string(&["abc".to_string()], "partial");
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
        tag_option_ids: vec![],
        match_all_tags: false,
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
        tag_option_ids: vec![],
        match_all_tags: false,
    }
    .into();

    let json = builder.build_bool_query()?.build().to_json();
    let should = json["bool"]["must"][0]["bool"]["should"]
        .as_array()
        .unwrap();
    assert_eq!(json["bool"]["must"][0]["bool"]["minimum_should_match"], 1);
    assert_eq!(should.len(), 3);

    let sqs_on = |field: &str| {
        should
            .iter()
            .map(|s| &s["simple_query_string"])
            .find(|s| {
                s["fields"]
                    .as_array()
                    .is_some_and(|f| f.contains(&serde_json::json!(field)))
            })
            .unwrap()
    };

    let part_sqs = sqs_on("sender.parts");
    assert_eq!(part_sqs["query"], "hello + test");
    assert_eq!(part_sqs["default_operator"], "AND");
    assert_eq!(
        part_sqs["fields"],
        json!([
            "sender.parts",
            "reply_to.parts",
            "recipients.parts",
            "cc.parts",
            "bcc.parts"
        ])
    );

    let address_sqs = sqs_on("sender");
    assert_eq!(address_sqs["query"], "hello@* + test@*");
    assert_eq!(address_sqs["default_operator"], "AND");
    assert_eq!(
        address_sqs["fields"],
        json!(["sender", "reply_to", "recipients", "cc", "bcc"])
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
                                    "fields": ["sender.parts", "reply_to.parts", "recipients.parts", "cc.parts", "bcc.parts"],
                                    "query": "test"
                                }
                            },
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

/// A mailbox whose subjects hold more than 256 words for each of several
/// short prefixes. Before single-word prefixes became `match_bool_prefix`,
/// a five-word subject search on it expanded into 5 × 256 clauses, and a
/// 50-word content search cost 26 clauses a word; both exceeded
/// OpenSearch's 1024-clause limit and failed every search for the user.
#[tokio::test]
#[ignore = "requires local OpenSearch at http://localhost:9200"]
async fn large_mailbox_search_stays_under_clause_limit() {
    use crate::{
        OpensearchClient,
        error::{OpensearchClientError, ResponseExt},
    };
    use opensearch::{
        BulkParts, SearchParts,
        indices::{IndicesDeleteParts, IndicesRefreshParts},
    };

    const OWNER: &str = "large-mailbox-user";
    const PREFIXES: [&str; 5] = ["inv", "rev", "pro", "con", "sta"];
    const WORDS_PER_PREFIX: usize = 300;

    let client =
        OpensearchClient::new("http://localhost:9200".into(), "".into(), "".into()).unwrap();
    let index = format!("email-clause-limit-test-{}", uuid::Uuid::now_v7());
    let address = json!({"type": "keyword", "fields": {"parts": {"type": "text", "analyzer": "email_parts"}}});
    client
        .ensure_index_exists(
            &index,
            json!({
                "settings": {"number_of_shards": 1, "number_of_replicas": 0, "analysis": {
                    "char_filter": {"email_separators": {
                        "type": "mapping", "mappings": ["@ => \\u0020", ". => \\u0020", "+ => \\u0020"]
                    }},
                    "analyzer": {"email_parts": {
                        "type": "custom", "tokenizer": "standard",
                        "char_filter": ["email_separators"], "filter": ["lowercase"]
                    }}
                }},
                "mappings": {"dynamic": false, "properties": {
                    "entity_id": {"type": "keyword"},
                    "user_id": {"type": "keyword"},
                    "subject": {"type": "text"},
                    "content": {"type": "text", "analyzer": "standard"},
                    "sender": address, "reply_to": address, "recipients": address,
                    "cc": address, "bcc": address,
                    "sender_name": {"type": "text"}, "recipient_names": {"type": "text"},
                    "cc_names": {"type": "text"}, "bcc_names": {"type": "text"}
                }}
            }),
        )
        .await
        .unwrap();

    let content_terms: Vec<String> = (0..50).map(|i| format!("topic{i}")).collect();
    let target_subject = "invoice review project contract status";
    let mut bulk = String::new();
    let mut push = |id: &str, user_id: &str, subject: String, content: String| {
        bulk.push_str(&json!({"index": {"_index": index, "_id": id}}).to_string());
        bulk.push('\n');
        bulk.push_str(
            &json!({
                "entity_id": id, "user_id": user_id, "subject": subject, "content": content,
                "sender": "sender@example.com", "recipients": ["recipient@example.com"]
            })
            .to_string(),
        );
        bulk.push('\n');
    };
    for prefix in PREFIXES {
        let words: Vec<String> = (0..WORDS_PER_PREFIX)
            .map(|i| {
                let letter = |n: usize| char::from(b'a' + (n % 26) as u8);
                format!("{prefix}{}{}{}", letter(i / 676), letter(i / 26), letter(i))
            })
            .collect();
        for (chunk_index, chunk) in words.chunks(25).enumerate() {
            push(
                &format!("{prefix}-{chunk_index}"),
                OWNER,
                chunk.join(" "),
                "filler".into(),
            );
        }
    }
    push(
        "target",
        OWNER,
        target_subject.into(),
        content_terms.join(" "),
    );
    push(
        "other-user-target",
        "other-user",
        target_subject.into(),
        content_terms.join(" "),
    );

    let result: anyhow::Result<()> = async {
        client
            .inner
            .bulk(BulkParts::None)
            .body(vec![bulk])
            .send()
            .await?
            .error_for_status_code()?;
        client
            .inner
            .indices()
            .refresh(IndicesRefreshParts::Index(&[&index]))
            .send()
            .await?
            .error_for_status_code()?;

        let search = |builder: EmailQueryBuilder| {
            let client = &client;
            let index = &index;
            async move {
                let mut query = builder.user_id(OWNER).build_bool_query()?.build().to_json();
                let filters = query["bool"]["filter"].as_array_mut().unwrap();
                let index_filter = filters
                    .iter_mut()
                    .find(|filter| filter["term"]["_index"].is_string())
                    .unwrap();
                index_filter["term"]["_index"] = json!(index);
                let response: serde_json::Value = client
                    .inner
                    .search(SearchParts::Index(&[index]))
                    .body(json!({
                        "query": query,
                        "highlight": {"fields": {"subject": {"type": "plain"}, "content": {"type": "plain"}}}
                    }))
                    .send()
                    .await
                    .map_client_error()
                    .await?
                    .json()
                    .await?;
                anyhow::Ok(response)
            }
        };

        let subject_terms = PREFIXES.iter().map(|prefix| prefix.to_string()).collect();
        let by_subject = search(
            EmailQueryBuilder::new(subject_terms)
                .match_type("partial")
                .subject_only(true),
        )
        .await?;
        assert_eq!(by_subject["hits"]["total"]["value"], 1, "{by_subject}");
        let hit = &by_subject["hits"]["hits"][0];
        assert_eq!(hit["_source"]["entity_id"], "target");
        let snippet = hit["highlight"]["subject"][0].as_str().unwrap();
        assert!(snippet.contains("<em>invoice</em>"), "{snippet}");

        let by_content = search(
            EmailQueryBuilder::new(content_terms.clone()).match_type("partial"),
        )
        .await?;
        assert_eq!(by_content["hits"]["total"]["value"], 1, "{by_content}");
        assert_eq!(by_content["hits"]["hits"][0]["_source"]["entity_id"], "target");

        let phrase_prefixes: Vec<serde_json::Value> = PREFIXES
            .iter()
            .map(|prefix| json!({"match_phrase_prefix": {"subject": {"query": prefix, "max_expansions": 256}}}))
            .collect();
        let wide_bool: Vec<serde_json::Value> = (0..1100)
            .map(|i| json!({"term": {"subject": format!("word{i}")}}))
            .collect();
        for query in [
            json!({"bool": {"must": phrase_prefixes, "filter": [{"term": {"user_id": OWNER}}]}}),
            json!({"bool": {"should": wide_bool}}),
        ] {
            let rejected = client
                .inner
                .search(SearchParts::Index(&[&index]))
                .body(json!({"query": query}))
                .send()
                .await
                .map_client_error()
                .await;
            assert!(
                matches!(rejected, Err(OpensearchClientError::TooManyClauses { .. })),
                "{rejected:?}"
            );
        }
        Ok(())
    }
    .await;
    client
        .inner
        .indices()
        .delete(IndicesDeleteParts::Index(&[&index]))
        .send()
        .await
        .unwrap()
        .error_for_status_code()
        .unwrap();
    result.unwrap();
}
