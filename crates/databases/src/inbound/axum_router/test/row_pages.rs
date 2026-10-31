//! The table rows route: a viewer's query reaches the service and its page
//! answers with the version it was read at; a caller without a grant is
//! refused before the service, and a missing or moved table answers as the
//! client restarts on.

use std::collections::HashMap;

use axum::body::Body;
use axum::http::{Request, header};
use entity_access::domain::models::AccessLevel;
use models_properties::service::property_value::PropertyValue;
use tower::ServiceExt;

use super::*;
use crate::domain::storage::{StorageRow, StorageRows};

#[tokio::test]
async fn a_viewer_reads_a_page_with_the_version_it_was_read_at() {
    let database = Uuid::from_u128(0x0dbb);
    let table = Uuid::from_u128(0x7ab1);
    let name = Uuid::from_u128(0xc01a);
    let after = Uuid::from_u128(0x5a10);
    let sam = Uuid::from_u128(0x5a11);
    let (router, service) = fakes::rows_router(Some(AccessLevel::View));
    *service.row_page.lock().unwrap() = Some(Ok(StorageRows {
        rows: vec![StorageRow {
            row_id: RowId::from_uuid(sam),
            cells: HashMap::from([(ColumnId::from_uuid(name), PropertyValue::Str("Sam".into()))]),
        }],
        next: Some(RowId::from_uuid(sam)),
        version: TableVersion(7),
    }));

    let response = router
        .oneshot(
            Request::post(format!("/{database}/tables/{table}/rows"))
                .header(header::AUTHORIZATION, "Bearer valid")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from(format!(r#"{{"after": "{after}"}}"#)))
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
            "rows": [{
                "rowId": sam,
                "cells": {name.to_string(): {"type": "String", "value": "Sam"}},
            }],
            "next": sam,
            "version": 7,
        })
    );
    assert_eq!(
        *service.row_pages.lock().unwrap(),
        vec![(TableId::from_uuid(table), Some(RowId::from_uuid(after)))]
    );
}

#[tokio::test]
async fn a_caller_without_a_grant_cannot_read_rows() {
    let database = Uuid::from_u128(0x0dbb);
    let table = Uuid::from_u128(0x7ab1);
    let (router, service) = fakes::rows_router(None);

    let response = router
        .oneshot(
            Request::post(format!("/{database}/tables/{table}/rows"))
                .header(header::AUTHORIZATION, "Bearer valid")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
        .await
        .unwrap();

    assert_eq!(response.status(), StatusCode::UNAUTHORIZED);
    assert!(service.row_pages.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_missing_table_answers_404_and_a_table_that_moved_409() {
    let database = Uuid::from_u128(0x0dbb);
    let table = Uuid::from_u128(0x7ab1);
    let (router, service) = fakes::rows_router(Some(AccessLevel::View));
    let read = || {
        router.clone().oneshot(
            Request::post(format!("/{database}/tables/{table}/rows"))
                .header(header::AUTHORIZATION, "Bearer valid")
                .header(header::CONTENT_TYPE, "application/json")
                .body(Body::from("{}"))
                .unwrap(),
        )
    };

    *service.row_page.lock().unwrap() = Some(Err(DatabaseError::NotFound));
    assert_eq!(read().await.unwrap().status(), StatusCode::NOT_FOUND);
    *service.row_page.lock().unwrap() = Some(Err(DatabaseError::VersionConflict));
    assert_eq!(read().await.unwrap().status(), StatusCode::CONFLICT);
}
