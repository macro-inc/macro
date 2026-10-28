use super::*;
use crate::domain::test_support::{at, uuid};

#[test]
fn item_ids_round_trip() {
    let key =
        WorkFeedItemKey::new(EntityType::ChannelMessage.with_entity_string(uuid(7).to_string()));
    let id = key.id();
    assert_eq!(id, format!("channel_message:{}", uuid(7)));
    assert_eq!(WorkFeedItemKey::parse(&id).unwrap(), key);
}

#[test]
fn malformed_item_ids_are_rejected() {
    for id in ["", "document", "document:", "not_a_type:abc"] {
        assert!(WorkFeedItemKey::parse(id).is_err(), "{id} parsed");
    }
}

#[test]
fn tokens_round_trip() {
    let revision = WorkFeedRevision {
        attention_through: Some(at(5)),
    };
    assert_eq!(
        WorkFeedRevision::decode(&revision.encode()).unwrap(),
        revision
    );

    let position = WorkFeedPosition {
        sort_at: at(9),
        entity_id: uuid(3).to_string(),
    };
    assert_eq!(
        WorkFeedPosition::decode(&position.encode()).unwrap(),
        position
    );

    let receipt = WorkFeedDoneReceipt {
        items: vec![format!("document:{}", uuid(1))],
        notification_ids: vec![uuid(2)],
        archived_threads: vec![uuid(3)],
    };
    assert_eq!(
        WorkFeedDoneReceipt::decode(&receipt.encode()).unwrap(),
        receipt
    );
}

#[test]
fn garbage_tokens_are_rejected() {
    assert!(WorkFeedRevision::decode("not base64!").is_err());
    assert!(WorkFeedPosition::decode("e30").is_err());
    assert!(WorkFeedDoneReceipt::decode("").is_err());
}
