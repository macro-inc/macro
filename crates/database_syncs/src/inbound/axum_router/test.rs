use axum::body::to_bytes;
use serde_json::{Value, json};

use super::*;

async fn answer(error: DatabaseSyncError) -> (StatusCode, Value) {
    let response = error.into_response();
    let status = response.status();
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    (status, serde_json::from_slice(&body).unwrap())
}

#[tokio::test]
async fn a_source_problem_answers_what_the_caller_can_do_about_it() {
    assert_eq!(
        answer(DatabaseSyncError::SourceDisconnected).await,
        (
            StatusCode::CONFLICT,
            json!({ "message": "connect the source first" })
        )
    );
    assert_eq!(
        answer(DatabaseSyncError::SourceNotFound).await,
        (
            StatusCode::NOT_FOUND,
            json!({ "message": "the source was not found, or the connection may not read it" })
        )
    );
    assert_eq!(
        answer(DatabaseSyncError::SourceUnavailable(rootcause::report!(
            "Notion answered 503"
        )))
        .await,
        (
            StatusCode::BAD_GATEWAY,
            json!({ "message": "the source could not be read; try again" })
        )
    );
    assert_eq!(
        answer(DatabaseSyncError::IdTaken).await,
        (
            StatusCode::CONFLICT,
            json!({ "message": "the id names another sync" })
        )
    );
}

#[test]
fn a_sync_serializes_its_source_and_status_tagged() {
    let sync = DatabaseSync {
        id: Uuid::from_u128(1),
        database_id: models_databases::DatabaseId::from_uuid(Uuid::from_u128(2)),
        table_id: models_databases::TableId::from_uuid(Uuid::from_u128(3)),
        created_by: macro_user_id::user_id::MacroUserIdStr::parse_from_str(
            "macro|alice@example.com",
        )
        .unwrap(),
        source: SyncSource::NotionDataSource {
            data_source_id: import_notion::domain::model::NotionId::parse(
                "0123456789abcdef0123456789abcdef",
            )
            .unwrap(),
        },
        columns: vec![SyncedColumn {
            field: SyncField::Notion {
                property_id: "title".to_string(),
            },
            column: models_databases::ColumnId::from_uuid(Uuid::from_u128(4)),
        }],
        detached_columns: vec![DetachedColumn {
            field: SyncField::Granola {
                field: GranolaField::Summary,
            },
            column: models_databases::ColumnId::from_uuid(Uuid::from_u128(5)),
            reason: DetachReason::TypeChanged,
        }],
        status: SyncStatus::Failed {
            failure: SyncFailure::SourceNotFound,
        },
        last_synced_at: None,
        created_at: chrono::DateTime::parse_from_rfc3339("2026-11-06T09:00:00Z")
            .unwrap()
            .to_utc(),
    };

    assert_eq!(
        serde_json::to_value(&sync).unwrap(),
        json!({
            "id": "00000000-0000-0000-0000-000000000001",
            "databaseId": "00000000-0000-0000-0000-000000000002",
            "tableId": "00000000-0000-0000-0000-000000000003",
            "createdBy": "macro|alice@example.com",
            "source": {
                "kind": "notion_data_source",
                "dataSourceId": "0123456789abcdef0123456789abcdef",
            },
            "columns": [{
                "field": { "source": "notion", "propertyId": "title" },
                "column": "00000000-0000-0000-0000-000000000004",
            }],
            "detachedColumns": [{
                "field": { "source": "granola", "field": "summary" },
                "column": "00000000-0000-0000-0000-000000000005",
                "reason": "type_changed",
            }],
            "status": { "state": "failed", "failure": "source_not_found" },
            "lastSyncedAt": null,
            "createdAt": "2026-11-06T09:00:00Z",
        })
    );
}
