use super::*;
use crate::test_support::{at, doc_comment, uuid};

#[test]
fn key_ids_round_trip() {
    let key = FeedKey::new(EntityType::ChannelMessage.with_entity_string(uuid(7).to_string()));
    let id = key.id();
    assert_eq!(id, format!("channel_message:{}", uuid(7)));
    assert_eq!(FeedKey::parse(&id).unwrap(), key);
}

#[test]
fn malformed_key_ids_are_rejected() {
    for id in ["", "document", "document:", "not_a_type:abc"] {
        assert!(FeedKey::parse(id).is_err(), "{id} parsed");
    }
}

#[test]
fn tokens_round_trip() {
    let revision = FeedRevision {
        attention_through: Some(at(5)),
    };
    assert_eq!(FeedRevision::decode(&revision.encode()).unwrap(), revision);

    let position = FeedPosition {
        sort_at: at(9),
        entity_id: uuid(3).to_string(),
    };
    assert_eq!(FeedPosition::decode(&position.encode()).unwrap(), position);

    let receipt = DoneReceipt {
        keys: vec![format!("document:{}", uuid(1))],
        notification_ids: vec![uuid(2)],
        archived_threads: vec![uuid(3)],
    };
    assert_eq!(DoneReceipt::decode(&receipt.encode()).unwrap(), receipt);
    assert_eq!(
        receipt.feed_keys(),
        vec![FeedKey::new(
            EntityType::Document.with_entity_string(uuid(1).to_string())
        )]
    );
}

#[test]
fn tokens_keep_the_work_feed_wire_format() {
    // Clients hold revisions, cursors and undo tokens across deploys.
    assert_eq!(
        serde_json::to_value(FeedRevision {
            attention_through: Some(at(5)),
        })
        .unwrap(),
        serde_json::json!({ "a": "2024-06-01T10:05:00Z" })
    );
    assert_eq!(
        serde_json::to_value(DoneReceipt {
            keys: vec!["document:d".to_string()],
            notification_ids: Vec::new(),
            archived_threads: Vec::new(),
        })
        .unwrap(),
        serde_json::json!({ "k": ["document:d"], "n": [], "e": [] })
    );
}

#[test]
fn garbage_tokens_are_rejected() {
    assert!(FeedRevision::decode("not base64!").is_err());
    assert!(FeedPosition::decode("e30").is_err());
    assert!(DoneReceipt::decode("").is_err());
}

#[test]
fn a_revision_acknowledges_what_it_covers() {
    let older = doc_comment(1, 0xD0, 0xA0, 0xA0, 5);
    let newer = doc_comment(2, 0xD0, 0xB0, 0xB0, 8);
    let notifications = [newer.clone(), older.clone()];
    let revision = FeedRevision::covering(&notifications);
    assert_eq!(revision.attention_through, Some(at(8)));
    assert_eq!(
        revision.acknowledged(&notifications),
        vec![uuid(2), uuid(1)]
    );

    let observed = FeedRevision {
        attention_through: Some(at(6)),
    };
    assert_eq!(observed.acknowledged(&notifications), vec![uuid(1)]);
    assert!(
        FeedRevision::default()
            .acknowledged(&notifications)
            .is_empty()
    );
}
