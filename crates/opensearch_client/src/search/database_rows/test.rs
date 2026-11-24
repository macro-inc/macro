use super::*;

fn args() -> DatabaseRowSearchArgs {
    DatabaseRowSearchArgs {
        database_ids: vec![Uuid::from_u128(1), Uuid::from_u128(2)],
        terms: vec!["acme".to_string(), "renewal call".to_string()],
        match_type: DatabaseRowMatchType::Partial,
        after: None,
        limit: 25,
    }
}

#[test]
fn narrows_to_the_given_databases_and_matches_every_term_in_title_or_cells() {
    let request = build_request(&args()).expect("request").to_json();

    let query = &request["query"]["bool"];
    assert_eq!(
        query["filter"],
        serde_json::json!([{ "terms": { "database_id": [
            "00000000-0000-0000-0000-000000000001",
            "00000000-0000-0000-0000-000000000002",
        ] } }])
    );
    let terms = query["must"][0]["bool"]["must"]
        .as_array()
        .expect("one clause per term");
    assert_eq!(terms.len(), 2);
    for term in terms {
        let fields: Vec<&str> = term["bool"]["should"]
            .as_array()
            .expect("title or cells")
            .iter()
            .filter_map(|clause| clause.as_object()?.values().next()?.as_object())
            .flat_map(|field| field.keys().map(String::as_str))
            .collect();
        assert_eq!(fields, vec!["title", "cell_text"]);
    }
}

#[test]
fn reads_positions_only_and_never_counts_matches() {
    let request = build_request(&args()).expect("request").to_json();

    assert_eq!(request["size"], 25);
    assert_eq!(request["track_total_hits"], false);
    assert_eq!(
        request["_source"],
        serde_json::json!(["row_id", "updated_at"])
    );
    assert_eq!(
        request["sort"],
        serde_json::json!([{ "updated_at": "desc" }, { "row_id": "asc" }])
    );
    assert!(request.get("aggs").is_none());
    assert!(request.get("highlight").is_none());
    assert!(request.get("search_after").is_none());
}

#[test]
fn resumes_after_a_position() {
    let after = DatabaseRowPosition {
        updated_at: DateTime::from_timestamp_millis(1_763_000_000_000).expect("time"),
        row_id: Uuid::from_u128(9),
    };
    let request = build_request(&DatabaseRowSearchArgs {
        after: Some(after),
        ..args()
    })
    .expect("request")
    .to_json();

    assert_eq!(
        request["search_after"],
        serde_json::json!([
            1_763_000_000_000_i64,
            "00000000-0000-0000-0000-000000000009"
        ])
    );
}

#[test]
fn exact_matches_phrases() {
    let request = build_request(&DatabaseRowSearchArgs {
        match_type: DatabaseRowMatchType::Exact,
        ..args()
    })
    .expect("request")
    .to_json();

    let clause = &request["query"]["bool"]["must"][0]["bool"]["must"][0]["bool"]["should"][0];
    assert!(clause.get("match_phrase").is_some());
}

#[test]
fn a_refused_search_keeps_its_status_and_type_but_never_its_reason() {
    let body = br#"{"error":{"type":"search_phase_execution_exception","reason":"failed to create query: secret plan"},"status":400}"#;

    let error = refused(400, body);

    let shown = error.to_string();
    assert!(shown.contains("400"));
    assert!(shown.contains("search_phase_execution_exception"));
    assert!(!shown.contains("secret plan"));
    assert!(!format!("{error:?}").contains("secret plan"));
}

#[test]
fn an_unreadable_error_body_keeps_only_the_status() {
    let error = refused(500, b"upstream said: secret plan");

    assert!(!error.to_string().contains("secret plan"));
}

#[test]
fn a_shard_failure_fails_the_page_with_counts_and_types_only() {
    let body = br#"{
        "took": 3,
        "_shards": {"total": 2, "successful": 1, "skipped": 0, "failed": 1,
            "failures": [{"shard": 0, "index": "database_rows_v1",
                "reason": {"type": "query_shard_exception", "reason": "failed to create query: secret plan"}}]},
        "hits": {"hits": [{"_source": {"row_id": "00000000-0000-0000-0000-000000000001", "updated_at": 1763000000000}}]}
    }"#;

    let error = rows_of(body).expect_err("a short page must not read as the end");

    assert!(matches!(
        &error,
        OpensearchClientError::ShardsFailed { failed: 1, total: 2, failure_types, .. }
            if failure_types == &vec!["query_shard_exception".to_string()]
    ));
    assert!(!error.to_string().contains("secret plan"));
    assert!(!format!("{error:?}").contains("secret plan"));
}

#[test]
fn reads_rows_without_a_total() {
    let body = br#"{
        "took": 3,
        "_shards": {"total": 1, "successful": 1, "skipped": 0, "failed": 0},
        "hits": {"hits": [{"_source": {"row_id": "00000000-0000-0000-0000-000000000001", "updated_at": 1763000000000}}]}
    }"#;

    let (rows, took) = rows_of(body).expect("rows");

    assert_eq!(took, 3);
    assert_eq!(
        rows,
        vec![DatabaseRowPosition {
            updated_at: DateTime::from_timestamp_millis(1_763_000_000_000).expect("time"),
            row_id: Uuid::from_u128(1),
        }]
    );
}
