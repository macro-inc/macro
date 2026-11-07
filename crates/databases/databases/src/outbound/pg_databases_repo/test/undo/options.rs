//! Option creation undo preserves selections, including concurrent shared use.

use super::super::apply_ops::version;
use super::*;
use models_databases::{NewOption, OptionId};
use models_properties::service::property_value::PropertyValue;
use models_properties::{EntityReference, EntityType};
use properties::domain::database_cell_writer::DatabaseCellWriter;
use properties::domain::database_option_writer::{DatabaseOptionWriter, DeleteUnusedOptionOutcome};
use std::time::Duration;
use uuid::Uuid;

async fn add_option(pool: &PgPool, wedding: &Wedding) -> (OptionId, ChangeId) {
    let option = OptionId::from_uuid(Uuid::now_v7());
    let change = change_as(
        pool,
        wedding,
        WOLF,
        vec![DatabaseOp::Column {
            table: wedding.table_id,
            column: wedding.rsvp,
            change: ColumnChange::AddOptions {
                options: vec![NewOption {
                    id: option,
                    label: "Later".into(),
                }],
            },
        }],
    )
    .await;
    (option, change)
}

async fn definition(pool: &PgPool, option: OptionId) -> Uuid {
    sqlx::query_scalar!(
        "SELECT property_definition_id FROM property_options WHERE id = $1",
        option.into_uuid()
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

fn task() -> EntityReference {
    EntityReference::new(Uuid::now_v7().to_string(), EntityType::Task)
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unused_option_creation_can_be_undone(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (_, change) = add_option(&pool, &wedding).await;
    assert!(matches!(
        undo_as(&pool, &wedding, WOLF, change).await,
        UndoOutcome::Reverted { .. }
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn another_persons_selection_refuses_undo_without_writing(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (row, _) = insert_guests(&pool, &wedding).await;
    let (option, change) = add_option(&pool, &wedding).await;
    change_as(
        &pool,
        &wedding,
        JULIA,
        set_cells(
            &wedding,
            row,
            vec![CellWrite {
                column: wedding.rsvp,
                value: CellValue::Options(vec![OptionRef::Id(option)]),
            }],
        ),
    )
    .await;
    let before = table_state(&pool, wedding.table_id).await;
    let before_version = version(&pool, wedding.table_id).await;
    assert_eq!(
        undo_as(&pool, &wedding, WOLF, change).await,
        UndoOutcome::Refused {
            reason: UndoRefusal::OptionInUse,
            by: None,
        }
    );
    assert_eq!(table_state(&pool, wedding.table_id).await, before);
    assert_eq!(version(&pool, wedding.table_id).await, before_version);
    // Clearing the dependent selection makes that same undo safe again.
    change_as(
        &pool,
        &wedding,
        JULIA,
        set_cells(
            &wedding,
            row,
            vec![CellWrite {
                column: wedding.rsvp,
                value: CellValue::Clear,
            }],
        ),
    )
    .await;
    assert!(matches!(
        undo_as(&pool, &wedding, WOLF, change).await,
        UndoOutcome::Reverted { .. }
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn usage_outside_the_database_also_refuses_undo(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (option, change) = add_option(&pool, &wedding).await;
    let definition = definition(&pool, option).await;
    let properties = PropertiesPgRepo::new(pool.clone());
    let entity = task();
    let mut transaction = pool.begin().await.unwrap();
    properties
        .upsert_entity_property_in(
            &mut transaction,
            &entity,
            definition,
            Some(PropertyValue::SelectOption(vec![option.into_uuid()])),
        )
        .await
        .unwrap();
    transaction.commit().await.unwrap();
    assert_eq!(
        undo_as(&pool, &wedding, WOLF, change).await,
        UndoOutcome::Refused {
            reason: UndoRefusal::OptionInUse,
            by: None,
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn removal_waits_for_assignment_and_sees_its_committed_use(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (option, _) = add_option(&pool, &wedding).await;
    let definition = definition(&pool, option).await;
    let properties = PropertiesPgRepo::new(pool.clone());
    let mut assignment = pool.begin().await.unwrap();
    properties
        .upsert_entity_property_in(
            &mut assignment,
            &task(),
            definition,
            Some(PropertyValue::SelectOption(vec![option.into_uuid()])),
        )
        .await
        .unwrap();
    let mut removal = pool.begin().await.unwrap();
    let attempt = properties.delete_unused_option_in(&mut removal, definition, option.into_uuid());
    tokio::pin!(attempt);
    assert!(
        tokio::time::timeout(Duration::from_millis(100), attempt.as_mut())
            .await
            .is_err()
    );
    assignment.commit().await.unwrap();
    assert_eq!(
        tokio::time::timeout(Duration::from_secs(5), attempt)
            .await
            .unwrap()
            .unwrap(),
        DeleteUnusedOptionOutcome::InUse
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn assignment_waits_for_removal_and_cannot_store_a_deleted_option(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (option, _) = add_option(&pool, &wedding).await;
    let definition = definition(&pool, option).await;
    let properties = PropertiesPgRepo::new(pool.clone());
    let mut removal = pool.begin().await.unwrap();
    assert_eq!(
        properties
            .delete_unused_option_in(&mut removal, definition, option.into_uuid())
            .await
            .unwrap(),
        DeleteUnusedOptionOutcome::Deleted
    );
    let mut assignment = pool.begin().await.unwrap();
    let entity = task();
    let attempt = properties.upsert_entity_property_in(
        &mut assignment,
        &entity,
        definition,
        Some(PropertyValue::SelectOption(vec![option.into_uuid()])),
    );
    tokio::pin!(attempt);
    assert!(
        tokio::time::timeout(Duration::from_millis(100), attempt.as_mut())
            .await
            .is_err()
    );
    removal.commit().await.unwrap();
    assert!(matches!(
        tokio::time::timeout(Duration::from_secs(5), attempt)
            .await
            .unwrap(),
        Err(properties::outbound::query_error::PropertyQueryError::MissingOption(_))
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn creating_and_selecting_an_option_in_one_batch_can_be_undone(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (row, _) = insert_guests(&pool, &wedding).await;
    let before = table_state(&pool, wedding.table_id).await;
    let option = OptionId::from_uuid(Uuid::now_v7());
    let mut ops = vec![DatabaseOp::Column {
        table: wedding.table_id,
        column: wedding.rsvp,
        change: ColumnChange::AddOptions {
            options: vec![NewOption {
                id: option,
                label: "Later".into(),
            }],
        },
    }];
    ops.extend(set_cells(
        &wedding,
        row,
        vec![CellWrite {
            column: wedding.rsvp,
            value: CellValue::Options(vec![OptionRef::Id(option)]),
        }],
    ));
    let change = change_as(&pool, &wedding, WOLF, ops).await;
    assert!(matches!(
        undo_as(&pool, &wedding, WOLF, change).await,
        UndoOutcome::Reverted { .. }
    ));
    assert_eq!(table_state(&pool, wedding.table_id).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn split_option_field_updates_do_not_overwrite_a_later_label(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let change = change_as(
        &pool,
        &wedding,
        WOLF,
        vec![
            DatabaseOp::Column {
                table: wedding.table_id,
                column: wedding.rsvp,
                change: ColumnChange::UpdateOption {
                    option: wedding.yes,
                    label: Some("Going".into()),
                    color: None,
                },
            },
            DatabaseOp::Column {
                table: wedding.table_id,
                column: wedding.rsvp,
                change: ColumnChange::UpdateOption {
                    option: wedding.yes,
                    label: None,
                    color: Some(Some("#123456".into())),
                },
            },
        ],
    )
    .await;
    change_as(
        &pool,
        &wedding,
        JULIA,
        vec![DatabaseOp::Column {
            table: wedding.table_id,
            column: wedding.rsvp,
            change: ColumnChange::UpdateOption {
                option: wedding.yes,
                label: Some("Confirmed".into()),
                color: None,
            },
        }],
    )
    .await;
    assert!(matches!(
        undo_as(&pool, &wedding, WOLF, change).await,
        UndoOutcome::Refused {
            reason: UndoRefusal::ChangedSince,
            ..
        }
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_an_option_then_its_row_restores_the_option_before_the_row(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (row, _) = insert_guests(&pool, &wedding).await;
    let before = table_state(&pool, wedding.table_id).await;
    let change = change_as(
        &pool,
        &wedding,
        WOLF,
        vec![
            DatabaseOp::Column {
                table: wedding.table_id,
                column: wedding.rsvp,
                change: ColumnChange::DeleteOption {
                    option: wedding.yes,
                },
            },
            DatabaseOp::Rows {
                table: wedding.table_id,
                change: RowsChange::Delete { rows: vec![row] },
            },
        ],
    )
    .await;
    assert!(matches!(
        undo_as(&pool, &wedding, WOLF, change).await,
        UndoOutcome::Reverted { .. }
    ));
    assert_eq!(table_state(&pool, wedding.table_id).await, before);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn ordinary_deletion_waits_before_cleaning_concurrent_assignments(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (option, _) = add_option(&pool, &wedding).await;
    let definition = definition(&pool, option).await;
    let properties = PropertiesPgRepo::new(pool.clone());
    let entity = task();
    let mut assignment = pool.begin().await.unwrap();
    properties
        .upsert_entity_property_in(
            &mut assignment,
            &entity,
            definition,
            Some(PropertyValue::SelectOption(vec![option.into_uuid()])),
        )
        .await
        .unwrap();
    let mut removal = pool.begin().await.unwrap();
    {
        let attempt = properties.delete_option_in(&mut removal, definition, option.into_uuid());
        tokio::pin!(attempt);
        assert!(
            tokio::time::timeout(Duration::from_millis(100), attempt.as_mut())
                .await
                .is_err()
        );
        assignment.commit().await.unwrap();
        assert!(
            tokio::time::timeout(Duration::from_secs(5), attempt)
                .await
                .unwrap()
                .unwrap()
        );
    }
    removal.commit().await.unwrap();
    let mut read = pool.begin().await.unwrap();
    let values = properties
        .entity_values_in(
            &mut read,
            EntityType::Task,
            &[entity.entity_id],
            Some(&[definition]),
        )
        .await
        .unwrap();
    assert!(values.iter().all(|(_, _, value)| !matches!(value, PropertyValue::SelectOption(ids) if ids.contains(option.as_uuid()))));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_inverse_is_refused_without_replaying_missing_metadata(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (_, change) = add_option(&pool, &wedding).await;
    sqlx::query!(
        "UPDATE database_changes SET inverse = inverse - 'formatVersion' WHERE id = $1",
        change.0
    )
    .execute(&pool)
    .await
    .unwrap();
    assert_eq!(
        undo_as(&pool, &wedding, WOLF, change).await,
        UndoOutcome::Refused {
            reason: UndoRefusal::NotUndoable,
            by: None
        }
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn shared_option_deletion_does_not_claim_a_complete_undo(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (option, _) = add_option(&pool, &wedding).await;
    let definition = definition(&pool, option).await;
    let properties = PropertiesPgRepo::new(pool.clone());
    let mut transaction = pool.begin().await.unwrap();
    properties
        .upsert_entity_property_in(
            &mut transaction,
            &task(),
            definition,
            Some(PropertyValue::SelectOption(vec![option.into_uuid()])),
        )
        .await
        .unwrap();
    transaction.commit().await.unwrap();
    let deletion = change_as(
        &pool,
        &wedding,
        WOLF,
        vec![DatabaseOp::Column {
            table: wedding.table_id,
            column: wedding.rsvp,
            change: ColumnChange::DeleteOption { option },
        }],
    )
    .await;
    assert_eq!(
        undo_as(&pool, &wedding, WOLF, deletion).await,
        UndoOutcome::Refused {
            reason: UndoRefusal::NotUndoable,
            by: None
        }
    );
}
