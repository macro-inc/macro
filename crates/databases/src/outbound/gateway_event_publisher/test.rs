use chrono::TimeZone;
use models_databases::{ColumnId, RowId};
use uuid::Uuid;

use super::*;

#[test]
fn a_table_change_serializes_in_camel_case() {
    let payload = TableChanged {
        database_id: DatabaseId::from_uuid(Uuid::from_u128(1)),
        table_id: TableId::from_uuid(Uuid::from_u128(2)),
        version: TableVersion(7),
    };
    assert_eq!(
        serde_json::to_value(payload).unwrap(),
        serde_json::json!({
            "databaseId": "00000000-0000-0000-0000-000000000001",
            "tableId": "00000000-0000-0000-0000-000000000002",
            "version": 7,
        })
    );
}

#[test]
fn an_awareness_relay_serializes_its_relay_time_as_epoch_milliseconds() {
    let payload = AwarenessRelay {
        database_id: DatabaseId::from_uuid(Uuid::from_u128(1)),
        user_id: "macro|sam@example.com".to_string(),
        state: Awareness {
            peer_id: Some(uuid::Uuid::from_u128(7)),
            table_id: TableId::from_uuid(Uuid::from_u128(2)),
            row_id: Some(RowId::from_uuid(Uuid::from_u128(3))),
            column_id: Some(ColumnId::from_uuid(Uuid::from_u128(4))),
            end_row_id: Some(RowId::from_uuid(Uuid::from_u128(5))),
            end_column_id: Some(ColumnId::from_uuid(Uuid::from_u128(6))),
            editing: true,
            left: false,
        },
        relayed_at: Utc.timestamp_millis_opt(1_790_000_000_123).unwrap(),
    };
    assert_eq!(
        serde_json::to_value(payload).unwrap(),
        serde_json::json!({
            "databaseId": "00000000-0000-0000-0000-000000000001",
            "userId": "macro|sam@example.com",
            "state": {
                "peerId": "00000000-0000-0000-0000-000000000007",
                "tableId": "00000000-0000-0000-0000-000000000002",
                "rowId": "00000000-0000-0000-0000-000000000003",
                "columnId": "00000000-0000-0000-0000-000000000004",
                "endRowId": "00000000-0000-0000-0000-000000000005",
                "endColumnId": "00000000-0000-0000-0000-000000000006",
                "editing": true,
                "left": false,
            },
            "relayedAt": 1_790_000_000_123_i64,
        })
    );
}
