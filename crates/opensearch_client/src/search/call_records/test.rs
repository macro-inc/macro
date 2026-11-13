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
