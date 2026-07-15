use super::*;
use std::collections::BTreeMap;

fn entity(typename: &str) -> Record {
    Record {
        fields: [("__typename".into(), CacheValue::String(typename.into()))]
            .into_iter()
            .collect(),
    }
}

fn key(typename: &str) -> EntityKey {
    EntityKey::entity(typename, &["entity-1"])
}

fn set_string(record: &mut Record, field: &str, value: &str) {
    record
        .fields
        .insert(field.into(), CacheValue::String(value.into()));
}

fn metadata(record: &Record) -> Option<RecordIndexMetadata> {
    record_index_metadata(&key(record.typename().unwrap_or("Unknown")), record)
}

fn document_with_subtype(kind: Option<&str>) -> Record {
    let mut record = entity("GraphqlSoupDocument");
    if let Some(kind) = kind {
        let fields: BTreeMap<_, _> = [
            (
                "__typename".into(),
                CacheValue::String("GraphqlSoupDocumentSubType".into()),
            ),
            ("kind".into(), CacheValue::String(kind.into())),
        ]
        .into_iter()
        .collect();
        record
            .fields
            .insert("subType".into(), CacheValue::Object(fields));
    }
    record
}

#[test]
fn documents_distinguish_notes_tasks_and_snippets() {
    let document = document_with_subtype(None);
    assert_eq!(metadata(&document).unwrap().bucket, EntityBucket::Document);

    let mut note = document_with_subtype(None);
    set_string(&mut note, "fileType", "md");
    assert_eq!(metadata(&note).unwrap().bucket, EntityBucket::Note);

    let mut task = document_with_subtype(Some("task"));
    set_string(&mut task, "fileType", "md");
    assert_eq!(metadata(&task).unwrap().bucket, EntityBucket::Task);

    let mut snippet = document_with_subtype(Some("snippet"));
    set_string(&mut snippet, "fileType", "md");
    assert_eq!(metadata(&snippet).unwrap().bucket, EntityBucket::Snippet);
}

#[test]
fn maps_supported_entity_types_and_channel_kinds() {
    for (typename, expected) in [
        ("GraphqlSoupChat", EntityBucket::Chat),
        ("GraphqlSoupProject", EntityBucket::Project),
        ("GraphqlSoupEmailThread", EntityBucket::Email),
        ("GraphqlSoupCrmCompany", EntityBucket::CrmCompany),
    ] {
        assert_eq!(metadata(&entity(typename)).unwrap().bucket, expected);
    }

    let channel = entity("GraphqlSoupChannel");
    assert_eq!(metadata(&channel).unwrap().bucket, EntityBucket::Channel);

    let mut dm = entity("GraphqlSoupChannel");
    set_string(&mut dm, "channelType", "direct_message");
    assert_eq!(metadata(&dm).unwrap().bucket, EntityBucket::Dm);
}

#[test]
fn skips_root_unsupported_and_deleted_records() {
    assert_eq!(
        record_index_metadata(&EntityKey::root(), &entity("GraphqlSoupDocument")),
        None
    );
    assert_eq!(metadata(&entity("GraphqlSoupCall")), None);
    assert_eq!(metadata(&entity("GraphqlSoupPerson")), None);

    let mut deleted = entity("GraphqlSoupDocument");
    set_string(&mut deleted, "deletedAt", "2025-01-01T00:00:00Z");
    assert_eq!(metadata(&deleted), None);
}

#[test]
fn uses_entity_specific_timestamp_precedence() {
    let mut email = entity("GraphqlSoupEmailThread");
    set_string(&mut email, "createdAt", "2024-01-01T00:00:00Z");
    set_string(&mut email, "updatedAt", "2024-02-01T00:00:00Z");
    set_string(&mut email, "sortTs", "2024-03-01T00:00:00Z");
    set_string(&mut email, "viewedAt", "2024-04-01T00:00:00Z");
    assert_eq!(
        metadata(&email).unwrap().sort_timestamp,
        DateTime::parse_from_rfc3339("2024-04-01T00:00:00Z")
            .unwrap()
            .timestamp_millis()
    );

    email.fields.insert("viewedAt".into(), CacheValue::Null);
    assert_eq!(
        metadata(&email).unwrap().sort_timestamp,
        DateTime::parse_from_rfc3339("2024-03-01T00:00:00Z")
            .unwrap()
            .timestamp_millis()
    );

    let mut channel = entity("GraphqlSoupChannel");
    set_string(&mut channel, "createdAt", "2024-01-01T00:00:00Z");
    set_string(&mut channel, "updatedAt", "2024-02-01T00:00:00Z");
    set_string(&mut channel, "interactedAt", "2024-03-01T00:00:00Z");
    assert_eq!(
        metadata(&channel).unwrap().sort_timestamp,
        DateTime::parse_from_rfc3339("2024-03-01T00:00:00Z")
            .unwrap()
            .timestamp_millis()
    );
}

#[test]
fn bucket_strings_round_trip_and_query_limits_are_bounded() {
    for bucket in [
        EntityBucket::Document,
        EntityBucket::Note,
        EntityBucket::Task,
        EntityBucket::Snippet,
        EntityBucket::Chat,
        EntityBucket::Project,
        EntityBucket::Email,
        EntityBucket::Channel,
        EntityBucket::Dm,
        EntityBucket::CrmCompany,
    ] {
        assert_eq!(bucket.as_str().parse::<EntityBucket>().unwrap(), bucket);
    }

    let query = EntityIndexQuery {
        buckets: Vec::new(),
        cursor: None,
        limit: usize::MAX,
    };
    assert_eq!(query.bounded_limit(), MAX_ENTITY_INDEX_PAGE_SIZE);
    assert_eq!(
        query.bounded_storage_limit(),
        MAX_ENTITY_INDEX_PAGE_SIZE + 1
    );

    let cursor = EntityIndexCursor {
        sort_timestamp: 123,
        entity_key: EntityKey("GraphqlSoupDocument:doc-1".into()),
    };
    let encoded = serde_json::to_value(&cursor).unwrap();
    assert!(encoded.is_string());
    assert_eq!(
        serde_json::from_value::<EntityIndexCursor>(encoded).unwrap(),
        cursor
    );
}

#[test]
fn invalid_or_missing_timestamps_sort_at_epoch() {
    let mut record = entity("GraphqlSoupDocument");
    set_string(&mut record, "viewedAt", "not-a-date");
    assert_eq!(metadata(&record).unwrap().sort_timestamp, 0);
}
