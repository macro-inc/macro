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
