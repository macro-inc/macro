use super::*;

const STANDARD: &str = include_str!("../../../../tests/fixtures/standard-export.json");
const CORPORATE: &str = include_str!("../../../../tests/fixtures/corporate-export.json");
const ENTERPRISE: &str = include_str!("../../../../tests/fixtures/enterprise-export.json");
const EVENTS: &str = include_str!("../../../../tests/fixtures/message-events.ndjson");

#[test]
fn root_files_preserve_full_metadata_and_kind() {
    for (fixture, filename, kind, count) in [
        (
            STANDARD,
            "channels.json",
            ConversationKind::PublicChannel,
            2,
        ),
        (
            CORPORATE,
            "groups.json",
            ConversationKind::PrivateChannel,
            1,
        ),
        (CORPORATE, "dms.json", ConversationKind::DirectMessage, 3),
        (
            CORPORATE,
            "mpims.json",
            ConversationKind::GroupDirectMessage,
            1,
        ),
        (
            ENTERPRISE,
            "channels.json",
            ConversationKind::PublicChannel,
            1,
        ),
    ] {
        let root: serde_json::Value = serde_json::from_str(fixture).unwrap();
        let records: Vec<ExportConversation> =
            serde_json::from_value(root[filename].clone()).unwrap();
        assert_eq!(records.len(), count);
        for record in records {
            let folder = record.name.clone().unwrap_or_else(|| record.id.to_string());
            let metadata = record
                .clone()
                .into_metadata(filename.parse().unwrap(), folder.parse().unwrap());
            assert_eq!(metadata.kind, kind);
            assert_eq!(metadata.member_ids, record.members);
            assert_eq!(metadata.creator_id, record.creator);
            assert_eq!(metadata.created_at, record.created);
            assert_eq!(metadata.archived, record.is_archived);
            assert_eq!(metadata.message_count, None);
            assert_eq!(metadata.folder.as_str(), folder);
        }
    }
    assert!("other.json".parse::<ConversationFile>().is_err());
}

#[test]
fn creation_time_is_exact_and_missing_is_not_replaced_with_now() {
    for (created, expected) in [
        ("1700000000", Some("1700000000.000000")),
        ("\"1700000000\"", Some("1700000000.000000")),
        ("\"1700000000.000001\"", Some("1700000000.000001")),
        ("null", None),
    ] {
        let json = format!(r#"{{"id":"D100","created":{created}}}"#);
        let conversation: ExportConversation = serde_json::from_str(&json).unwrap();
        assert_eq!(conversation.created, expected.map(|s| s.parse().unwrap()));
    }
    let missing: ExportConversation = serde_json::from_str(r#"{"id":"D100"}"#).unwrap();
    assert_eq!(missing.created, None);
    let metadata = missing.into_metadata(ConversationFile::DirectMessages, "D100".parse().unwrap());
    assert_eq!(metadata.name, "D100");
    assert_eq!(metadata.created_at, None);
}

#[test]
fn malformed_or_floating_creation_times_fail() {
    for created in ["-1", "1.5", "253402300800", "\"invalid\"", "\"1.0000001\""] {
        let json = format!(r#"{{"id":"C100","created":{created}}}"#);
        assert!(serde_json::from_str::<ExportConversation>(&json).is_err());
    }
}

fn events() -> Vec<NormalizedRecord> {
    EVENTS
        .lines()
        .map(|line| {
            serde_json::from_str::<ExportRecord>(line)
                .unwrap()
                .normalize("C100".parse().unwrap())
                .unwrap()
        })
        .collect()
}

#[test]
fn edit_wrapper_uses_current_snapshot_and_original_identity() {
    let records = events();
    let NormalizedRecord::Message(original) = &records[2] else {
        panic!()
    };
    let NormalizedRecord::Message(edited) = &records[3] else {
        panic!()
    };
    assert_eq!(edited.identity, original.identity);
    assert_eq!(edited.thread_ts, original.thread_ts);
    assert_eq!(edited.identity.ts.to_string(), "1700086400.000003");
    assert_eq!(edited.content.text, "Edited next-day reply");
    assert_eq!(edited.content.user, original.content.user);
}

#[test]
fn unknown_subtypes_survive_and_attachment_bytes_do_not() {
    let records = events();
    let NormalizedRecord::Message(root) = &records[0] else {
        panic!()
    };
    let NormalizedRecord::Message(next) = &records[1] else {
        panic!()
    };
    assert_eq!(
        next.content.subtype.as_deref(),
        Some("future_slack_subtype")
    );
    assert_eq!(
        next.identity.ts.unix_micros() - root.identity.ts.unix_micros(),
        1
    );
    let serialized = serde_json::to_value(&root.content).unwrap();
    for discarded in ["files", "attachments", "blocks", "replies"] {
        assert!(serialized.get(discarded).is_none());
    }
}

#[test]
fn deletions_tombstones_and_non_messages_are_explicit_skips() {
    let records = events();
    assert_eq!(
        records[4],
        NormalizedRecord::Skipped(SkippedRecord::Deleted)
    );
    assert_eq!(
        records[5],
        NormalizedRecord::Skipped(SkippedRecord::Tombstone)
    );
    assert_eq!(
        records[10],
        NormalizedRecord::Skipped(SkippedRecord::NonMessage)
    );
    // A deletion record does not erase a previously parsed root.
    assert!(matches!(records[0], NormalizedRecord::Message(_)));
}

#[test]
fn missing_message_or_timestamp_fails_instead_of_using_event_time() {
    for json in [
        r#"{"type":"message","text":"missing time"}"#,
        r#"{"type":"message","subtype":"message_changed","ts":"1.000001"}"#,
        r#"{"type":"message","subtype":"message_changed","ts":"1.000001","message":{"text":"missing inner time"}}"#,
    ] {
        let record: ExportRecord = serde_json::from_str(json).unwrap();
        assert_eq!(
            record.normalize("C100".parse().unwrap()),
            Err(ValidationError::InvalidTimestamp)
        );
    }
    for ts in ["1.000001", "\"1.0000001\"", "\"NaN\""] {
        let json = format!(r#"{{"type":"message","ts":{ts}}}"#);
        assert!(serde_json::from_str::<ExportRecord>(&json).is_err());
    }
}

#[test]
fn reactions_ignore_advisory_counts_and_keep_actor_ids() {
    let content: MessageContent = serde_json::from_str(
        r#"{"reactions":[{"name":"thumbsup","count":999,"users":["U100","W100"]}]}"#,
    )
    .unwrap();
    assert_eq!(content.reactions[0].name, "thumbsup");
    assert_eq!(content.reactions[0].users.len(), 2);
}
