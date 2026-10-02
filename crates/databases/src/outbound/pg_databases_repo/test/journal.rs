//! The change journal over Postgres, on the guest list the owner was shown:
//! what each committed batch records, a row's history, and that each
//! change's inverse puts the table back as it was.

use std::collections::{BTreeMap, HashMap};

use chrono::DateTime;
use entity_access::domain::models::{
    AccessLevel, EditAccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType,
    ViewAccessLevel,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnKind, DatabaseOp, NewColumn, NewOption, OpResult,
    OptionId, OptionRef, RowChange, RowChanges, RowsChange, RowsResult,
};
use properties::outbound::properties_pg_repo::PropertiesPgRepo;
use serde_json::json;
use sqlx::PgPool;

use super::apply_ops::{insert_named_user, service};
use crate::domain::journal::{ChangeInverse, RowChangeKind, RowHistoryEntry};
use crate::domain::models::{
    ChangeId, ColumnId, CreateDatabase, DatabaseId, OpBatch, RowId, TableId, TableVersion, Viewer,
};
use crate::domain::ports::{CellStore, DatabasesRepo, DatabasesService};
use crate::outbound::pg_cell_store::PgCellStore;
use crate::outbound::pg_databases_repo::PgDatabasesRepo;

pub(super) const WOLF: &str = "macro|wolf@macro.com";
pub(super) const JULIA: &str = "macro|julia@macro.com";

pub(super) fn user(id: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap().into_owned()
}

pub(super) fn person(id: &str) -> Viewer {
    Viewer {
        user_id: user(id),
        acting_bot: None,
    }
}

pub(super) fn edit_as(id: &str, database_id: DatabaseId) -> EntityAccessReceipt<EditAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(id),
        Entity {
            entity_id: database_id.to_string(),
            entity_type: EntityType::Database,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::Edit,
        },
    )
    .unwrap()
}

pub(super) fn view_as(id: &str, database_id: DatabaseId) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        user(id),
        Entity {
            entity_id: database_id.to_string(),
            entity_type: EntityType::Database,
        },
        EntityPermission::AccessLevel {
            access_level: AccessLevel::View,
        },
    )
    .unwrap()
}

/// Wolf's wedding database: `Guests(Name, RSVP[Yes, No, Maybe], Plus Ones)`,
/// its two columns added in one batch, the journal's first change.
pub(super) struct Wedding {
    pub(super) database_id: DatabaseId,
    pub(super) table_id: TableId,
    pub(super) name: ColumnId,
    pub(super) rsvp: ColumnId,
    pub(super) plus_ones: ColumnId,
    pub(super) plus_ones_definition: uuid::Uuid,
    pub(super) yes: OptionId,
    pub(super) no: OptionId,
    pub(super) maybe: OptionId,
}

pub(super) async fn wedding(pool: &PgPool) -> Wedding {
    insert_named_user(pool, WOLF).await;
    insert_named_user(pool, JULIA).await;
    let service = service(pool);
    let database = service
        .create_database(CreateDatabase {
            name: "Wedding".into(),
            owner_id: user(WOLF),
            acting_bot: None,
        })
        .await
        .unwrap();
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let table_id = repo.get_database(database.id).await.unwrap().unwrap().1[0].id;
    let name = repo.columns_for_tables(&[table_id]).await.unwrap()[0].id;
    let (rsvp, plus_ones) = (ColumnId::new(), ColumnId::new());
    let (yes, no, maybe) = (OptionId::new(), OptionId::new(), OptionId::new());
    service
        .apply_ops(
            edit_as(WOLF, database.id),
            person(WOLF),
            vec![
                DatabaseOp::Column {
                    table: table_id,
                    column: rsvp,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "RSVP".into(),
                            kind: ColumnKind::Select { multi: false },
                            options: vec![
                                NewOption {
                                    id: yes,
                                    label: "Yes".into(),
                                },
                                NewOption {
                                    id: no,
                                    label: "No".into(),
                                },
                                NewOption {
                                    id: maybe,
                                    label: "Maybe".into(),
                                },
                            ],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
                DatabaseOp::Column {
                    table: table_id,
                    column: plus_ones,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Plus Ones".into(),
                            kind: ColumnKind::Number,
                            options: Vec::new(),
                            infer_type: false,
                        },
                        after: None,
                    },
                },
            ]
            .into(),
        )
        .await
        .unwrap();
    let plus_ones_definition = repo
        .columns_for_tables(&[table_id])
        .await
        .unwrap()
        .into_iter()
        .find(|column| column.id == plus_ones)
        .unwrap()
        .property_definition_id;
    Wedding {
        database_id: database.id,
        table_id,
        name,
        rsvp,
        plus_ones,
        plus_ones_definition,
        yes,
        no,
        maybe,
    }
}

/// Step 1: Wolf inserts Maria (RSVP Yes, Plus Ones 1) and Omar (RSVP No).
pub(super) async fn insert_guests(pool: &PgPool, wedding: &Wedding) -> (RowId, RowId) {
    let results = service(pool)
        .apply_ops(
            edit_as(WOLF, wedding.database_id),
            person(WOLF),
            vec![DatabaseOp::Rows {
                table: wedding.table_id,
                change: RowsChange::Insert {
                    rows: vec![
                        vec![
                            CellWrite {
                                column: wedding.name,
                                value: CellValue::Text("Maria".into()),
                            },
                            CellWrite {
                                column: wedding.rsvp,
                                value: CellValue::Options(vec![OptionRef::Id(wedding.yes)]),
                            },
                            CellWrite {
                                column: wedding.plus_ones,
                                value: CellValue::Number(1.0),
                            },
                        ],
                        vec![
                            CellWrite {
                                column: wedding.name,
                                value: CellValue::Text("Omar".into()),
                            },
                            CellWrite {
                                column: wedding.rsvp,
                                value: CellValue::Options(vec![OptionRef::Id(wedding.no)]),
                            },
                        ],
                    ],
                },
            }]
            .into(),
        )
        .await
        .unwrap();
    let [
        OpResult::Rows {
            change: RowsResult::Inserted { rows },
            ..
        },
    ] = results.as_slice()
    else {
        panic!("an insert answers its rows: {results:?}");
    };
    (rows[0], rows[1])
}

/// Step 2: Julia sets Maria's RSVP to Maybe.
pub(super) async fn julia_says_maybe(pool: &PgPool, wedding: &Wedding, maria: RowId) {
    service(pool)
        .apply_ops(
            edit_as(JULIA, wedding.database_id),
            person(JULIA),
            vec![DatabaseOp::Rows {
                table: wedding.table_id,
                change: RowsChange::Update {
                    changes: RowChanges::PerRow {
                        rows: vec![RowChange {
                            row: maria,
                            cells: vec![CellWrite {
                                column: wedding.rsvp,
                                value: CellValue::Options(vec![OptionRef::Id(wedding.maybe)]),
                            }],
                        }],
                    },
                },
            }]
            .into(),
        )
        .await
        .unwrap();
}

/// Step 3: Julia deletes Omar.
pub(super) async fn julia_deletes_omar(pool: &PgPool, wedding: &Wedding, omar: RowId) {
    service(pool)
        .apply_ops(
            edit_as(JULIA, wedding.database_id),
            person(JULIA),
            vec![DatabaseOp::Rows {
                table: wedding.table_id,
                change: RowsChange::Delete { rows: vec![omar] },
            }]
            .into(),
        )
        .await
        .unwrap();
}

/// Step 4: Wolf deletes the Plus Ones column.
pub(super) async fn wolf_deletes_plus_ones(pool: &PgPool, wedding: &Wedding) {
    service(pool)
        .apply_ops(
            edit_as(WOLF, wedding.database_id),
            person(WOLF),
            vec![DatabaseOp::Column {
                table: wedding.table_id,
                column: wedding.plus_ones,
                change: ColumnChange::Delete,
            }]
            .into(),
        )
        .await
        .unwrap();
}

async fn position_of(pool: &PgPool, table: TableId, row: RowId) -> String {
    PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
        .row_refs(table)
        .await
        .unwrap()
        .into_iter()
        .find(|stored| stored.id == row)
        .unwrap()
        .position
        .to_string()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn every_committed_batch_of_the_guest_list_is_journaled_with_its_inverse(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (maria, omar) = insert_guests(&pool, &wedding).await;
    julia_says_maybe(&pool, &wedding, maria).await;
    let omar_position = position_of(&pool, wedding.table_id, omar).await;
    julia_deletes_omar(&pool, &wedding, omar).await;
    wolf_deletes_plus_ones(&pool, &wedding).await;

    let changes = sqlx::query!(
        r#"SELECT id, database_id, table_id, version, actor, acting_bot, ops, inverse
           FROM database_changes ORDER BY id"#
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let changes: Vec<_> = changes
        .into_iter()
        .map(|change| {
            (
                change.id,
                change.database_id,
                change.table_id,
                change.version,
                change.actor,
                change.acting_bot,
                change.ops,
                change.inverse,
            )
        })
        .collect();
    let (database, table) = (
        wedding.database_id.into_uuid(),
        wedding.table_id.into_uuid(),
    );
    let maria_cells = json!({
        wedding.name.to_string(): {"type": "text", "value": "Maria"},
        wedding.rsvp.to_string(): {"type": "options", "value": [{"id": wedding.yes}]},
        wedding.plus_ones.to_string(): {"type": "number", "value": 1.0},
    });
    let omar_cells = json!({
        wedding.name.to_string(): {"type": "text", "value": "Omar"},
        wedding.rsvp.to_string(): {"type": "options", "value": [{"id": wedding.no}]},
    });
    assert_eq!(
        changes[1..].to_vec(),
        vec![
            (
                2,
                database,
                table,
                2,
                Some(WOLF.to_string()),
                None,
                json!([{
                    "kind": "rows",
                    "table": wedding.table_id,
                    "change": {"kind": "insert", "rows": [
                        [
                            {"column": wedding.name, "value": {"type": "text", "value": "Maria"}},
                            {"column": wedding.rsvp, "value": {"type": "options", "value": [{"id": wedding.yes}]}},
                            {"column": wedding.plus_ones, "value": {"type": "number", "value": 1.0}},
                        ],
                        [
                            {"column": wedding.name, "value": {"type": "text", "value": "Omar"}},
                            {"column": wedding.rsvp, "value": {"type": "options", "value": [{"id": wedding.no}]}},
                        ],
                    ]},
                }]),
                json!({
                    "formatVersion": 1,
                    "incomplete": false,
                    "ops": [{
                        "kind": "rows",
                        "table": wedding.table_id,
                        "change": {"kind": "delete", "rows": [maria, omar]},
                    }],
                    "before": {"cells": {}},
                    "after": {"cells": {
                        maria.to_string(): maria_cells,
                        omar.to_string(): omar_cells,
                    }},
                }),
            ),
            (
                3,
                database,
                table,
                3,
                Some(JULIA.to_string()),
                None,
                json!([{
                    "kind": "rows",
                    "table": wedding.table_id,
                    "change": {"kind": "update", "changes": {"kind": "per_row", "rows": [{
                        "row": maria,
                        "cells": [{"column": wedding.rsvp, "value": {"type": "options", "value": [{"id": wedding.maybe}]}}],
                    }]}},
                }]),
                json!({
                    "formatVersion": 1,
                    "incomplete": false,
                    "ops": [{
                        "kind": "rows",
                        "table": wedding.table_id,
                        "change": {"kind": "update", "changes": {"kind": "per_row", "rows": [{
                            "row": maria,
                            "cells": [{"column": wedding.rsvp, "value": {"type": "options", "value": [{"id": wedding.yes}]}}],
                        }]}},
                    }],
                    "before": {"cells": {maria.to_string(): maria_cells}},
                    "after": {"cells": {maria.to_string(): {
                        wedding.rsvp.to_string(): {"type": "options", "value": [{"id": wedding.maybe}]},
                    }}},
                }),
            ),
            (
                4,
                database,
                table,
                4,
                Some(JULIA.to_string()),
                None,
                json!([{
                    "kind": "rows",
                    "table": wedding.table_id,
                    "change": {"kind": "delete", "rows": [omar]},
                }]),
                json!({
                    "formatVersion": 1,
                    "incomplete": false,
                    "ops": [{
                        "kind": "rows",
                        "table": wedding.table_id,
                        "change": {"kind": "insert", "rows": [[
                            {"column": wedding.name, "value": {"type": "text", "value": "Omar"}},
                            {"column": wedding.rsvp, "value": {"type": "options", "value": [{"id": wedding.no}]}},
                        ]]},
                    }],
                    "restoredRows": {"0": [{"id": omar, "position": omar_position}]},
                    "before": {"cells": {omar.to_string(): omar_cells}},
                    "after": {"cells": {}},
                }),
            ),
            (
                5,
                database,
                table,
                5,
                Some(WOLF.to_string()),
                None,
                json!([{
                    "kind": "column",
                    "table": wedding.table_id,
                    "column": wedding.plus_ones,
                    "change": {"kind": "delete"},
                }]),
                json!({
                    "formatVersion": 1,
                    "incomplete": false,
                    "restoredColumns": {wedding.plus_ones.to_string(): {"kind": {"type": "number"}, "infer_type": false}},
                    "ops": [
                        {
                            "kind": "column",
                            "table": wedding.table_id,
                            "column": wedding.plus_ones,
                            "change": {"kind": "create", "definition": {
                                "source": "existing",
                                "property": wedding.plus_ones_definition,
                            }},
                        },
                        {
                            "kind": "rows",
                            "table": wedding.table_id,
                            "change": {"kind": "update", "changes": {"kind": "per_row", "rows": [{
                                "row": maria,
                                "cells": [{"column": wedding.plus_ones, "value": {"type": "number", "value": 1.0}}],
                            }]}},
                        },
                        {
                            "kind": "table",
                            "table": wedding.table_id,
                            "change": {"kind": "reorder_columns", "order": [wedding.name, wedding.rsvp, wedding.plus_ones]},
                        },
                    ],
                    "before": {"cells": {maria.to_string(): {
                        wedding.plus_ones.to_string(): {"type": "number", "value": 1.0},
                    }}},
                    "after": {"cells": {}},
                }),
            ),
        ]
    );

    let rows = sqlx::query!(
        r#"SELECT change_id, row_id, kind, columns FROM database_change_rows
           ORDER BY change_id, row_id"#
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let rows: Vec<_> = rows
        .into_iter()
        .map(|row| (row.change_id, row.row_id, row.kind, row.columns))
        .collect();
    let mut inserted = vec![
        (
            2,
            maria.into_uuid(),
            "insert".to_string(),
            vec![
                wedding.name.into_uuid(),
                wedding.rsvp.into_uuid(),
                wedding.plus_ones.into_uuid(),
            ],
        ),
        (
            2,
            omar.into_uuid(),
            "insert".to_string(),
            vec![wedding.name.into_uuid(), wedding.rsvp.into_uuid()],
        ),
    ];
    inserted.sort_by_key(|(_, row, _, _)| *row);
    let mut expected = inserted;
    expected.extend([
        (
            3,
            maria.into_uuid(),
            "update".to_string(),
            vec![wedding.rsvp.into_uuid()],
        ),
        (
            4,
            omar.into_uuid(),
            "delete".to_string(),
            vec![wedding.name.into_uuid(), wedding.rsvp.into_uuid()],
        ),
        (
            5,
            maria.into_uuid(),
            "update".to_string(),
            vec![wedding.plus_ones.into_uuid()],
        ),
    ]);
    assert_eq!(rows, expected);

    let columns = sqlx::query!(
        r#"SELECT change_id, column_id, kind FROM database_change_columns ORDER BY change_id, kind"#
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let columns: Vec<_> = columns
        .into_iter()
        .map(|column| (column.change_id, column.column_id, column.kind))
        .collect();
    assert_eq!(
        columns,
        vec![
            (1, wedding.rsvp.into_uuid(), "create".to_string()),
            (1, wedding.plus_ones.into_uuid(), "create".to_string()),
            (5, wedding.plus_ones.into_uuid(), "delete".to_string()),
        ]
    );

    let updated_by = sqlx::query_scalar!(
        "SELECT updated_by FROM database_rows WHERE id = $1",
        maria.into_uuid()
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(updated_by.as_deref(), Some(JULIA));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_rows_history_reads_newest_first_even_after_the_row_is_deleted(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let (maria, omar) = insert_guests(&pool, &wedding).await;
    julia_says_maybe(&pool, &wedding, maria).await;
    julia_deletes_omar(&pool, &wedding, omar).await;
    wolf_deletes_plus_ones(&pool, &wedding).await;
    let service = service(&pool);
    let without_time = |entries: Vec<RowHistoryEntry>| -> Vec<RowHistoryEntry> {
        entries
            .into_iter()
            .map(|entry| RowHistoryEntry {
                at: DateTime::UNIX_EPOCH,
                ..entry
            })
            .collect()
    };

    let maria_history = service
        .row_history(view_as(WOLF, wedding.database_id), wedding.table_id, maria)
        .await
        .unwrap();
    let omar_history = service
        .row_history(view_as(WOLF, wedding.database_id), wedding.table_id, omar)
        .await
        .unwrap();

    assert_eq!(
        without_time(maria_history),
        vec![
            RowHistoryEntry {
                change: ChangeId(5),
                version: TableVersion(5),
                actor: Some(WOLF.into()),
                acting_bot: None,
                at: DateTime::UNIX_EPOCH,
                kind: RowChangeKind::Update,
                columns: vec![wedding.plus_ones],
                before: BTreeMap::from([(wedding.plus_ones, CellValue::Number(1.0))]),
                after: BTreeMap::new(),
            },
            RowHistoryEntry {
                change: ChangeId(3),
                version: TableVersion(3),
                actor: Some(JULIA.into()),
                acting_bot: None,
                at: DateTime::UNIX_EPOCH,
                kind: RowChangeKind::Update,
                columns: vec![wedding.rsvp],
                before: BTreeMap::from([(
                    wedding.rsvp,
                    CellValue::Options(vec![OptionRef::Id(wedding.yes)])
                )]),
                after: BTreeMap::from([(
                    wedding.rsvp,
                    CellValue::Options(vec![OptionRef::Id(wedding.maybe)])
                )]),
            },
            RowHistoryEntry {
                change: ChangeId(2),
                version: TableVersion(2),
                actor: Some(WOLF.into()),
                acting_bot: None,
                at: DateTime::UNIX_EPOCH,
                kind: RowChangeKind::Insert,
                columns: vec![wedding.name, wedding.rsvp, wedding.plus_ones],
                before: BTreeMap::new(),
                after: BTreeMap::from([
                    (wedding.name, CellValue::Text("Maria".into())),
                    (
                        wedding.rsvp,
                        CellValue::Options(vec![OptionRef::Id(wedding.yes)])
                    ),
                    (wedding.plus_ones, CellValue::Number(1.0)),
                ]),
            },
        ]
    );
    assert_eq!(
        without_time(omar_history),
        vec![
            RowHistoryEntry {
                change: ChangeId(4),
                version: TableVersion(4),
                actor: Some(JULIA.into()),
                acting_bot: None,
                at: DateTime::UNIX_EPOCH,
                kind: RowChangeKind::Delete,
                columns: vec![wedding.name, wedding.rsvp],
                before: BTreeMap::from([
                    (wedding.name, CellValue::Text("Omar".into())),
                    (
                        wedding.rsvp,
                        CellValue::Options(vec![OptionRef::Id(wedding.no)])
                    ),
                ]),
                after: BTreeMap::new(),
            },
            RowHistoryEntry {
                change: ChangeId(2),
                version: TableVersion(2),
                actor: Some(WOLF.into()),
                acting_bot: None,
                at: DateTime::UNIX_EPOCH,
                kind: RowChangeKind::Insert,
                columns: vec![wedding.name, wedding.rsvp],
                before: BTreeMap::new(),
                after: BTreeMap::from([
                    (wedding.name, CellValue::Text("Omar".into())),
                    (
                        wedding.rsvp,
                        CellValue::Options(vec![OptionRef::Id(wedding.no)])
                    ),
                ]),
            },
        ]
    );
}

/// The table as a reader sees it: its columns in order, each with its
/// definition and name, and its rows in order with their cells.
#[derive(Debug, PartialEq)]
pub(super) struct TableState {
    pub(super) columns: Vec<(ColumnId, uuid::Uuid, Option<String>)>,
    pub(super) rows: Vec<(RowId, String, BTreeMap<uuid::Uuid, serde_json::Value>)>,
}

pub(super) async fn table_state(pool: &PgPool, table: TableId) -> TableState {
    let repo = PgDatabasesRepo::new(pool.clone(), PropertiesPgRepo::new(pool.clone()));
    let columns = repo
        .columns_for_tables(&[table])
        .await
        .unwrap()
        .into_iter()
        .map(|column| {
            (
                column.id,
                column.property_definition_id,
                column.display_name,
            )
        })
        .collect();
    let rows = repo.row_refs(table).await.unwrap();
    let ids: Vec<RowId> = rows.iter().map(|row| row.id).collect();
    let mut cells: HashMap<RowId, HashMap<uuid::Uuid, _>> =
        PgCellStore::new(pool.clone(), PropertiesPgRepo::new(pool.clone()))
            .cells(&ids)
            .await
            .unwrap();
    TableState {
        columns,
        rows: rows
            .into_iter()
            .map(|row| {
                let cells = cells
                    .remove(&row.id)
                    .unwrap_or_default()
                    .into_iter()
                    .map(|(definition, value)| (definition, serde_json::to_value(value).unwrap()))
                    .collect();
                (row.id, row.position.to_string(), cells)
            })
            .collect(),
    }
}

async fn inverse_of(pool: &PgPool, change: i64) -> ChangeInverse {
    let inverse = sqlx::query_scalar!("SELECT inverse FROM database_changes WHERE id = $1", change)
        .fetch_one(pool)
        .await
        .unwrap();
    serde_json::from_value(inverse).unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn applying_each_inverse_newest_first_puts_the_table_back_as_it_was(pool: PgPool) {
    let wedding = wedding(&pool).await;
    let empty = table_state(&pool, wedding.table_id).await;
    let (maria, omar) = insert_guests(&pool, &wedding).await;
    let inserted = table_state(&pool, wedding.table_id).await;
    julia_says_maybe(&pool, &wedding, maria).await;
    let maybe = table_state(&pool, wedding.table_id).await;
    julia_deletes_omar(&pool, &wedding, omar).await;
    let without_omar = table_state(&pool, wedding.table_id).await;
    wolf_deletes_plus_ones(&pool, &wedding).await;
    let service = service(&pool);

    let mut restored = Vec::new();
    for change in [5, 4, 3, 2] {
        let inverse = inverse_of(&pool, change).await;
        service
            .apply_batch(
                &edit_as(WOLF, wedding.database_id),
                &person(WOLF),
                &OpBatch::from(inverse.ops.clone()),
                &inverse.restoration(),
            )
            .await
            .unwrap();
        restored.push(table_state(&pool, wedding.table_id).await);
    }

    assert_eq!(restored, vec![without_omar, maybe, inserted, empty]);
}
