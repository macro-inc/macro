//! Column renames through the ops over Postgres: a rename relabels one
//! placement, and of two at once exactly one wins.

use models_databases::{
    ColumnChange, ColumnResult, DatabaseOp, NewColumn, OpResult, PropertyId, TableChange,
};

use super::apply_ops::{edit, guests, service, version, viewer};
use super::*;
use crate::domain::models::{DatabaseError, OpBatch, OpRefusal, SchemaError};
use crate::domain::ports::{DatabasesRepo, DatabasesService};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_column_rename_relabels_that_placement_alone_and_checks_what_the_caller_saw(
    pool: PgPool,
) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let hosts = TableId::new();
    let host_name = ColumnId::new();
    service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![
                DatabaseOp::Table {
                    table: hosts,
                    change: TableChange::Create {
                        name: "Hosts".into(),
                    },
                },
                DatabaseOp::Column {
                    table: hosts,
                    column: host_name,
                    change: ColumnChange::Create {
                        definition: NewColumn::Existing {
                            property: PropertyId::from_uuid(guests.name_definition),
                        },
                        after: None,
                    },
                },
            ]
            .into(),
        )
        .await
        .unwrap();
    let before = version(&pool, guests.table_id).await;

    let renamed = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Column {
                table: guests.table_id,
                column: guests.name,
                change: ColumnChange::Rename {
                    name: "Task".into(),
                    previous_name: Some("Name".into()),
                },
            }]
            .into(),
        )
        .await
        .unwrap();

    let after = TableVersion(before.0 + 1);
    assert_eq!(
        renamed,
        vec![OpResult::Column {
            table: guests.table_id,
            column: guests.name,
            table_version: after,
            change: ColumnResult::Renamed,
        }]
    );
    let stored = repo
        .columns_for_tables(&[guests.table_id])
        .await
        .unwrap()
        .into_iter()
        .find(|column| column.id == guests.name)
        .unwrap();
    assert_eq!(stored.display_name.as_deref(), Some("Task"));
    assert_eq!(stored.property_definition_id, guests.name_definition);
    let other = repo.columns_for_tables(&[hosts]).await.unwrap().remove(0);
    assert_eq!(other.id, host_name);
    assert_eq!(other.property_definition_id, guests.name_definition);
    assert!(other.display_name.is_none());

    let stale = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            OpBatch {
                ops: vec![DatabaseOp::Column {
                    table: guests.table_id,
                    column: guests.name,
                    change: ColumnChange::Rename {
                        name: "Stale".into(),
                        previous_name: None,
                    },
                }],
                base_versions: HashMap::from([(guests.table_id, before)]),
            },
        )
        .await
        .unwrap_err();
    assert!(
        matches!(stale, DatabaseError::VersionConflict),
        "expected a version conflict, got {stale:?}"
    );
    // The current version alone does not license overwriting another label.
    let elsewhere = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            OpBatch {
                ops: vec![DatabaseOp::Column {
                    table: guests.table_id,
                    column: guests.name,
                    change: ColumnChange::Rename {
                        name: "Wrong previous".into(),
                        previous_name: Some("Name".into()),
                    },
                }],
                base_versions: HashMap::from([(guests.table_id, after)]),
            },
        )
        .await
        .unwrap_err();
    let DatabaseError::InvalidOp(refusal) = elsewhere else {
        panic!("expected a refused op, got {elsewhere:?}");
    };
    assert_eq!(
        refusal,
        OpRefusal {
            op: 0,
            row: None,
            column: Some(guests.name),
            taken: None,
            reason: SchemaError::ColumnRenamedElsewhere.to_string(),
        }
    );

    let next = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Column {
                table: guests.table_id,
                column: guests.name,
                change: ColumnChange::Rename {
                    name: "Work item".into(),
                    previous_name: Some("Task".into()),
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    assert_eq!(
        next,
        vec![OpResult::Column {
            table: guests.table_id,
            column: guests.name,
            table_version: TableVersion(after.0 + 1),
            change: ColumnResult::Renamed,
        }]
    );
    assert_eq!(
        repo.columns_for_tables(&[guests.table_id])
            .await
            .unwrap()
            .into_iter()
            .find(|column| column.id == guests.name)
            .unwrap()
            .display_name
            .as_deref(),
        Some("Work item")
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_column_renames_have_exactly_one_winner(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let before = version(&pool, guests.table_id).await;
    let rename = |name: &str| {
        service.apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Column {
                table: guests.table_id,
                column: guests.name,
                change: ColumnChange::Rename {
                    name: name.into(),
                    previous_name: Some("Name".into()),
                },
            }]
            .into(),
        )
    };

    let (task, work_item) = tokio::join!(rename("Task"), rename("Work item"));

    assert_ne!(task.is_ok(), work_item.is_ok());
    let winner = if task.is_ok() { "Task" } else { "Work item" };
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let stored = repo
        .columns_for_tables(&[guests.table_id])
        .await
        .unwrap()
        .into_iter()
        .find(|column| column.id == guests.name)
        .unwrap();
    assert_eq!(stored.display_name.as_deref(), Some(winner));
    assert_eq!(
        version(&pool, guests.table_id).await,
        TableVersion(before.0 + 1)
    );

    repo.trash_database(guests.database_id, chrono::Utc::now())
        .await
        .unwrap();
    let hidden = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Column {
                table: guests.table_id,
                column: guests.name,
                change: ColumnChange::Rename {
                    name: "Hidden".into(),
                    previous_name: Some(winner.into()),
                },
            }]
            .into(),
        )
        .await
        .unwrap_err();
    assert!(
        matches!(hidden, DatabaseError::NotFound),
        "expected the trashed database to be gone, got {hidden:?}"
    );
}
