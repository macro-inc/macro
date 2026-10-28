mod fakes;

use std::collections::HashMap;

use databases::domain::models::{DatabaseError, OpRefusal};
use entity_access::domain::models::{EntityAccessReceipt, EntityType};
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::{CellValue, CellWrite, ColumnId, ColumnKind, DatabaseId, RowId, TableId};
use serde_json::json;
use uuid::Uuid;

use self::fakes::{FakeAccess, FakeRepo, FakeTables, Insert};
use super::*;
use crate::domain::mapping::WebhookColumn;
use crate::domain::models::{NewWebhook, PayloadProblem};
use crate::domain::token;

const ALICE: &str = "macro|alice@acme.com";
const DATABASE: DatabaseId = DatabaseId::from_uuid(Uuid::from_u128(1));
const OTHER_DATABASE: DatabaseId = DatabaseId::from_uuid(Uuid::from_u128(2));
const MEETINGS: TableId = TableId::from_uuid(Uuid::from_u128(10));
const TITLE: ColumnId = ColumnId::from_uuid(Uuid::from_u128(20));
const DURATION: ColumnId = ColumnId::from_uuid(Uuid::from_u128(21));

fn alice() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(ALICE).unwrap()
}

fn alice_edits(database: DatabaseId) -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::dangerously_assert_authenticated_user(
        alice(),
        &database.to_string(),
        EntityType::Database,
    )
}

/// A service over one database whose meetings table has a title and a
/// duration, which Alice can edit.
fn service() -> (
    DatabaseWebhooksServiceImpl<FakeRepo, FakeTables, FakeAccess>,
    FakeRepo,
    FakeTables,
    FakeAccess,
) {
    let repository = FakeRepo::default();
    let tables = FakeTables {
        tables: HashMap::from([(
            (DATABASE, MEETINGS),
            vec![
                WebhookColumn {
                    id: TITLE,
                    name: "Title".to_string(),
                    kind: Some(ColumnKind::Text),
                },
                WebhookColumn {
                    id: DURATION,
                    name: "Duration".to_string(),
                    kind: Some(ColumnKind::Number),
                },
            ],
        )]),
        ..FakeTables::default()
    };
    let access = FakeAccess::default();
    access
        .editors
        .lock()
        .unwrap()
        .push((ALICE.to_string(), DATABASE));
    (
        DatabaseWebhooksServiceImpl::new(repository.clone(), tables.clone(), access.clone()),
        repository,
        tables,
        access,
    )
}

#[tokio::test]
async fn creating_a_webhook_keeps_only_its_token_hash() {
    let (service, repository, _, _) = service();

    let created = service
        .create_webhook(alice_edits(DATABASE), MEETINGS)
        .await
        .unwrap();

    assert!(created.token.starts_with("mdbw_"));
    assert_eq!(created.webhook.database_id, DATABASE);
    assert_eq!(created.webhook.table_id, MEETINGS);
    assert_eq!(created.webhook.created_by, ALICE);
    assert_eq!(created.webhook.token_prefix, token::prefix(&created.token));
    assert_eq!(
        *repository.stored.lock().unwrap(),
        vec![NewWebhook {
            id: created.webhook.id,
            database_id: DATABASE,
            table_id: MEETINGS,
            created_by: ALICE.to_string(),
            token_hash: token::hash(&created.token),
            token_prefix: token::prefix(&created.token),
        }]
    );
}

#[tokio::test]
async fn a_webhook_is_for_a_table_of_the_receipts_database() {
    let (service, repository, _, _) = service();

    let refused = service
        .create_webhook(alice_edits(OTHER_DATABASE), MEETINGS)
        .await;

    assert!(matches!(refused, Err(DatabaseWebhookError::NotFound)));
    assert!(repository.stored.lock().unwrap().is_empty());
}

#[tokio::test]
async fn only_a_person_can_create_a_webhook() {
    let (service, _, _, _) = service();

    let refused = service
        .create_webhook(
            EntityAccessReceipt::dangerously_assert_internal_user(
                &DATABASE.to_string(),
                EntityType::Database,
            ),
            MEETINGS,
        )
        .await;

    assert!(matches!(refused, Err(DatabaseWebhookError::Forbidden(_))));
}

#[tokio::test]
async fn a_delivery_inserts_its_rows_as_the_creator() {
    let (service, _, tables, _) = service();
    let created = service
        .create_webhook(alice_edits(DATABASE), MEETINGS)
        .await
        .unwrap();

    let delivery = service
        .deliver(
            &created.token,
            &json!({ "Title": "Acme kickoff", "Duration": 45 }),
        )
        .await
        .unwrap();

    assert_eq!(
        delivery,
        Delivery {
            database_id: DATABASE,
            table_id: MEETINGS,
            rows: vec![RowId::from_uuid(Uuid::from_u128(1000))],
        }
    );
    assert_eq!(
        *tables.inserts.lock().unwrap(),
        vec![Insert {
            database_id: DATABASE.to_string(),
            viewer: ALICE.to_string(),
            table_id: MEETINGS,
            rows: vec![vec![
                CellWrite {
                    column: TITLE,
                    value: CellValue::Text("Acme kickoff".to_string()),
                },
                CellWrite {
                    column: DURATION,
                    value: CellValue::Number(45.0),
                },
            ]],
        }]
    );
}

#[tokio::test]
async fn an_unknown_token_is_not_found() {
    let (service, _, tables, _) = service();

    let refused = service
        .deliver(&token::generate(), &json!({ "Title": "x" }))
        .await;

    assert!(matches!(refused, Err(DatabaseWebhookError::NotFound)));
    assert!(tables.inserts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_webhook_stops_when_its_creator_can_no_longer_edit() {
    let (service, _, tables, access) = service();
    let created = service
        .create_webhook(alice_edits(DATABASE), MEETINGS)
        .await
        .unwrap();
    access.editors.lock().unwrap().clear();

    let refused = service
        .deliver(&created.token, &json!({ "Title": "x" }))
        .await;

    assert!(matches!(refused, Err(DatabaseWebhookError::Forbidden(_))));
    assert!(tables.inserts.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_payload_that_does_not_fit_writes_nothing() {
    let (service, _, tables, _) = service();
    let created = service
        .create_webhook(alice_edits(DATABASE), MEETINGS)
        .await
        .unwrap();

    let refused = service
        .deliver(&created.token, &json!({ "Titel": "x" }))
        .await;

    match refused {
        Err(DatabaseWebhookError::InvalidPayload(problems)) => assert_eq!(
            problems,
            vec![PayloadProblem {
                row: None,
                field: Some("Titel".to_string()),
                message: "no column is named \"Titel\"".to_string(),
            }]
        ),
        other => panic!("expected an invalid payload, got {other:?}"),
    }
    assert!(tables.inserts.lock().unwrap().is_empty());
}

/// A cell the databases service refuses (an unknown option, a required
/// column left empty) is the payload's problem, named by its key.
#[tokio::test]
async fn a_refused_cell_is_reported_by_its_column_name() {
    let (service, _, tables, _) = service();
    let created = service
        .create_webhook(alice_edits(DATABASE), MEETINGS)
        .await
        .unwrap();
    *tables.refusal.lock().unwrap() = Some(DatabaseError::InvalidOp(OpRefusal {
        op: 0,
        row: Some(1),
        column: Some(DURATION),
        taken: None,
        reason: "\"Duration\" needs a value".to_string(),
    }));

    let refused = service
        .deliver(
            &created.token,
            &json!([{ "Title": "a", "Duration": 1 }, { "Title": "b" }]),
        )
        .await;

    match refused {
        Err(DatabaseWebhookError::InvalidPayload(problems)) => assert_eq!(
            problems,
            vec![PayloadProblem {
                row: Some(1),
                field: Some("Duration".to_string()),
                message: "\"Duration\" needs a value".to_string(),
            }]
        ),
        other => panic!("expected an invalid payload, got {other:?}"),
    }
}

#[tokio::test]
async fn webhooks_are_listed_and_deleted_within_their_database() {
    let (service, _, _, access) = service();
    access
        .editors
        .lock()
        .unwrap()
        .push((ALICE.to_string(), OTHER_DATABASE));
    let created = service
        .create_webhook(alice_edits(DATABASE), MEETINGS)
        .await
        .unwrap();

    assert_eq!(
        service.list_webhooks(alice_edits(DATABASE)).await.unwrap(),
        vec![created.webhook.clone()]
    );
    assert!(
        service
            .list_webhooks(alice_edits(OTHER_DATABASE))
            .await
            .unwrap()
            .is_empty()
    );
    assert!(matches!(
        service
            .delete_webhook(alice_edits(OTHER_DATABASE), created.webhook.id)
            .await,
        Err(DatabaseWebhookError::NotFound)
    ));

    service
        .delete_webhook(alice_edits(DATABASE), created.webhook.id)
        .await
        .unwrap();

    assert!(matches!(
        service.deliver(&created.token, &json!({})).await,
        Err(DatabaseWebhookError::NotFound)
    ));
}
