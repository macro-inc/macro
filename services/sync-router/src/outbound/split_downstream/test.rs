use super::*;
use crate::domain::models::{ConnId, GatewayId};
use crate::domain::ports::MockDownstreamFactory;

fn connection() -> ConnectionId {
    ConnectionId {
        gateway: GatewayId("gw-1".to_string()),
        conn: ConnId("conn-1".to_string()),
    }
}

fn expecting_open(times: usize) -> MockDownstreamFactory {
    let mut factory = MockDownstreamFactory::new();
    factory
        .expect_open()
        .times(times)
        .returning(|_, _, _, _| mpsc::channel(1).0);
    factory
}

#[test]
fn parses_modes() {
    assert_eq!(SyncNativeMode::parse("off").unwrap(), SyncNativeMode::Off);
    assert_eq!(SyncNativeMode::parse("all").unwrap(), SyncNativeMode::All);
    assert_eq!(
        SyncNativeMode::parse("prefix:test-").unwrap(),
        SyncNativeMode::Prefix("test-".to_string())
    );
    assert!(SyncNativeMode::parse("prefix:").is_err());
    assert!(SyncNativeMode::parse("sometimes").is_err());
}

#[test]
fn off_routes_to_durable() {
    let split =
        SplitDownstreamFactory::new(SyncNativeMode::Off, expecting_open(1), expecting_open(0));
    split.open(connection(), DocId("doc-1".into()), "t".into(), 1);
}

#[test]
fn all_routes_to_native() {
    let split =
        SplitDownstreamFactory::new(SyncNativeMode::All, expecting_open(0), expecting_open(1));
    split.open(connection(), DocId("doc-1".into()), "t".into(), 1);
}

#[test]
fn prefix_splits_by_document_id() {
    let split = SplitDownstreamFactory::new(
        SyncNativeMode::Prefix("native-".to_string()),
        expecting_open(1),
        expecting_open(1),
    );
    split.open(connection(), DocId("native-doc".into()), "t".into(), 1);
    split.open(connection(), DocId("doc-2".into()), "t".into(), 2);
}
