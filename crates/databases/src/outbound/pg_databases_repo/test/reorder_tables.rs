//! Reordering a database's tables through the ops over Postgres.

use models_databases::{DatabaseOp, OpResult, TableChange, VersionedTable};

use super::apply_ops::{edit, guests, service, viewer};
use super::*;
use crate::domain::models::{DatabaseError, OpRefusal, SchemaError};
use crate::domain::ports::{DatabasesRepo, DatabasesService};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reordering_three_tables_rewrites_every_position_and_reads_back_in_order(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let (hosts, budget) = (TableId::new(), TableId::new());
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
                DatabaseOp::Table {
                    table: budget,
                    change: TableChange::Create {
                        name: "Budget".into(),
                    },
                },
            ]
            .into(),
        )
        .await
        .unwrap();
    let (_, before) = repo
        .get_database(guests.database_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        before.iter().map(|t| t.name.as_str()).collect::<Vec<_>>(),
        vec!["Table 1", "Hosts", "Budget"]
    );

    let results = service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::ReorderTables {
                order: vec![budget, guests.table_id, hosts],
            }]
            .into(),
        )
        .await
        .unwrap();

    assert_eq!(
        results,
        vec![OpResult::ReorderTables {
            tables: vec![
                VersionedTable {
                    table: budget,
                    version: TableVersion(before[2].version.0 + 1),
                },
                VersionedTable {
                    table: guests.table_id,
                    version: TableVersion(before[0].version.0 + 1),
                },
                VersionedTable {
                    table: hosts,
                    version: TableVersion(before[1].version.0 + 1),
                },
            ],
        }]
    );
    let (_, after) = repo
        .get_database(guests.database_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        after
            .iter()
            .map(|t| (t.name.as_str(), t.position.as_str()))
            .collect::<Vec<_>>(),
        vec![("Budget", "7f80"), ("Table 1", "80"), ("Hosts", "8180")]
    );

    // A table created afterwards still lands at the end.
    let notes = TableId::new();
    service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Table {
                table: notes,
                change: TableChange::Create {
                    name: "Notes".into(),
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    let (_, tables) = repo
        .get_database(guests.database_id)
        .await
        .unwrap()
        .unwrap();
    let notes = tables.iter().find(|table| table.id == notes).unwrap();
    assert_eq!(notes.position.as_str(), "8280");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_order_missing_or_repeating_a_table_is_refused_and_changes_nothing(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let hosts = TableId::new();
    service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::Table {
                table: hosts,
                change: TableChange::Create {
                    name: "Hosts".into(),
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    let (_, before) = repo
        .get_database(guests.database_id)
        .await
        .unwrap()
        .unwrap();

    for order in [vec![hosts], vec![hosts, hosts]] {
        let refused = service
            .apply_ops(
                edit(guests.database_id),
                viewer(),
                vec![DatabaseOp::ReorderTables { order }].into(),
            )
            .await
            .unwrap_err();
        let DatabaseError::InvalidOp(refusal) = refused else {
            panic!("expected a refused op, got {refused:?}");
        };
        assert_eq!(
            refusal,
            OpRefusal {
                op: 0,
                row: None,
                column: None,
                taken: None,
                reason: SchemaError::IncompleteTableOrder.to_string(),
            }
        );
    }

    let (_, after) = repo
        .get_database(guests.database_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        after
            .iter()
            .map(|t| (t.id, t.position.as_str(), t.version))
            .collect::<Vec<_>>(),
        before
            .iter()
            .map(|t| (t.id, t.position.as_str(), t.version))
            .collect::<Vec<_>>()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_order_naming_another_databases_table_is_refused_and_changes_neither(pool: PgPool) {
    let guests = guests(&pool).await;
    let service = service(&pool);
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let other = service
        .create_database(CreateDatabase {
            name: "Hiring".into(),
            owner_id: viewer().user_id,
            acting_bot: None,
        })
        .await
        .unwrap();
    let (_, before) = repo
        .get_database(guests.database_id)
        .await
        .unwrap()
        .unwrap();
    let (_, other_before) = repo.get_database(other.id).await.unwrap().unwrap();
    let candidates = other_before[0].id;

    for order in [vec![candidates], vec![guests.table_id, candidates]] {
        let refused = service
            .apply_ops(
                edit(guests.database_id),
                viewer(),
                vec![DatabaseOp::ReorderTables { order }].into(),
            )
            .await
            .unwrap_err();
        let DatabaseError::InvalidOp(refusal) = refused else {
            panic!("expected a refused op, got {refused:?}");
        };
        assert_eq!(
            refusal,
            OpRefusal {
                op: 0,
                row: None,
                column: None,
                taken: None,
                reason: format!("table {candidates} is not in this database"),
            }
        );
    }

    let (_, after) = repo
        .get_database(guests.database_id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        after
            .iter()
            .map(|t| (t.id, t.position.as_str(), t.version))
            .collect::<Vec<_>>(),
        before
            .iter()
            .map(|t| (t.id, t.position.as_str(), t.version))
            .collect::<Vec<_>>()
    );
    let (_, other_after) = repo.get_database(other.id).await.unwrap().unwrap();
    assert_eq!(other_after[0].position, other_before[0].position);
    assert_eq!(other_after[0].version, other_before[0].version);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reordering_a_trashed_databases_tables_is_not_found(pool: PgPool) {
    let guests = guests(&pool).await;
    PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .trash_database(guests.database_id, chrono::Utc::now())
        .await
        .unwrap();

    let refused = service(&pool)
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::ReorderTables {
                order: vec![guests.table_id],
            }]
            .into(),
        )
        .await
        .unwrap_err();

    assert!(
        matches!(refused, DatabaseError::NotFound),
        "expected the trashed database to be gone, got {refused:?}"
    );
}
