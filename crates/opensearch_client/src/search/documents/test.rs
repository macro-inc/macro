use super::*;
use opensearch_query_builder::ToOpenSearchJson;

#[test]
fn test_build_bool_query_join_shape_multi_term_and() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["foo".to_string(), "bar".to_string()])
        .match_type("partial")
        .page_size(20)
        .page(0)
        .user_id("alice");

    let json = builder.build_bool_query()?.build().to_json();

    let filter = json["bool"]["filter"].as_array().expect("filter array");
    assert!(
        filter.contains(&serde_json::json!({"term": {"_index": "documents"}})),
        "filter must constrain to documents index: {filter:?}"
    );
    assert!(
        filter.contains(&serde_json::json!({"term": {"document_relation": "document"}})),
        "filter must constrain to parent docs: {filter:?}"
    );
    assert!(
        filter.contains(&serde_json::json!({"term": {"owner_id": "alice"}})),
        "filter must constrain to owner: {filter:?}"
    );

    let must = json["bool"]["must"].as_array().expect("must array");
    assert_eq!(must.len(), 2, "expected one has_child per term: {must:?}");

    let term_match = |val: &serde_json::Value, expected_term: &str, expected_type: &str| {
        let has_child = &val["has_child"];
        assert_eq!(has_child["type"], "chunk");
        assert_eq!(
            has_child["query"][expected_type]["content"]["query"],
            expected_term
        );
    };
    term_match(&must[0], "foo", "match_phrase_prefix");
    term_match(&must[1], "bar", "match_phrase_prefix");

    Ok(())
}

#[test]
fn test_build_bool_query_join_shape_quoted_phrase_uses_match_phrase() -> anyhow::Result<()> {
    // A term that came from a quoted phrase has internal whitespace and
    // should fall back to match_phrase (no prefix expansion).
    let builder = DocumentQueryBuilder::new(vec!["deal review".to_string()])
        .match_type("partial")
        .user_id("alice");

    let json = builder.build_bool_query()?.build().to_json();
    let must = &json["bool"]["must"][0]["has_child"]["query"];
    assert!(
        must.get("match_phrase").is_some(),
        "quoted phrase should use match_phrase, got {must:?}"
    );
    assert_eq!(must["match_phrase"]["content"], "deal review");
    Ok(())
}

#[test]
fn test_build_bool_query_join_shape_short_term_no_prefix() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["ab".to_string()])
        .match_type("partial")
        .user_id("alice");

    let json = builder.build_bool_query()?.build().to_json();
    let must = &json["bool"]["must"][0]["has_child"]["query"];
    assert!(
        must.get("match_phrase").is_some(),
        "short term should use match_phrase, got {must:?}"
    );
    Ok(())
}

#[test]
fn test_build_bool_query_join_shape_exact_match_type_uses_match_phrase() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["release".to_string()])
        .match_type("exact")
        .user_id("alice");

    let json = builder.build_bool_query()?.build().to_json();
    let must = &json["bool"]["must"][0]["has_child"]["query"];
    assert!(
        must.get("match_phrase").is_some(),
        "match_type=exact should use match_phrase, got {must:?}"
    );
    Ok(())
}

#[test]
fn test_build_bool_query_join_shape_ids_only_filter() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["foo".to_string()])
        .match_type("partial")
        .user_id("alice")
        .ids(vec!["doc1".to_string(), "doc2".to_string()])
        .ids_only(true);

    let json = builder.build_bool_query()?.build().to_json();
    let filter = json["bool"]["filter"].as_array().expect("filter array");
    assert!(
        filter.contains(&serde_json::json!({
            "terms": { "entity_id": ["doc1", "doc2"] }
        })),
        "ids_only should restrict to entity_id terms: {filter:?}"
    );
    assert!(
        !filter
            .iter()
            .any(|f| f.get("term").and_then(|t| t.get("owner_id")).is_some()),
        "ids_only should not include owner filter: {filter:?}"
    );
    Ok(())
}

#[test]
fn test_build_bool_query_join_shape_sub_type_filter() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["foo".to_string()])
        .match_type("partial")
        .user_id("alice")
        .sub_types(vec!["task".to_string()]);

    let json = builder.build_bool_query()?.build().to_json();
    let filter = json["bool"]["filter"].as_array().expect("filter array");
    assert!(
        filter.contains(&serde_json::json!({"terms": {"sub_type": ["task"]}})),
        "sub_type filter should be on the parent: {filter:?}"
    );
    Ok(())
}

#[test]
fn test_build_bool_query_join_shape_has_inner_hits() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["foo".to_string(), "bar".to_string()])
        .match_type("partial")
        .user_id("alice");

    let json = builder.build_bool_query()?.build().to_json();
    let must = json["bool"]["must"].as_array().expect("must array");
    for (idx, clause) in must.iter().enumerate() {
        let inner = &clause["has_child"]["inner_hits"];
        assert!(
            inner.is_object(),
            "expected inner_hits on has_child clause {idx}: {clause:?}"
        );
        assert_eq!(
            inner["name"],
            format!("term_{idx}"),
            "inner_hits name should be term_<idx>"
        );
        assert_eq!(
            inner["highlight"]["max_analyzer_offset"],
            serde_json::json!(super::super::HIGHLIGHT_MAX_ANALYZER_OFFSET),
            "inner_hits highlight must cap analyzed offset so an oversized \
             chunk can't fail the shard fetch: {inner:?}"
        );
    }
    Ok(())
}

#[test]
fn test_build_bool_query_name_mode_matches_document_name() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["report".to_string()])
        .match_type("partial")
        .user_id("alice")
        .mode(DocumentSearchMode::Name);

    let json = builder.build_bool_query()?.build().to_json();

    // Access + index filters are unchanged in name mode.
    let filter = json["bool"]["filter"].as_array().expect("filter array");
    assert!(filter.contains(&serde_json::json!({"term": {"_index": "documents"}})));
    assert!(filter.contains(&serde_json::json!({"term": {"owner_id": "alice"}})));

    // The match clause targets the parent document_name, not child content.
    let must = json["bool"]["must"].as_array().expect("must array");
    assert_eq!(must.len(), 1, "name mode emits one title clause: {must:?}");
    assert_eq!(
        must[0]["match_phrase_prefix"]["document_name"]["query"],
        "report"
    );
    assert!(
        !json.to_string().contains("has_child"),
        "name mode must not query child content: {json}"
    );
    Ok(())
}

#[test]
fn test_build_bool_query_name_content_mode_matches_either() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["report".to_string()])
        .match_type("partial")
        .user_id("alice")
        .mode(DocumentSearchMode::NameContent);

    let json = builder.build_bool_query()?.build().to_json();

    let must = json["bool"]["must"].as_array().expect("must array");
    assert_eq!(
        must.len(),
        1,
        "name_content wraps matching in one should-bool: {must:?}"
    );
    assert_eq!(must[0]["bool"]["minimum_should_match"], 1);
    let should = must[0]["bool"]["should"].as_array().expect("should array");
    assert_eq!(
        should.len(),
        2,
        "expected a name branch and a content branch: {should:?}"
    );

    // One branch matches the parent document_name…
    assert!(
        should
            .iter()
            .any(|c| c["match_phrase_prefix"]["document_name"]["query"] == "report"),
        "missing document_name branch: {should:?}"
    );
    // …the other matches child content via has_child.
    assert!(
        should
            .iter()
            .any(|c| c["bool"]["must"][0]["has_child"]["type"] == "chunk"),
        "missing has_child content branch: {should:?}"
    );
    Ok(())
}

#[test]
fn test_build_bool_query_property_filters_emit_nested() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["foo".to_string()])
        .match_type("partial")
        .user_id("alice")
        .property_filters(vec![
            PropertyFilterArg {
                definition_id: "00000001-0000-0000-0000-000000000002".to_string(),
                values: vec![
                    "00000001-0000-0000-0002-000000000001".to_string(),
                    "00000001-0000-0000-0002-000000000004".to_string(),
                ],
                date_range: None,
                has_date: None,
            },
            PropertyFilterArg {
                definition_id: "00000001-0000-0000-0000-000000000001".to_string(),
                values: vec!["macro|alice@example.com".to_string()],
                date_range: None,
                has_date: None,
            },
        ]);

    let json = builder.build_bool_query()?.build().to_json();
    let filter = json["bool"]["filter"].as_array().expect("filter array");

    let nested: Vec<&serde_json::Value> = filter
        .iter()
        .filter(|f| f.get("nested").is_some())
        .collect();
    assert_eq!(nested.len(), 2, "one nested clause per filter: {filter:?}");

    let status = &nested[0]["nested"];
    assert_eq!(status["path"], "properties");
    assert_eq!(status["ignore_unmapped"], true);
    let status_inner = status["query"]["bool"]["filter"]
        .as_array()
        .expect("nested bool filter");
    assert!(status_inner.contains(&serde_json::json!({
        "term": {"properties.definition_id": "00000001-0000-0000-0000-000000000002"}
    })));
    assert!(status_inner.contains(&serde_json::json!({
        "terms": {"properties.values": [
            "00000001-0000-0000-0002-000000000001",
            "00000001-0000-0000-0002-000000000004"
        ]}
    })));

    Ok(())
}

#[test]
fn test_build_bool_query_property_filter_empty_values_skipped() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["foo".to_string()])
        .match_type("partial")
        .user_id("alice")
        .property_filters(vec![PropertyFilterArg {
            definition_id: "00000001-0000-0000-0000-000000000002".to_string(),
            values: vec![],
            date_range: None,
            has_date: None,
        }]);

    let json = builder.build_bool_query()?.build().to_json();
    let filter = json["bool"]["filter"].as_array().expect("filter array");
    assert!(
        !filter.iter().any(|f| f.get("nested").is_some()),
        "empty-values filter should emit no nested clause: {filter:?}"
    );
    Ok(())
}

#[test]
fn test_build_bool_query_tag_filter_emits_flat_terms() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["foo".to_string()])
        .match_type("partial")
        .user_id("alice")
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
fn test_build_bool_query_tag_filter_match_all_emits_per_option_musts() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["foo".to_string()])
        .match_type("partial")
        .user_id("alice")
        .tag_option_ids(vec![
            "00000001-0000-0000-0003-000000000001".to_string(),
            "00000001-0000-0000-0003-000000000002".to_string(),
        ])
        .match_all_tags(true);

    let json = builder.build_bool_query()?.build().to_json();
    let filter = json["bool"]["filter"].as_array().expect("filter array");

    // Match-all wraps one nested clause per option id inside a bool.must, so
    // an entity must hold every id (possibly across nested property entries).
    let tag_bool: Vec<&serde_json::Value> = filter
        .iter()
        .filter(|f| f["bool"]["must"].is_array())
        .collect();
    assert_eq!(tag_bool.len(), 1, "one bool wrapper for tags: {filter:?}");

    let musts = tag_bool[0]["bool"]["must"].as_array().expect("must array");
    assert_eq!(musts.len(), 2, "one nested clause per option id");
    for (must, option_id) in musts.iter().zip([
        "00000001-0000-0000-0003-000000000001",
        "00000001-0000-0000-0003-000000000002",
    ]) {
        let nested = &must["nested"];
        assert_eq!(nested["path"], "properties");
        assert_eq!(nested["ignore_unmapped"], true);
        assert_eq!(
            nested["query"],
            serde_json::json!({"terms": {"properties.values": [option_id]}})
        );
    }

    Ok(())
}

#[test]
fn test_build_bool_query_tag_filter_empty_skipped() -> anyhow::Result<()> {
    let builder = DocumentQueryBuilder::new(vec!["foo".to_string()])
        .match_type("partial")
        .user_id("alice")
        .tag_option_ids(vec![]);

    let json = builder.build_bool_query()?.build().to_json();
    let filter = json["bool"]["filter"].as_array().expect("filter array");
    assert!(
        !filter.iter().any(|f| f.get("nested").is_some()),
        "empty tag_option_ids should emit no nested clause: {filter:?}"
    );
    Ok(())
}

#[test]
fn document_index_deserializes_parent_shape() {
    // Parent docs carry only parent-level metadata in `_source`; the
    // matching chunks' node_id / raw_content come via `inner_hits`.
    // Deserialization has to succeed (otherwise the unified search
    // response 500s on any parent hit).
    let parent = serde_json::json!({
        "entity_id": "00000000-0000-0000-0000-000000000001",
        "document_name": "Q3 Planning",
        "owner_id": "macro|alice@example.com",
        "file_type": "pdf",
        "updated_at_millis": 1779000000000_i64,
        "document_relation": "document",
    });

    let doc: DocumentIndex =
        serde_json::from_value(parent).expect("parent _source should deserialize");
    assert_eq!(doc.document_name, "Q3 Planning");
    assert_eq!(doc.owner_id, "macro|alice@example.com");
}

#[test]
fn date_property_filters_constrain_candidates_before_search_pagination() -> anyhow::Result<()> {
    let start =
        chrono::DateTime::parse_from_rfc3339("2025-12-31T23:59:59Z")?.with_timezone(&chrono::Utc);
    let end =
        chrono::DateTime::parse_from_rfc3339("2026-01-01T00:00:00Z")?.with_timezone(&chrono::Utc);
    let arg = PropertyFilterArg {
        definition_id: "00000001-0000-0000-0000-000000000004".into(),
        values: vec![],
        date_range: Some(PropertyDateRange {
            start: Some(start),
            end: Some(end),
        }),
        has_date: Some(true),
    };
    let query = DocumentQueryBuilder::new(vec!["foo".into()])
        .user_id("alice")
        .property_filters(vec![arg.clone()])
        .build_bool_query()?
        .build()
        .to_json();
    let filter = query["bool"]["filter"].as_array().unwrap();
    let range = filter.iter().find(|v| v["bool"].is_object()).unwrap();
    let nested = &range["bool"]["filter"][0]["nested"]["query"]["bool"]["filter"];
    assert_eq!(
        nested[0]["term"]["properties.definition_id"],
        arg.definition_id
    );
    assert_eq!(
        nested[1]["range"]["properties.date_value"]["gte"],
        start.timestamp_millis()
    );
    assert_eq!(
        nested[1]["range"]["properties.date_value"]["lt"],
        end.timestamp_millis()
    );
    assert_eq!(
        range["bool"]["filter"][1]["nested"]["query"]["bool"]["filter"][1]["exists"]["field"],
        "properties.date_value"
    );
    let missing = DocumentQueryBuilder::new(vec!["foo".into()])
        .user_id("alice")
        .property_filters(vec![PropertyFilterArg {
            date_range: None,
            has_date: Some(false),
            ..arg
        }])
        .build_bool_query()?
        .build()
        .to_json();
    let missing_clause = missing["bool"]["filter"]
        .as_array()
        .unwrap()
        .iter()
        .find(|v| v["bool"].is_object())
        .unwrap();
    assert_eq!(
        missing_clause["bool"]["must_not"][0]["nested"]["query"]["bool"]["filter"][1]["exists"]["field"],
        "properties.date_value"
    );
    Ok(())
}

#[test]
fn open_date_ranges_only_emit_supplied_search_bounds() -> anyhow::Result<()> {
    let boundary =
        chrono::DateTime::parse_from_rfc3339("2026-10-21T00:00:00Z")?.with_timezone(&chrono::Utc);
    for (start, end, expected, absent) in [
        (Some(boundary), None, "gte", "lt"),
        (None, Some(boundary), "lt", "gte"),
    ] {
        let query = build_property_filter(&PropertyFilterArg {
            definition_id: "00000001-0000-0000-0000-000000000004".to_owned(),
            values: vec![],
            date_range: Some(PropertyDateRange { start, end }),
            has_date: None,
        })
        .unwrap()
        .to_json();
        let range = &query["bool"]["filter"][0]["nested"]["query"]["bool"]["filter"][1]["range"]["properties.date_value"];
        assert_eq!(range[expected], boundary.timestamp_millis());
        assert!(range.get(absent).is_none());
    }
    Ok(())
}

fn content_terms(terms: &[&str]) -> DocumentQueryBuilder {
    DocumentQueryBuilder::new(terms.iter().map(|term| term.to_string()).collect())
        .match_type("partial")
        .user_id("alice")
}

#[test]
fn inner_hits_return_only_the_chunk_fields_a_hit_carries() -> anyhow::Result<()> {
    let json = content_terms(&["foo", "bar"])
        .build_bool_query()?
        .build()
        .to_json();

    for clause in json["bool"]["must"].as_array().expect("must array") {
        assert_eq!(
            clause["has_child"]["inner_hits"]["_source"],
            serde_json::json!(["node_id", "raw_content"]),
            "inner hits must not ship chunk content: {clause:?}"
        );
    }
    Ok(())
}

#[test]
fn term_clauses_share_one_chunk_budget_per_document() -> anyhow::Result<()> {
    for (terms, expected_size) in [
        (vec!["one"], 10),
        (vec!["one", "two"], 5),
        (vec!["one", "two", "three"], 3),
        (vec!["one", "two", "three", "four", "five"], 2),
        (
            vec!["one", "two", "three", "four", "five", "six", "seven"],
            1,
        ),
        (vec!["term"; 12], 1),
    ] {
        let json = content_terms(&terms).build_bool_query()?.build().to_json();
        let must = json["bool"]["must"].as_array().expect("must array");

        assert_eq!(must.len(), terms.len());
        for clause in must {
            assert_eq!(
                clause["has_child"]["inner_hits"]["size"],
                expected_size,
                "{} terms",
                terms.len()
            );
        }
    }
    Ok(())
}

#[test]
fn inner_hit_groups_expand_in_clause_order() {
    let chunk = |id: &str| {
        serde_json::json!({
            "_id": id,
            "_score": 1.0,
            "_source": { "node_id": id },
            "highlight": { "content": ["<macro_em>match</macro_em>"] },
        })
    };
    let inner_hits = serde_json::json!({
        "term_10": { "hits": { "hits": [chunk("d")] } },
        "term_2": { "hits": { "hits": [chunk("c"), chunk("a")] } },
        "term_0": { "hits": { "hits": [chunk("a")] } },
        "term_1": { "hits": { "hits": [chunk("b")] } },
    });

    let hits = expand_inner_hits_to_search_hits(uuid::Uuid::nil(), None, &inner_hits);

    let node_ids: Vec<String> = hits
        .into_iter()
        .map(|hit| match hit.goto {
            Some(SearchGotoContent::Documents(goto)) => goto.node_id,
            other => panic!("expected a document goto, got {other:?}"),
        })
        .collect();
    assert_eq!(node_ids, ["a", "b", "c", "d"]);
}

#[test]
fn dynamic_matching_keeps_short_queries_a_strict_and() -> anyhow::Result<()> {
    for terms in [vec!["foo"], vec!["foo", "bar"]] {
        let strict = content_terms(&terms).build_bool_query()?.build().to_json();
        let dynamic = content_terms(&terms)
            .term_matching(DocumentTermMatching::Dynamic)
            .build_bool_query()?
            .build()
            .to_json();

        assert_eq!(strict, dynamic);
    }
    Ok(())
}

#[test]
fn dynamic_matching_requires_most_significant_terms_in_one_passage() -> anyhow::Result<()> {
    let json = content_terms(&[
        "This",
        "is",
        "a",
        "quarterly",
        "revenue",
        "forecast",
        "dash",
    ])
    .term_matching(DocumentTermMatching::Dynamic)
    .build_bool_query()?
    .build()
    .to_json();

    let must = json["bool"]["must"].as_array().expect("must array");
    assert_eq!(must.len(), 1, "one passage clause, not one per term");
    let has_child = &must[0]["has_child"];
    assert_eq!(has_child["type"], "chunk");

    // Stopwords are left out; four terms remain, so three must share a chunk.
    // Only the last term, the one still being typed, expands as a prefix.
    let expected_terms = serde_json::json!([
        {"match_phrase": {"content": "quarterly"}},
        {"match_phrase": {"content": "revenue"}},
        {"match_phrase": {"content": "forecast"}},
        {"match_phrase_prefix": {"content": {"query": "dash", "max_expansions": 256}}},
    ]);
    assert_eq!(has_child["query"]["bool"]["should"], expected_terms);
    assert_eq!(has_child["query"]["bool"]["minimum_should_match"], 3);

    let inner_hits = &has_child["inner_hits"];
    assert_eq!(inner_hits["name"], "passage");
    assert_eq!(inner_hits["size"], 10);
    assert_eq!(
        inner_hits["_source"],
        serde_json::json!(["node_id", "raw_content"])
    );
    assert_eq!(
        inner_hits["highlight"]["fields"]["content"]["highlight_query"]["bool"]["should"],
        expected_terms,
        "the highlight tags the terms the passage matched on"
    );
    Ok(())
}

#[test]
fn dynamic_matching_counts_a_repeated_term_once_and_keeps_phrases() -> anyhow::Result<()> {
    let json = content_terms(&["deal review", "Acme", "acme", "notes"])
        .term_matching(DocumentTermMatching::Dynamic)
        .build_bool_query()?
        .build()
        .to_json();

    let passage = &json["bool"]["must"][0]["has_child"]["query"]["bool"];
    assert_eq!(
        passage["should"],
        serde_json::json!([
            {"match_phrase": {"content": "deal review"}},
            {"match_phrase": {"content": "Acme"}},
            {"match_phrase_prefix": {"content": {"query": "notes", "max_expansions": 256}}},
        ])
    );
    assert_eq!(passage["minimum_should_match"], 2);
    Ok(())
}

#[test]
fn dynamic_matching_of_only_stopwords_stays_a_strict_and() -> anyhow::Result<()> {
    let terms = ["to", "be", "or", "not", "to", "be"];
    let strict = content_terms(&terms).build_bool_query()?.build().to_json();
    let dynamic = content_terms(&terms)
        .term_matching(DocumentTermMatching::Dynamic)
        .build_bool_query()?
        .build()
        .to_json();

    assert_eq!(strict, dynamic);
    Ok(())
}

#[test]
fn dynamic_matching_leaves_the_name_branch_a_strict_and() -> anyhow::Result<()> {
    let terms = ["quarterly", "revenue", "forecast"];
    let strict = content_terms(&terms)
        .mode(DocumentSearchMode::NameContent)
        .build_bool_query()?
        .build()
        .to_json();
    let dynamic = content_terms(&terms)
        .mode(DocumentSearchMode::NameContent)
        .term_matching(DocumentTermMatching::Dynamic)
        .build_bool_query()?
        .build()
        .to_json();

    let branches = |json: &serde_json::Value| json["bool"]["must"][0]["bool"]["should"].clone();
    assert_eq!(
        branches(&dynamic)[0]["bool"]["must"]
            .as_array()
            .map(Vec::len),
        Some(1),
        "content branch is the single passage clause"
    );
    assert_eq!(
        branches(&dynamic)[1],
        branches(&strict)[1],
        "name branch is unchanged"
    );
    Ok(())
}

#[test]
fn required_term_count_is_all_up_to_two_then_three_quarters() {
    let required: Vec<usize> = (1..=8).map(required_term_count).collect();
    assert_eq!(required, [1, 2, 2, 3, 3, 4, 5, 6]);
}

#[test]
fn dynamic_matching_keeps_a_last_term_that_may_be_a_word_in_progress() -> anyhow::Result<()> {
    let passage_terms = |terms: &[&str], match_type: &str| -> anyhow::Result<serde_json::Value> {
        let json = content_terms(terms)
            .match_type(match_type)
            .term_matching(DocumentTermMatching::Dynamic)
            .build_bool_query()?
            .build()
            .to_json();
        Ok(json["bool"]["must"][0]["has_child"]["query"]["bool"]["should"].clone())
    };

    // `for` may be the start of `forecast`.
    assert_eq!(
        passage_terms(&["revenue", "q3", "for"], "partial")?,
        serde_json::json!([
            {"match_phrase": {"content": "revenue"}},
            {"match_phrase": {"content": "q3"}},
            {"match_phrase_prefix": {"content": {"query": "for", "max_expansions": 256}}},
        ])
    );
    // An exact search has no word in progress, and neither has a stopword too
    // short to expand.
    assert_eq!(
        passage_terms(&["revenue", "q3", "for"], "exact")?,
        serde_json::json!([
            {"match_phrase": {"content": "revenue"}},
            {"match_phrase": {"content": "q3"}},
        ])
    );
    assert_eq!(
        passage_terms(&["revenue", "q3", "in"], "partial")?,
        serde_json::json!([
            {"match_phrase": {"content": "revenue"}},
            {"match_phrase": {"content": "q3"}},
        ])
    );
    Ok(())
}
