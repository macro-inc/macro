//! Duplicating a database over Postgres: the copy, its owner's grant and
//! everything in it commit together, or none of it does.

use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType, ViewAccessLevel,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_databases::views::{LaneKey, NewView, ViewLayout, ViewQuery};
use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnKind, DatabaseOp, NewColumn, OpResult, OptionRef,
    RowsChange, RowsResult, TableChange, ViewChange,
};
use models_properties::service::property_value::PropertyValue;
use models_properties::shared::{EntityReference, EntityType as PropertyEntityType};
use sqlx::PgPool;

use super::apply_ops::{cells, edit, guests, insert_named_user, service, viewer};
use crate::domain::duplicate::{DatabaseDuplicateRepo, DatabaseDuplicateService};
use crate::domain::journal::JournalPlan;
use crate::domain::models::{
    ColumnConfig, ColumnId, Database, DatabaseId, RowId, TableId, ViewId, Write, Writes,
    WritesOutcome,
};
use crate::domain::ports::{CellStore, ColumnDefinitionStore, DatabasesService};

const DUPLICATOR: &str = "macro|duplicator@macro.com";

fn duplicator() -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(DUPLICATOR)
        .unwrap()
        .into_owned()
}

fn view(database_id: DatabaseId) -> EntityAccessReceipt<ViewAccessLevel> {
    EntityAccessReceipt::try_new_authenticated_user(
        duplicator(),
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

fn inserted(results: &[OpResult]) -> Vec<RowId> {
    results
        .iter()
        .find_map(|result| match result {
            OpResult::Rows {
                change: RowsResult::Inserted { rows },
                ..
            } => Some(rows.clone()),
            _ => None,
        })
        .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_duplicate_copies_tables_columns_rows_relations_and_boards(pool: PgPool) {
    let guests = guests(&pool).await;
    insert_named_user(&pool, DUPLICATOR).await;
    let service = service(&pool);
    let (sessions, title, relation, board) = (
        TableId::new(),
        ColumnId::new(),
        ColumnId::new(),
        ViewId::new(),
    );
    service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![
                DatabaseOp::Table {
                    table: sessions,
                    change: TableChange::Create {
                        name: "Sessions".into(),
                    },
                },
                DatabaseOp::Column {
                    table: sessions,
                    column: title,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Title".into(),
                            kind: ColumnKind::Text,
                            options: vec![],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
                DatabaseOp::Column {
                    table: guests.table_id,
                    column: relation,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Sessions".into(),
                            kind: ColumnKind::Relation {
                                database: guests.database_id,
                                table: sessions,
                            },
                            options: vec![],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
                DatabaseOp::View {
                    table: guests.table_id,
                    view: board,
                    change: ViewChange::Create {
                        view: NewView {
                            name: "Stages".into(),
                            query: ViewQuery::default(),
                            layout: ViewLayout::Board {
                                group_by: guests.status,
                                title: guests.name,
                                lanes: vec![],
                                card_fields: vec![],
                                hide_empty_lanes: false,
                            }
                            .into(),
                        },
                    },
                },
            ]
            .into(),
        )
        .await
        .unwrap();
    let keynote = inserted(
        &service
            .apply_ops(
                edit(guests.database_id),
                viewer(),
                vec![DatabaseOp::Rows {
                    table: sessions,
                    change: RowsChange::Insert {
                        rows: vec![vec![CellWrite {
                            column: title,
                            value: CellValue::Text("Keynote".into()),
                        }]],
                    },
                }]
                .into(),
            )
            .await
            .unwrap(),
    )[0];
    let sam = inserted(
        &service
            .apply_ops(
                edit(guests.database_id),
                viewer(),
                vec![DatabaseOp::Rows {
                    table: guests.table_id,
                    change: RowsChange::Insert {
                        rows: vec![vec![
                            CellWrite {
                                column: guests.name,
                                value: CellValue::Text("Sam".into()),
                            },
                            CellWrite {
                                column: guests.status,
                                value: CellValue::Options(vec![OptionRef::Label("Going".into())]),
                            },
                            CellWrite {
                                column: relation,
                                value: CellValue::Rows(vec![keynote]),
                            },
                        ]],
                    },
                }]
                .into(),
            )
            .await
            .unwrap(),
    )[0];
    let going = crate::outbound::pg_definition_store::PgDefinitionStore::new(
        pool.clone(),
        properties::outbound::properties_pg_repo::PropertiesPgRepo::new(pool.clone()),
    )
    .definitions(&[guests.status_definition])
    .await
    .unwrap()[0]
        .property_options[0]
        .id;
    service
        .apply_ops(
            edit(guests.database_id),
            viewer(),
            vec![DatabaseOp::View {
                table: guests.table_id,
                view: board,
                change: ViewChange::MoveCard {
                    row: sam,
                    lane: LaneKey::Option(models_databases::OptionId::from_uuid(going)),
                    before: None,
                    after: None,
                },
            }]
            .into(),
        )
        .await
        .unwrap();

    let copy = service
        .duplicate_database(view(guests.database_id), duplicator(), None)
        .await
        .unwrap();

    assert_eq!(copy.name, "Offsite copy");
    assert_eq!(copy.owner_id, DUPLICATOR);
    let grant = sqlx::query_scalar!(
        r#"SELECT access_level::text AS "level!" FROM entity_access
           WHERE entity_id = $1 AND entity_type = 'database' AND source_id = $2"#,
        copy.id.into_uuid(),
        DUPLICATOR,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(grant, "owner");

    let detail = service.get_database(view(copy.id)).await.unwrap();
    assert_eq!(
        detail
            .tables
            .iter()
            .map(|table| table.table.name.as_str())
            .collect::<Vec<_>>(),
        vec!["Table 1", "Sessions"]
    );
    let (guests_copy, sessions_copy) = (&detail.tables[0], &detail.tables[1]);
    let column = |name: &str| {
        guests_copy
            .columns
            .iter()
            .find(|column| column.sql_name == format!("\"{name}\""))
            .unwrap()
    };
    let (name, status, sessions_column) = (column("Name"), column("Status"), column("Sessions"));
    assert_eq!(
        sessions_column.column.config,
        Some(ColumnConfig::Link {
            database_id: copy.id,
            table_id: sessions_copy.table.id,
        })
    );
    let copied_going = status.definition.property_options[0].id;
    assert_ne!(copied_going, going);

    let repo = super::PgDatabasesRepo::new(
        pool.clone(),
        properties::outbound::properties_pg_repo::PropertiesPgRepo::new(pool.clone()),
    );
    let sam_copy = crate::domain::ports::DatabasesRepo::row_refs(&repo, guests_copy.table.id)
        .await
        .unwrap()[0]
        .id;
    let keynote_copy = crate::domain::ports::DatabasesRepo::row_refs(&repo, sessions_copy.table.id)
        .await
        .unwrap()[0]
        .id;
    let stored = cells(&pool).cells(&[sam_copy]).await.unwrap();
    let sam_cells = &stored[&sam_copy];
    assert_eq!(
        sam_cells[&name.column.property_definition_id],
        PropertyValue::Str("Sam".into())
    );
    assert_eq!(
        sam_cells[&status.column.property_definition_id],
        PropertyValue::SelectOption(vec![copied_going])
    );
    assert_eq!(
        sam_cells[&sessions_column.column.property_definition_id],
        PropertyValue::EntityRef(vec![EntityReference {
            entity_id: keynote_copy.to_string(),
            entity_type: PropertyEntityType::DatabaseRow,
            specific_message_id: None,
        }])
    );

    let stages = &guests_copy.views[0];
    assert_ne!(stages.id, board);
    let places = crate::domain::ports::DatabasesRepo::view_positions(&repo, stages.id)
        .await
        .unwrap();
    assert_eq!(places.len(), 1);
    assert_eq!(places[0].row, sam_copy);
    assert_eq!(
        places[0].lane,
        LaneKey::Option(models_databases::OptionId::from_uuid(copied_going))
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_refused_duplicate_leaves_no_database_behind(pool: PgPool) {
    let guests = guests(&pool).await;
    insert_named_user(&pool, DUPLICATOR).await;
    let copy = Database {
        id: DatabaseId::new(),
        name: "Offsite copy".into(),
        owner_id: DUPLICATOR.into(),
        created_at: chrono::Utc::now(),
        trashed_at: None,
    };
    let table = TableId::new();
    let missing = RowId::new();

    let outcome = cells(&pool)
        .duplicate_database(
            &copy,
            &Writes {
                database_id: copy.id,
                created_by: duplicator(),
                writes: vec![Write::CreateTable {
                    table_id: table,
                    name: "Guests".into(),
                }],
                // A relation into a row that does not exist refuses the batch.
                related_rows: vec![(guests.table_id, missing)],
                expected_versions: vec![],
                journal: JournalPlan::default(),
            },
        )
        .await
        .unwrap();

    assert_eq!(outcome, WritesOutcome::MissingRelatedRow(missing));
    let left = sqlx::query_scalar!(
        r#"SELECT
             (SELECT COUNT(*) FROM databases WHERE id = $1)
           + (SELECT COUNT(*) FROM database_entities WHERE database_id = $1)
           + (SELECT COUNT(*) FROM database_tables WHERE database_id = $1)
           + (SELECT COUNT(*) FROM entity_access WHERE entity_id = $1) AS "left!""#,
        copy.id.into_uuid(),
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(left, 0);
}
