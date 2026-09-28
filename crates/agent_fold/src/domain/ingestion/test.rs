use super::*;
use crate::testing::parse_log;

fn row() -> AgentSessionLog {
    parse_log(r#"{"direction":"to_server","content":{"type":"acp","jsonrpc":"2.0","method":"session/update","params":{"sessionId":"runtime","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"same"}}}}}"#).remove(0)
}

fn cursor(id: u128, timestamp: &str) -> LogCursor {
    LogCursor {
        id: Uuid::from_u128(id),
        created_at: timestamp.parse().unwrap(),
    }
}

#[test]
fn snapshot_overlap_is_row_identity_not_protocol_content() {
    let a = cursor(2, "2026-08-13T00:00:00.000002Z");
    let b = cursor(3, "2026-08-13T00:00:00.000003Z");
    let mut ingestion = LogIngestion::default();
    ingestion.replace_snapshot(vec![(a, row()), (b, row())]);
    for duplicate in [b, a, b] {
        assert!(ingestion.push(duplicate, row()).is_empty());
    }
    assert!(
        ingestion
            .push(cursor(9, "2026-08-13T00:00:00.000001Z"), row())
            .is_empty()
    );
    assert!(
        !ingestion
            .push(cursor(1, "2026-08-13T00:00:00.000004Z"), row())
            .is_empty()
    );
    // A distinct late row remains valid even behind the latest delivery.
    assert!(
        !ingestion
            .push(cursor(4, "2026-08-13T00:00:00.000003Z"), row())
            .is_empty()
    );
    assert_eq!(ingestion.snapshot_ids.len(), 2);
}

#[test]
fn equal_timestamps_use_uuid_order_and_variable_precision_is_equal() {
    let boundary = cursor(2, "2026-08-13T00:00:00Z");
    let mut ingestion = LogIngestion::default();
    ingestion.replace_snapshot(vec![(boundary, row())]);
    assert!(
        ingestion
            .push(cursor(1, "2026-08-13T00:00:00.000000Z"), row())
            .is_empty()
    );
    assert!(
        !ingestion
            .push(cursor(3, "2026-08-13T00:00:00.000000Z"), row())
            .is_empty()
    );
    ingestion.replace_snapshot(Vec::new());
    assert!(ingestion.machine.messages().is_empty());
    assert!(ingestion.snapshot_ids.is_empty());
    assert!(!ingestion.push(boundary, row()).is_empty());
}
