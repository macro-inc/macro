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

#[test]
fn soup_entity_recency_prefers_viewed_at_over_newer_activity() {
    for typename in [
        "GraphqlSoupDocument",
        "GraphqlSoupChat",
        "GraphqlSoupProject",
        "GraphqlSoupChannel",
        "GraphqlSoupCrmCompany",
    ] {
        let mut record = string_record(&[
            ("__typename", typename),
            ("name", "Viewed entity"),
            ("viewedAt", "2025-01-01T00:00:00Z"),
            ("updatedAt", "2025-01-03T00:00:00Z"),
            ("interactedAt", "2025-01-04T00:00:00Z"),
            ("createdAt", "2024-12-01T00:00:00Z"),
        ]);
        let key = EntityKey::entity(typename, &["entity"]);
        assert_eq!(
            project_search_documents(&key, &record)[0].timestamp_ms,
            parse_rfc3339_millis("2025-01-01T00:00:00Z").unwrap(),
            "{typename} must retain viewed-first ordering"
        );
        record.fields.insert("viewedAt".into(), CacheValue::Null);
        assert_eq!(
            project_search_documents(&key, &record)[0].timestamp_ms,
            parse_rfc3339_millis("2025-01-03T00:00:00Z").unwrap()
        );
        record.fields.remove("updatedAt");
        assert_eq!(
            project_search_documents(&key, &record)[0].timestamp_ms,
            parse_rfc3339_millis("2024-12-01T00:00:00Z").unwrap()
        );
    }
}

#[test]
fn crm_contact_projection_indexes_name_email_and_removes_hidden_records() {
    let mut record = string_record(&[
        ("__typename", "GraphqlSoupCrmContact"),
        ("name", "Pat Example"),
        ("email", "pat@example.com"),
        ("lastInteraction", "2025-01-02T03:04:05.123Z"),
        ("createdAt", "2026-01-02T03:04:05.123Z"),
        ("updatedAt", "2026-01-03T03:04:05.123Z"),
        ("viewedAt", "2026-01-04T03:04:05.123Z"),
    ]);
    let key = EntityKey::entity("GraphqlSoupCrmContact", &["c1"]);
    let documents = project_search_documents(&key, &record);
    assert_eq!(documents[0].bucket, "crm_contact");
    assert!(documents[0].search_text.contains("pat@example.com"));
    assert_eq!(documents[0].timestamp_ms, 1_735_787_045_123);
    assert!(
        SearchProfile::QuickAccessV1
            .buckets()
            .contains(&"crm_contact")
    );
    record
        .fields
        .insert("hidden".into(), CacheValue::Bool(true));
    assert!(project_search_documents(&key, &record).is_empty());
}

#[test]
fn email_projection_matches_subject_and_all_senders_but_never_bodies() {
    let key = EntityKey::entity("GraphqlSoupEmailThread", &["thread"]);
    let mut record = string_record(&[
        ("__typename", "GraphqlSoupEmailThread"),
        ("name", "Weekly update"),
        ("senderName", "Alex"),
        ("senderEmail", "alex@example.com"),
        ("snippet", "quartz"),
        ("bodyText", "zebra"),
    ]);
    record.fields.insert(
        "senders".into(),
        CacheValue::List(vec![
            CacheValue::Object(
                string_record(&[("name", "Teo Earlier"), ("email", "teo@sender.test")]).fields,
            ),
            CacheValue::Object(
                string_record(&[("name", "Alex"), ("email", "alex@example.com")]).fields,
            ),
        ]),
    );
    let documents = project_search_documents(&key, &record);
    assert_eq!(documents.len(), 1);
    assert!(documents[0].search_text.contains("teo earlier"));
    assert!(documents[0].search_text.contains("teo@sender.test"));
    assert!(!documents[0].search_text.contains("quartz"));
    assert!(!documents[0].search_text.contains("zebra"));
    for query in ["t", "te", "teo", "teo@sender.test", "weekly"] {
        let page = rank_documents(
            &SearchRequest {
                profile: SearchProfile::QuickAccessV1,
                buckets: vec!["email".into()],
                query: query.into(),
                cursor: None,
                limit: 50,
                now_ms: 0,
            },
            &documents,
        );
        assert_eq!(page.documents.len(), 1, "{query}");
    }
    record.fields.insert("name".into(), CacheValue::Null);
    assert!(
        project_search_documents(&key, &record)[0]
            .search_text
            .contains("teo")
    );
    record
        .fields
        .insert("hidden".into(), CacheValue::Bool(true));
    assert!(project_search_documents(&key, &record).is_empty());
    record.fields.remove("hidden");
    record.fields.insert(
        "deletedAt".into(),
        CacheValue::String("2026-01-01T00:00:00Z".into()),
    );
    assert!(project_search_documents(&key, &record).is_empty());
}
