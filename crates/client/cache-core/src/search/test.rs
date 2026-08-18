use super::*;

fn string_record(fields: &[(&str, &str)]) -> Record {
    Record {
        fields: fields
            .iter()
            .map(|(key, value)| ((*key).into(), CacheValue::String((*value).into())))
            .collect(),
    }
}

#[test]
fn projects_quick_access_document_without_decoding_other_records() {
    let mut record = string_record(&[
        ("__typename", "GraphqlSoupDocument"),
        ("documentName", "  Quarterly   Plan "),
        ("fileType", "md"),
        ("updatedAt", "2025-01-02T03:04:05.123Z"),
    ]);
    record.fields.insert("subType".into(), CacheValue::Null);
    let document =
        project_search_documents(&EntityKey::entity("GraphqlSoupDocument", &["d1"]), &record)
            .pop()
            .unwrap();
    assert_eq!(document.bucket, "note");
    assert_eq!(document.search_text, "quarterly plan");
    assert_eq!(document.timestamp_ms, 1_735_787_045_123);
    assert_eq!(document.source_hash.len(), 16);
}

#[test]
fn projection_removes_deleted_and_handles_subtype_refs() {
    let mut record = string_record(&[
        ("__typename", "GraphqlSoupDocument"),
        ("documentName", "Todo"),
    ]);
    record.fields.insert(
        "subType".into(),
        CacheValue::Ref(EntityKey::entity("GraphqlTaskSubType", &["d1"])),
    );
    assert_eq!(
        project_search_documents(&EntityKey::entity("GraphqlSoupDocument", &["d1"]), &record)[0]
            .bucket,
        "task"
    );
    record.fields.insert(
        "deletedAt".into(),
        CacheValue::String("2025-01-01T00:00:00Z".into()),
    );
    assert!(
        project_search_documents(&EntityKey::entity("GraphqlSoupDocument", &["d1"]), &record)
            .is_empty()
    );
}

#[test]
fn rfc3339_timestamps_use_validated_dates_offsets_and_fractional_seconds() {
    assert_eq!(
        parse_rfc3339_millis("2025-01-02T05:34:05.123456+02:30"),
        Some(1_735_787_045_123)
    );
    assert_eq!(parse_rfc3339_millis("2025-02-30T00:00:00Z"), None);
    assert_eq!(parse_rfc3339_millis("not-a-timestamp"), None);
}

#[test]
fn subsequence_scoring_measures_spans_in_characters() {
    assert_eq!(subsequence_score("aéxb", "ab"), Some(0.5));
}

#[test]
fn fuzzy_matching_rewards_prefix_and_freshness() {
    let recent = SearchDocument {
        profile: SearchProfile::QuickAccessV1,
        record_key: EntityKey::entity("GraphqlSoupDocument", &["1"]),
        bucket: "document".into(),
        search_text: "quarterly plan".into(),
        timestamp_ms: 990,
        source_hash: "a".into(),
    };
    assert!(fuzzy_freshness_score(&recent, "qtr plan", 1_000).is_some());
    assert!(fuzzy_freshness_score(&recent, "missing", 1_000).is_none());
}
