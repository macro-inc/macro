use super::*;
use uuid::Uuid;

use crate::domain::models::{RowId, SchemaError, TableId};

mod fakes;

#[test]
fn an_infer_type_request_takes_camel_case_and_an_optional_entity_type() {
    let entity: InferColumnTypeRequest = serde_json::from_value(serde_json::json!({
        "dataType": "ENTITY",
        "specificEntityType": "USER",
        "baseVersion": 5,
    }))
    .unwrap();
    assert_eq!(entity.data_type, DataType::Entity);
    assert_eq!(
        entity.specific_entity_type,
        Some(models_properties::EntityType::User)
    );
    assert_eq!(entity.base_version, TableVersion(5));

    let number: InferColumnTypeRequest = serde_json::from_value(serde_json::json!({
        "dataType": "NUMBER",
        "baseVersion": 5,
    }))
    .unwrap();
    assert_eq!(number.data_type, DataType::Number);
    assert_eq!(number.specific_entity_type, None);
    assert_eq!(number.base_version, TableVersion(5));
}

#[test]
fn a_column_cast_reads_as_the_type_menu_expects() {
    let cast = crate::domain::models::ColumnCast {
        data_type: DataType::Number,
        is_multi_select: false,
        specific_entity_type: None,
        relation: false,
        cast: crate::domain::models::CastVerdict::Checked,
        reason: None,
        failures: 3,
        summary: Some("3 values aren't numbers".into()),
        examples: vec!["TBD".into(), "n/a".into(), "12.5.0".into()],
    };
    assert_eq!(
        serde_json::to_value(cast).unwrap(),
        serde_json::json!({
            "data_type": "NUMBER",
            "is_multi_select": false,
            "specific_entity_type": null,
            "relation": false,
            "cast": "checked",
            "reason": null,
            "failures": 3,
            "summary": "3 values aren't numbers",
            "examples": ["TBD", "n/a", "12.5.0"],
        })
    );
}

#[test]
fn an_ops_body_reads_every_op_kind() {
    let table = Uuid::from_u128(0x7ab1);
    let column = Uuid::from_u128(0xc01a);
    let row = Uuid::from_u128(0x5a11);
    let request: ops::ApplyOpsRequest = serde_json::from_value(serde_json::json!({
        "ops": [
            {
                "kind": "rows",
                "table": table,
                "change": {
                    "kind": "insert",
                    "rows": [[{"column": column, "value": {"type": "text", "value": "Sam"}}]],
                },
            },
            {
                "kind": "rows",
                "table": table,
                "change": {
                    "kind": "update",
                    "changes": {
                        "kind": "uniform",
                        "rows": [row],
                        "cells": [{"column": column, "value": {"type": "options", "value": [{"label": "Going"}]}}],
                    },
                },
            },
            {
                "kind": "rows",
                "table": table,
                "change": {
                    "kind": "update",
                    "changes": {
                        "kind": "per_row",
                        "rows": [{"row": row, "cells": [{"column": column, "value": {"type": "clear"}}]}],
                    },
                },
            },
            {"kind": "rows", "table": table, "change": {"kind": "delete", "rows": [row]}},
            {
                "kind": "column",
                "table": table,
                "column": column,
                "change": {"kind": "change_type", "to": {"type": "number"}},
            },
        ],
    }))
    .unwrap();

    use models_databases::RowChanges;
    use models_databases::{
        CellValue, CellWrite, ColumnChange, ColumnKind, DatabaseOp, OptionRef, RowChange,
        RowsChange,
    };
    assert_eq!(
        request.ops,
        vec![
            DatabaseOp::Rows {
                table: TableId::from_uuid(table),
                change: RowsChange::Insert {
                    rows: vec![vec![CellWrite {
                        column: ColumnId::from_uuid(column),
                        value: CellValue::Text("Sam".into()),
                    }]],
                },
            },
            DatabaseOp::Rows {
                table: TableId::from_uuid(table),
                change: RowsChange::Update {
                    changes: RowChanges::Uniform {
                        rows: vec![RowId::from_uuid(row)],
                        cells: vec![CellWrite {
                            column: ColumnId::from_uuid(column),
                            value: CellValue::Options(vec![OptionRef::Label("Going".into())]),
                        }],
                    },
                },
            },
            DatabaseOp::Rows {
                table: TableId::from_uuid(table),
                change: RowsChange::Update {
                    changes: RowChanges::PerRow {
                        rows: vec![RowChange {
                            row: RowId::from_uuid(row),
                            cells: vec![CellWrite {
                                column: ColumnId::from_uuid(column),
                                value: CellValue::Clear,
                            }],
                        }],
                    },
                },
            },
            DatabaseOp::Rows {
                table: TableId::from_uuid(table),
                change: RowsChange::Delete {
                    rows: vec![RowId::from_uuid(row)],
                },
            },
            DatabaseOp::Column {
                table: TableId::from_uuid(table),
                column: ColumnId::from_uuid(column),
                change: ColumnChange::ChangeType {
                    to: ColumnKind::Number,
                },
            },
        ]
    );
}

#[tokio::test]
async fn view_access_cannot_apply_ops() {
    use axum::body::Body;
    use axum::http::{Request, header};
    use entity_access::domain::models::AccessLevel;
    use tower::ServiceExt;

    let database = Uuid::from_u128(0x0dbb);
    let request = || {
        Request::post(format!("/{database}/ops"))
            .header(header::AUTHORIZATION, "Bearer valid")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"ops": []}"#))
            .unwrap()
    };

    let (viewing, service) = fakes::ops_router(AccessLevel::View);
    let response = viewing.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.applied.lock().unwrap().len(), 0);

    let (editing, service) = fakes::ops_router(AccessLevel::Edit);
    let response = editing.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(service.applied.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn view_access_cannot_change_an_option() {
    use axum::body::Body;
    use axum::http::{Request, header};
    use entity_access::domain::models::AccessLevel;
    use tower::ServiceExt;

    let database = Uuid::from_u128(0x0dbb);
    let body = serde_json::json!({
        "ops": [{
            "kind": "column",
            "table": Uuid::from_u128(0x7ab1),
            "column": Uuid::from_u128(0xc01a),
            "change": {
                "kind": "update_option",
                "option": Uuid::from_u128(0x0b7),
                "label": "Maybe",
                "color": "#12A594",
            },
        }],
    })
    .to_string();
    let request = || {
        Request::post(format!("/{database}/ops"))
            .header(header::AUTHORIZATION, "Bearer valid")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.clone()))
            .unwrap()
    };

    let (viewing, service) = fakes::ops_router(AccessLevel::View);
    let response = viewing.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.applied.lock().unwrap().len(), 0);

    let (editing, service) = fakes::ops_router(AccessLevel::Edit);
    let response = editing.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(service.applied.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn view_access_cannot_remove_an_option() {
    use axum::body::Body;
    use axum::http::{Request, header};
    use entity_access::domain::models::AccessLevel;
    use tower::ServiceExt;

    let database = Uuid::from_u128(0x0dbb);
    let body = serde_json::json!({
        "ops": [{
            "kind": "column",
            "table": Uuid::from_u128(0x7ab1),
            "column": Uuid::from_u128(0xc01a),
            "change": {"kind": "delete_option", "option": Uuid::from_u128(0x0b7)},
        }],
    })
    .to_string();
    let request = || {
        Request::post(format!("/{database}/ops"))
            .header(header::AUTHORIZATION, "Bearer valid")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.clone()))
            .unwrap()
    };

    let (viewing, service) = fakes::ops_router(AccessLevel::View);
    let response = viewing.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.applied.lock().unwrap().len(), 0);

    let (editing, service) = fakes::ops_router(AccessLevel::Edit);
    let response = editing.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(service.applied.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn view_access_cannot_create_a_view() {
    use axum::body::Body;
    use axum::http::{Request, header};
    use entity_access::domain::models::AccessLevel;
    use tower::ServiceExt;

    let database = Uuid::from_u128(0x0dbb);
    let body = serde_json::json!({
        "ops": [{
            "kind": "view",
            "table": Uuid::from_u128(0x7ab1),
            "view": Uuid::from_u128(0x71e),
            "change": {
                "kind": "create",
                "view": {"name": "Everyone", "layout": {"kind": "table", "columns": []}},
            },
        }],
    })
    .to_string();
    let request = || {
        Request::post(format!("/{database}/ops"))
            .header(header::AUTHORIZATION, "Bearer valid")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.clone()))
            .unwrap()
    };

    let (viewing, service) = fakes::ops_router(AccessLevel::View);
    let response = viewing.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.applied.lock().unwrap().len(), 0);

    let (editing, service) = fakes::ops_router(AccessLevel::Edit);
    let response = editing.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(service.applied.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn view_access_cannot_change_a_view() {
    use axum::body::Body;
    use axum::http::{Request, header};
    use entity_access::domain::models::AccessLevel;
    use tower::ServiceExt;

    let database = Uuid::from_u128(0x0dbb);
    let body = serde_json::json!({
        "ops": [{
            "kind": "view",
            "table": Uuid::from_u128(0x7ab1),
            "view": Uuid::from_u128(0x71e),
            "change": {"kind": "update", "name": "Everyone"},
        }],
    })
    .to_string();
    let request = || {
        Request::post(format!("/{database}/ops"))
            .header(header::AUTHORIZATION, "Bearer valid")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.clone()))
            .unwrap()
    };

    let (viewing, service) = fakes::ops_router(AccessLevel::View);
    let response = viewing.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.applied.lock().unwrap().len(), 0);

    let (editing, service) = fakes::ops_router(AccessLevel::Edit);
    let response = editing.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(service.applied.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn view_access_cannot_remove_a_view() {
    use axum::body::Body;
    use axum::http::{Request, header};
    use entity_access::domain::models::AccessLevel;
    use tower::ServiceExt;

    let database = Uuid::from_u128(0x0dbb);
    let body = serde_json::json!({
        "ops": [{
            "kind": "view",
            "table": Uuid::from_u128(0x7ab1),
            "view": Uuid::from_u128(0x71e),
            "change": {"kind": "delete"},
        }],
    })
    .to_string();
    let request = || {
        Request::post(format!("/{database}/ops"))
            .header(header::AUTHORIZATION, "Bearer valid")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.clone()))
            .unwrap()
    };

    let (viewing, service) = fakes::ops_router(AccessLevel::View);
    let response = viewing.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.applied.lock().unwrap().len(), 0);

    let (editing, service) = fakes::ops_router(AccessLevel::Edit);
    let response = editing.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(service.applied.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn view_access_cannot_reorder_views() {
    use axum::body::Body;
    use axum::http::{Request, header};
    use entity_access::domain::models::AccessLevel;
    use tower::ServiceExt;

    let database = Uuid::from_u128(0x0dbb);
    let body = serde_json::json!({
        "ops": [{
            "kind": "table",
            "table": Uuid::from_u128(0x7ab1),
            "change": {"kind": "reorder_views", "order": [Uuid::from_u128(0x71e)]},
        }],
    })
    .to_string();
    let request = || {
        Request::post(format!("/{database}/ops"))
            .header(header::AUTHORIZATION, "Bearer valid")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.clone()))
            .unwrap()
    };

    let (viewing, service) = fakes::ops_router(AccessLevel::View);
    let response = viewing.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.applied.lock().unwrap().len(), 0);

    let (editing, service) = fakes::ops_router(AccessLevel::Edit);
    let response = editing.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(service.applied.lock().unwrap().len(), 1);
}

#[tokio::test]
async fn view_access_cannot_move_a_card() {
    use axum::body::Body;
    use axum::http::{Request, header};
    use entity_access::domain::models::AccessLevel;
    use tower::ServiceExt;

    let database = Uuid::from_u128(0x0dbb);
    let body = serde_json::json!({
        "ops": [{
            "kind": "view",
            "table": Uuid::from_u128(0x7ab1),
            "view": Uuid::from_u128(0x71e),
            "change": {
                "kind": "move_card",
                "row": Uuid::from_u128(0x5a11),
                "lane": {"kind": "none"},
                "before": null,
                "after": null,
            },
        }],
    })
    .to_string();
    let request = || {
        Request::post(format!("/{database}/ops"))
            .header(header::AUTHORIZATION, "Bearer valid")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(body.clone()))
            .unwrap()
    };

    let (viewing, service) = fakes::ops_router(AccessLevel::View);
    let response = viewing.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.applied.lock().unwrap().len(), 0);

    let (editing, service) = fakes::ops_router(AccessLevel::Edit);
    let response = editing.oneshot(request()).await.unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(service.applied.lock().unwrap().len(), 1);
}

async fn error_body(error: DatabaseError) -> (StatusCode, serde_json::Value) {
    let response = error.into_response();
    let status = response.status();
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    (status, serde_json::from_slice(&bytes).unwrap())
}

#[tokio::test]
async fn a_refused_op_answers_where_it_was_refused() {
    let column = Uuid::from_u128(0xc01);
    let (status, body) = error_body(DatabaseError::InvalidOp(crate::domain::models::OpRefusal {
        op: 1,
        row: Some(2),
        column: Some(ColumnId::from_uuid(column)),
        taken: None,
        reason: "\"soon\" is not a number".into(),
    }))
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        serde_json::json!({
            "message": "\"soon\" is not a number",
            "op": 1,
            "row": 2,
            "column": column,
            "taken": null,
        })
    );

    let (_, body) = error_body(DatabaseError::InvalidOp(crate::domain::models::OpRefusal {
        op: 0,
        row: None,
        column: None,
        taken: None,
        reason: "table is not in this database".into(),
    }))
    .await;
    assert_eq!(
        body,
        serde_json::json!({
            "message": "table is not in this database",
            "op": 0,
            "row": null,
            "column": null,
            "taken": null,
        })
    );
}

#[tokio::test]
async fn an_invalid_schema_operation_answers_its_reason_alone() {
    let (status, body) = error_body(DatabaseError::InvalidSchemaOperation(
        SchemaError::EmptyName,
    ))
    .await;
    assert_eq!(status, StatusCode::BAD_REQUEST);
    assert_eq!(
        body,
        serde_json::json!({"message": "name must not be empty"})
    );
}

/// The schema writes the deleted routes made are ops now: each reaches the
/// service as written, under the ids the client minted, with the versions
/// the batch is guarded on.
#[tokio::test]
async fn a_schema_batch_reaches_the_service_with_its_base_versions() {
    use axum::body::Body;
    use axum::http::{Request, header};
    use entity_access::domain::models::AccessLevel;
    use models_databases::{
        ColumnChange, ColumnKind, DatabaseOp, EntityKind, NewColumn, NewOption, PropertyId,
        TableChange,
    };
    use std::collections::HashMap;
    use tower::ServiceExt;

    use crate::domain::models::{OpBatch, OptionId};

    let database = Uuid::from_u128(0x0dbb);
    let guests = Uuid::from_u128(0x7ab1);
    let sessions = Uuid::from_u128(0x7ab2);
    let archive = Uuid::from_u128(0x7ab3);
    let status = Uuid::from_u128(0xc01a);
    let stage = Uuid::from_u128(0xc01b);
    let notes = Uuid::from_u128(0xc01c);
    let owner = Uuid::from_u128(0xc01d);
    let retired = Uuid::from_u128(0xc01e);
    let going = Uuid::from_u128(0x0b71);
    let maybe = Uuid::from_u128(0x0b72);
    let property = Uuid::from_u128(0x9a09);
    let body = serde_json::json!({
        "ops": [
            {"kind": "table", "table": sessions, "change": {"kind": "create", "name": "Sessions"}},
            {
                "kind": "column",
                "table": sessions,
                "column": stage,
                "change": {
                    "kind": "create",
                    "definition": {
                        "source": "new",
                        "name": "Stage",
                        "type": {"type": "select", "multi": false},
                        "options": [{"id": going, "label": "Going"}],
                    },
                },
            },
            {
                "kind": "column",
                "table": sessions,
                "column": notes,
                "change": {
                    "kind": "create",
                    "definition": {"source": "new", "name": "Notes", "type": {"type": "text"}, "inferType": true},
                    "after": stage,
                },
            },
            {
                "kind": "column",
                "table": guests,
                "column": owner,
                "change": {"kind": "create", "definition": {"source": "existing", "property": property}},
            },
            {
                "kind": "table",
                "table": guests,
                "change": {"kind": "rename", "name": "Guests", "previousName": "Table 1"},
            },
            {
                "kind": "column",
                "table": guests,
                "column": status,
                "change": {"kind": "rename", "name": "RSVP", "previousName": "Status"},
            },
            {"kind": "table", "table": guests, "change": {"kind": "reorder_columns", "order": [owner, status]}},
            {
                "kind": "column",
                "table": guests,
                "column": status,
                "change": {"kind": "add_options", "options": [{"id": maybe, "label": "Maybe"}]},
            },
            {
                "kind": "column",
                "table": guests,
                "column": status,
                "change": {"kind": "change_type", "to": {"type": "entity", "target": "USER", "multi": true}},
            },
            {"kind": "column", "table": guests, "column": retired, "change": {"kind": "delete"}},
            {"kind": "reorder_tables", "order": [sessions, guests, archive]},
            {"kind": "table", "table": archive, "change": {"kind": "delete"}},
        ],
        "baseVersions": {guests.to_string(): 3},
    })
    .to_string();

    let (router, service) = fakes::ops_router(AccessLevel::Edit);
    let response = router
        .oneshot(
            Request::post(format!("/{database}/ops"))
                .header(header::AUTHORIZATION, "Bearer valid")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);

    let guests = TableId::from_uuid(guests);
    let sessions = TableId::from_uuid(sessions);
    let archive = TableId::from_uuid(archive);
    assert_eq!(
        *service.applied.lock().unwrap(),
        vec![OpBatch {
            ops: vec![
                DatabaseOp::Table {
                    table: sessions,
                    change: TableChange::Create {
                        name: "Sessions".into(),
                    },
                },
                DatabaseOp::Column {
                    table: sessions,
                    column: ColumnId::from_uuid(stage),
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Stage".into(),
                            kind: ColumnKind::Select { multi: false },
                            options: vec![NewOption {
                                id: OptionId::from_uuid(going),
                                label: "Going".into(),
                            }],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
                DatabaseOp::Column {
                    table: sessions,
                    column: ColumnId::from_uuid(notes),
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Notes".into(),
                            kind: ColumnKind::Text,
                            options: vec![],
                            infer_type: true,
                        },
                        after: Some(ColumnId::from_uuid(stage)),
                    },
                },
                DatabaseOp::Column {
                    table: guests,
                    column: ColumnId::from_uuid(owner),
                    change: ColumnChange::Create {
                        definition: NewColumn::Existing {
                            property: PropertyId::from_uuid(property),
                        },
                        after: None,
                    },
                },
                DatabaseOp::Table {
                    table: guests,
                    change: TableChange::Rename {
                        name: "Guests".into(),
                        previous_name: Some("Table 1".into()),
                    },
                },
                DatabaseOp::Column {
                    table: guests,
                    column: ColumnId::from_uuid(status),
                    change: ColumnChange::Rename {
                        name: "RSVP".into(),
                        previous_name: Some("Status".into()),
                    },
                },
                DatabaseOp::Table {
                    table: guests,
                    change: TableChange::ReorderColumns {
                        order: vec![ColumnId::from_uuid(owner), ColumnId::from_uuid(status)],
                    },
                },
                DatabaseOp::Column {
                    table: guests,
                    column: ColumnId::from_uuid(status),
                    change: ColumnChange::AddOptions {
                        options: vec![NewOption {
                            id: OptionId::from_uuid(maybe),
                            label: "Maybe".into(),
                        }],
                    },
                },
                DatabaseOp::Column {
                    table: guests,
                    column: ColumnId::from_uuid(status),
                    change: ColumnChange::ChangeType {
                        to: ColumnKind::Entity {
                            target: EntityKind::User,
                            multi: true,
                        },
                    },
                },
                DatabaseOp::Column {
                    table: guests,
                    column: ColumnId::from_uuid(retired),
                    change: ColumnChange::Delete,
                },
                DatabaseOp::ReorderTables {
                    order: vec![sessions, guests, archive],
                },
                DatabaseOp::Table {
                    table: archive,
                    change: TableChange::Delete,
                },
            ],
            base_versions: HashMap::from([(guests, TableVersion(3))]),
        }]
    );
}

/// A retried batch whose first attempt committed finds its minted ids taken;
/// the refusal names the id, so the client can tell a retry from a clash.
#[tokio::test]
async fn a_taken_id_refuses_the_batch_with_400_naming_it() {
    use axum::body::Body;
    use axum::http::{Request, header};
    use entity_access::domain::models::AccessLevel;
    use models_databases::TakenId;
    use tower::ServiceExt;

    let database = Uuid::from_u128(0x0dbb);
    let table = Uuid::from_u128(0x7ab1);
    let column = Uuid::from_u128(0xc01a);
    let body = serde_json::json!({
        "ops": [{
            "kind": "column",
            "table": table,
            "column": column,
            "change": {
                "kind": "create",
                "definition": {"source": "new", "name": "Notes", "type": {"type": "text"}},
            },
        }],
    })
    .to_string();

    let (router, service) = fakes::ops_router(AccessLevel::Edit);
    *service.refusal.lock().unwrap() =
        Some(DatabaseError::InvalidOp(crate::domain::models::OpRefusal {
            op: 0,
            row: None,
            column: Some(ColumnId::from_uuid(column)),
            taken: Some(TakenId::Column(ColumnId::from_uuid(column))),
            reason: "column id is already taken".into(),
        }));
    let response = router
        .oneshot(
            Request::post(format!("/{database}/ops"))
                .header(header::AUTHORIZATION, "Bearer valid")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
        serde_json::json!({
            "message": "column id is already taken",
            "op": 0,
            "row": null,
            "column": column,
            "taken": {"kind": "column", "id": column},
        })
    );
}

#[tokio::test]
async fn a_table_off_its_base_version_answers_409() {
    use axum::body::Body;
    use axum::http::{Request, header};
    use entity_access::domain::models::AccessLevel;
    use tower::ServiceExt;

    let database = Uuid::from_u128(0x0dbb);
    let table = Uuid::from_u128(0x7ab1);
    let body = serde_json::json!({
        "ops": [{
            "kind": "column",
            "table": table,
            "column": Uuid::from_u128(0xc01a),
            "change": {"kind": "delete"},
        }],
        "baseVersions": {table.to_string(): 3},
    })
    .to_string();

    let (router, service) = fakes::ops_router(AccessLevel::Edit);
    *service.refusal.lock().unwrap() = Some(DatabaseError::VersionConflict);
    let response = router
        .oneshot(
            Request::post(format!("/{database}/ops"))
                .header(header::AUTHORIZATION, "Bearer valid")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(body))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::CONFLICT);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
        serde_json::json!({"message": "The table changed since it was read. Refresh and try again."})
    );
}

/// Schema writes have one surface: the routes that made them one at a time
/// are not routed, while the ops route is.
#[tokio::test]
async fn the_schema_routes_are_gone() {
    use axum::body::Body;
    use axum::http::{Method, Request, header};
    use entity_access::domain::models::AccessLevel;
    use tower::ServiceExt;

    let database = Uuid::from_u128(0x0dbb);
    let table = Uuid::from_u128(0x7ab1);
    let column = Uuid::from_u128(0xc01a);
    let (router, _) = fakes::full_router(AccessLevel::Owner);
    let send = |method: Method, path: String| {
        let router = router.clone();
        async move {
            router
                .oneshot(
                    Request::builder()
                        .method(method)
                        .uri(path)
                        .header(header::AUTHORIZATION, "Bearer valid")
                        .header(header::CONTENT_TYPE, "application/json")
                        .body(Body::from(r#"{"ops": []}"#))
                        .unwrap(),
                )
                .await
                .unwrap()
                .status()
        }
    };

    for (method, path) in [
        (Method::POST, format!("/{database}/tables")),
        (Method::PUT, format!("/{database}/tables/order")),
        (Method::PATCH, format!("/{database}/tables/{table}")),
        (Method::DELETE, format!("/{database}/tables/{table}")),
        (Method::POST, format!("/{database}/tables/{table}/columns")),
        (
            Method::PATCH,
            format!("/{database}/tables/{table}/columns/order"),
        ),
        (
            Method::PATCH,
            format!("/{database}/tables/{table}/columns/{column}"),
        ),
        (
            Method::DELETE,
            format!("/{database}/tables/{table}/columns/{column}"),
        ),
        (
            Method::PATCH,
            format!("/{database}/tables/{table}/columns/{column}/type"),
        ),
        (
            Method::POST,
            format!("/{database}/tables/{table}/columns/{column}/options"),
        ),
    ] {
        assert_eq!(
            send(method.clone(), path.clone()).await,
            StatusCode::NOT_FOUND,
            "{method} {path}"
        );
    }
    assert_eq!(
        send(Method::POST, format!("/{database}/ops")).await,
        StatusCode::OK
    );
}

#[tokio::test]
async fn a_conversion_request_reaches_the_service_and_answers_the_converted_cells() {
    use axum::body::Body;
    use axum::http::{Request, header};
    use entity_access::domain::models::AccessLevel;
    use models_databases::{CellValue, ColumnKind};
    use tower::ServiceExt;

    use crate::domain::models::{ColumnConversion, ConvertedCell};

    let database = Uuid::from_u128(0x0dbb);
    let table = Uuid::from_u128(0x7ab1);
    let column = Uuid::from_u128(0xc01a);
    let one = Uuid::from_u128(0x5a11);
    let two = Uuid::from_u128(0x5a12);
    let (router, service) = fakes::conversion_router(AccessLevel::View);
    *service.conversion.lock().unwrap() = Some(ColumnConversion {
        table_version: TableVersion(7),
        options: vec![],
        cells: vec![
            ConvertedCell {
                row: RowId::from_uuid(one),
                value: CellValue::Number(1.0),
            },
            ConvertedCell {
                row: RowId::from_uuid(two),
                value: CellValue::Number(2.0),
            },
        ],
        misfits: 1,
    });

    let response = router
        .oneshot(
            Request::post(format!(
                "/{database}/tables/{table}/columns/{column}/conversion"
            ))
            .header(header::AUTHORIZATION, "Bearer valid")
            .header(header::CONTENT_TYPE, "application/json")
            .body(Body::from(r#"{"to": {"type": "number"}}"#))
            .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::OK);
    let bytes = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&bytes).unwrap(),
        serde_json::json!({
            "tableVersion": 7,
            "options": [],
            "cells": [
                {"row": one, "value": {"type": "number", "value": 1.0}},
                {"row": two, "value": {"type": "number", "value": 2.0}},
            ],
            "misfits": 1,
        })
    );
    assert_eq!(
        *service.conversions.lock().unwrap(),
        vec![(
            TableId::from_uuid(table),
            ColumnId::from_uuid(column),
            ColumnKind::Number
        )]
    );
}

#[tokio::test]
async fn creating_from_a_template_reaches_the_service_as_the_caller() {
    use axum::body::Body;
    use axum::http::{Request, header};
    use entity_access::domain::models::AccessLevel;
    use tower::ServiceExt;

    use crate::domain::templates::TemplateId;

    let create = |authorization: Option<&str>, body: &'static str| {
        let mut request = Request::post("/").header(header::CONTENT_TYPE, "application/json");
        if let Some(token) = authorization {
            request = request.header(header::AUTHORIZATION, format!("Bearer {token}"));
        }
        request.body(Body::from(body)).unwrap()
    };

    let (router, service) = fakes::full_router(AccessLevel::Owner);
    let response = router
        .clone()
        .oneshot(create(
            Some("valid"),
            r#"{"name": "Launch", "template": "project_tracker"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        serde_json::to_value(fakes::created_database()).unwrap()
    );
    let response = router
        .clone()
        .oneshot(create(Some("valid"), r#"{"name": "Blank"}"#))
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::CREATED);
    let created: Vec<(String, String, Option<TemplateId>)> = service
        .created
        .lock()
        .unwrap()
        .iter()
        .map(|command| {
            (
                command.name.clone(),
                command.owner_id.to_string(),
                command.template,
            )
        })
        .collect();
    assert_eq!(
        created,
        vec![
            (
                "Launch".to_owned(),
                "macro|ops-router@macro.com".to_owned(),
                Some(TemplateId::ProjectTracker)
            ),
            (
                "Blank".to_owned(),
                "macro|ops-router@macro.com".to_owned(),
                None
            ),
        ]
    );

    let unknown = router
        .clone()
        .oneshot(create(
            Some("valid"),
            r#"{"name": "Launch", "template": "spaceship"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(unknown.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let removed = router
        .clone()
        .oneshot(create(
            Some("valid"),
            r#"{"name": "Launch", "template": "crm"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(removed.status(), StatusCode::UNPROCESSABLE_ENTITY);
    let anonymous = router
        .oneshot(create(
            None,
            r#"{"name": "Launch", "template": "project_tracker"}"#,
        ))
        .await
        .unwrap();
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);
    assert_eq!(service.created.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn the_template_list_answers_every_template_to_a_signed_in_caller() {
    use axum::body::Body;
    use axum::http::{Request, header};
    use entity_access::domain::models::AccessLevel;
    use tower::ServiceExt;

    let (router, _) = fakes::full_router(AccessLevel::Owner);
    let response = router
        .clone()
        .oneshot(
            Request::get("/templates")
                .header(header::AUTHORIZATION, "Bearer valid")
                .body(Body::empty())
                .unwrap(),
        )
        .await
        .unwrap();
    assert_eq!(response.status(), StatusCode::OK);
    let body = axum::body::to_bytes(response.into_body(), usize::MAX)
        .await
        .unwrap();
    assert_eq!(
        serde_json::from_slice::<serde_json::Value>(&body).unwrap(),
        serde_json::json!([
            {
                "id": "project_tracker",
                "name": "Project tracker",
                "description": "Tasks with a status, an owner, a due date and a priority, on a board by status.",
                "icon": "kanban",
            },
            {
                "id": "event_planner",
                "name": "Event planner",
                "description": "Parties and their invites, with a board of who is coming.",
                "icon": "confetti",
            },
            {
                "id": "content_calendar",
                "name": "Content calendar",
                "description": "Posts with a channel, an author and a publish date, on a board by status.",
                "icon": "calendar",
            },
            {
                "id": "reading_list",
                "name": "Reading list",
                "description": "Books to read, with their author, a status and a rating.",
                "icon": "books",
            },
            {
                "id": "getting_started",
                "name": "Getting started",
                "description": "A few ideas on a board, to try out tables, cards and views.",
                "icon": "sparkle",
            },
        ])
    );

    let anonymous = router
        .oneshot(Request::get("/templates").body(Body::empty()).unwrap())
        .await
        .unwrap();
    assert_eq!(anonymous.status(), StatusCode::UNAUTHORIZED);
}
