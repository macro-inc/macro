use super::*;
use opensearch_query_builder::ToOpenSearchJson;

#[test]
fn inner_hits_return_only_the_segment_fields_a_hit_carries() -> anyhow::Result<()> {
    let json = CallRecordQueryBuilder::new(vec!["roadmap".to_string(), "budget".to_string()])
        .match_type("partial")
        .user_id("alice")
        .build_bool_query()?
        .build()
        .to_json();

    let must = json["bool"]["must"].as_array().expect("must array");
    assert_eq!(must.len(), 2);
    for clause in must {
        assert_eq!(
            clause["has_child"]["inner_hits"]["_source"],
            serde_json::json!([
                "transcript_id",
                "speaker_id",
                "sequence_num",
                "started_at_millis",
                "ended_at_millis"
            ]),
            "inner hits must not ship segment content: {clause:?}"
        );
    }
    Ok(())
}

#[test]
fn term_clauses_share_one_segment_budget_per_call() -> anyhow::Result<()> {
    for (terms, expected_size) in [
        (vec!["one"], 10),
        (vec!["one", "two"], 5),
        (vec!["one", "two", "three"], 3),
        (
            vec!["one", "two", "three", "four", "five", "six", "seven"],
            1,
        ),
    ] {
        for mode in [
            CallRecordSearchMode::Content,
            CallRecordSearchMode::NameContent,
        ] {
            let json =
                CallRecordQueryBuilder::new(terms.iter().map(|term| term.to_string()).collect())
                    .match_type("partial")
                    .user_id("alice")
                    .mode(mode)
                    .build_bool_query()?
                    .build()
                    .to_json();
            let clauses = match mode {
                CallRecordSearchMode::NameContent => {
                    &json["bool"]["must"][0]["bool"]["should"][0]["bool"]["must"]
                }
                CallRecordSearchMode::Content | CallRecordSearchMode::Name => &json["bool"]["must"],
            };
            let clauses = clauses.as_array().expect("content clauses");

            assert_eq!(clauses.len(), terms.len());
            for clause in clauses {
                assert_eq!(
                    clause["has_child"]["inner_hits"]["size"],
                    expected_size,
                    "{} terms, {mode:?}",
                    terms.len()
                );
            }
        }
    }
    Ok(())
}

#[test]
fn only_the_first_ten_term_clauses_carry_inner_hits() -> anyhow::Result<()> {
    let terms = [
        "one", "two", "three", "four", "five", "six", "seven", "eight", "nine", "ten", "eleven",
        "twelve",
    ];
    let json = CallRecordQueryBuilder::new(terms.map(String::from).to_vec())
        .match_type("partial")
        .user_id("alice")
        .speaker_ids(vec!["speaker".to_string()])
        .build_bool_query()?
        .build()
        .to_json();
    let must = json["bool"]["must"].as_array().expect("must array");

    assert_eq!(must.len(), 12, "every term still has to match");
    let inner_hit_sizes: Vec<Option<u64>> = must
        .iter()
        .map(|clause| clause["has_child"]["inner_hits"]["size"].as_u64())
        .collect();
    let mut expected = vec![Some(1); 10];
    expected.extend([None, None]);
    assert_eq!(inner_hit_sizes, expected);
    assert!(
        must[11]["has_child"]["query"]["bool"]["must"].is_array(),
        "a clause past the budget keeps its term and speaker query: {:?}",
        must[11]
    );
    Ok(())
}
