//! Service tests: the domain service over in-memory fakes for every port, so
//! every write path (schema changes, typed ops, lifecycle) runs without
//! Postgres, and every allow/deny decision is asserted at the service
//! boundary.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use chrono::Utc;
use entity_access::domain::models::{
    AccessLevel, Entity, EntityAccessReceipt, EntityPermission, EntityType, RequiredPermission,
};
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::position::Position;
use models_databases::{
    CellValue, CellWrite, ColumnChange, ColumnKind, ColumnResult, DatabaseOp, NewColumn, NewOption,
    OpResult, OptionId, OptionRef, PropertyId, RowChanges, RowsChange, RowsResult, TableChange,
    TableResult, ViewChange, ViewResult,
};
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::service::property_value::PropertyValue;
use models_properties::shared::{DataType, EntityType as PropertyEntityType, PropertyOwner};
use uuid::Uuid;

use super::*;
use crate::domain::models::{
    CardPosition, Column, DatabaseView, NewDefinition, OpBatch, OpRefusal, PropertyDefinitionId,
    RowId, RowRef, TableVersion, TakenId, ViewId, Write, Writes, WritesOutcome,
};

mod awareness;
mod casts;
mod column_options;
mod columns;
mod databases;
mod delete_table;
mod discovery;
mod domain_events;
mod fakes;
mod infer_column_type;
mod ops;
mod options;
mod relations;
mod rename_column;
mod row_writes;
mod saved_queries;
mod schema_ops;
mod sharing;
mod tables;
mod templates;
mod undo;
mod views;

use fakes::*;

const OWNER: &str = "macro|owner@macro.com";
const VIEWER: &str = "macro|viewer@macro.com";
const STRANGER: &str = "macro|stranger@macro.com";

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).expect("valid user id")
}

fn viewer(id: &'static str) -> Viewer {
    Viewer {
        user_id: user(id),
        acting_bot: None,
    }
}

type Service = DatabasesServiceImpl<
    FakeRepo,
    FakeDefinitions,
    FakeCells,
    FakeEvents,
    FakeAccess,
    RecordingBroker,
>;

fn service(world: &Shared) -> Service {
    DatabasesServiceImpl::new(
        FakeRepo(world.clone()),
        FakeDefinitions(world.clone()),
        FakeCells(world.clone()),
        FakeEvents(world.clone()),
        FakeAccess(world.clone()),
        RecordingBroker(world.clone()),
    )
}

fn definition(
    name: &str,
    data_type: DataType,
    multi: bool,
    owner: PropertyOwner,
) -> PropertyDefinitionWithOptions {
    PropertyDefinitionWithOptions {
        definition: PropertyDefinition {
            id: Uuid::new_v4(),
            owner,
            display_name: name.into(),
            data_type,
            is_multi_select: multi,
            specific_entity_type: (data_type == DataType::Entity)
                .then_some(PropertyEntityType::User),
            created_at: Utc::now(),
            updated_at: Utc::now(),
            is_system: false,
            is_metadata: false,
        },
        property_options: vec![],
    }
}

fn receipt<T: RequiredPermission>(
    database_id: DatabaseId,
    user: &'static str,
    level: AccessLevel,
) -> EntityAccessReceipt<T> {
    EntityAccessReceipt::try_new_authenticated_user(
        self::user(user),
        Entity {
            entity_id: database_id.to_string(),
            entity_type: EntityType::Database,
        },
        EntityPermission::AccessLevel {
            access_level: level,
        },
    )
    .expect("level satisfies the requirement")
}

fn edit(database_id: DatabaseId) -> EntityAccessReceipt<EditAccessLevel> {
    receipt::<EditAccessLevel>(database_id, OWNER, AccessLevel::Owner)
}

fn table_version(world: &Shared, table_id: TableId) -> TableVersion {
    world
        .lock()
        .unwrap()
        .tables
        .iter()
        .find(|table| table.id == table_id)
        .unwrap()
        .version
}

fn option_id(world: &Shared, definition_id: PropertyDefinitionId, label: &str) -> OptionId {
    world.lock().unwrap().definitions[&definition_id]
        .property_options
        .iter()
        .find(|option| option.value == PropertyOptionValue::String(label.into()))
        .map(|option| OptionId::from_uuid(option.id))
        .unwrap()
}

fn row_ids(world: &Shared, table_id: TableId) -> Vec<RowId> {
    world.lock().unwrap().rows[&table_id]
        .iter()
        .map(|row| row.id)
        .collect()
}

fn cell(world: &Shared, row: RowId, definition_id: PropertyDefinitionId) -> Option<PropertyValue> {
    world
        .lock()
        .unwrap()
        .cells
        .get(&row)
        .and_then(|cells| cells.get(&definition_id))
        .cloned()
}

/// Insert one row per name into the seeded Guests table, answering their ids.
async fn insert_names(seeded: &Seeded, names: &[&str]) -> Vec<RowId> {
    let results = seeded
        .service
        .apply_ops(
            edit(seeded.database_id),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: seeded.table_id,
                change: RowsChange::Insert {
                    rows: names
                        .iter()
                        .map(|name| {
                            vec![CellWrite {
                                column: seeded.name_column.id,
                                value: CellValue::Text((*name).into()),
                            }]
                        })
                        .collect(),
                },
            }]),
        )
        .await
        .unwrap();
    let [
        OpResult::Rows {
            change: RowsResult::Inserted { rows: inserted },
            ..
        },
    ] = results.as_slice()
    else {
        panic!("expected one insert, got {results:?}");
    };
    inserted.clone()
}

/// The seeded world: database `Offsite` with one table
/// `Guests(Name TEXT, Status SELECT[Going|Declined], Plus ones NUMBER)`
/// holding one row (`Sam`, `Going`, `2`), owned by OWNER and shared
/// View-only with VIEWER.
struct Seeded {
    world: Shared,
    service: Service,
    database_id: DatabaseId,
    table_id: TableId,
    /// Sam's row.
    row_id: RowId,
    name_column: Column,
    status_column: Column,
    plus_ones_column: Column,
}

async fn seeded() -> Seeded {
    let world: Shared = Arc::default();
    let service = self::service(&world);
    let database = service
        .create_database(CreateDatabase {
            name: "Offsite".into(),
            owner_id: user(OWNER),
            acting_bot: None,
            template: None,
        })
        .await
        .unwrap();
    // The database starts with its title column, Name.
    let (table_id, name_column) = {
        let mut world_state = world.lock().unwrap();
        world_state.tables[0].name = "Guests".into();
        let table_id = world_state.tables[0].id;
        let name_column = world_state
            .columns
            .iter()
            .find(|column| column.table_id == table_id)
            .unwrap()
            .id;
        (table_id, name_column)
    };
    let (status_column, plus_ones_column) = (ColumnId::new(), ColumnId::new());
    service
        .apply_ops(
            receipt::<EditAccessLevel>(database.id, OWNER, AccessLevel::Owner),
            viewer(OWNER),
            OpBatch::from(vec![
                DatabaseOp::Column {
                    table: table_id,
                    column: status_column,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Status".into(),
                            kind: ColumnKind::Select { multi: false },
                            options: vec![
                                NewOption {
                                    id: OptionId::new(),
                                    label: "Going".into(),
                                },
                                NewOption {
                                    id: OptionId::new(),
                                    label: "Declined".into(),
                                },
                            ],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
                DatabaseOp::Column {
                    table: table_id,
                    column: plus_ones_column,
                    change: ColumnChange::Create {
                        definition: NewColumn::New {
                            name: "Plus ones".into(),
                            kind: ColumnKind::Number,
                            options: vec![],
                            infer_type: false,
                        },
                        after: None,
                    },
                },
            ]),
        )
        .await
        .unwrap();
    world
        .lock()
        .unwrap()
        .grants
        .entry(VIEWER.into())
        .or_default()
        .push((database.id, AccessLevel::View));
    let inserted = service
        .apply_ops(
            receipt::<EditAccessLevel>(database.id, OWNER, AccessLevel::Owner),
            viewer(OWNER),
            OpBatch::from(vec![DatabaseOp::Rows {
                table: table_id,
                change: RowsChange::Insert {
                    rows: vec![vec![
                        CellWrite {
                            column: name_column,
                            value: CellValue::Text("Sam".into()),
                        },
                        CellWrite {
                            column: status_column,
                            value: CellValue::Options(vec![OptionRef::Label("Going".into())]),
                        },
                        CellWrite {
                            column: plus_ones_column,
                            value: CellValue::Number(2.0),
                        },
                    ]],
                },
            }]),
        )
        .await
        .unwrap();
    let [
        OpResult::Rows {
            change: RowsResult::Inserted { rows: inserted },
            ..
        },
    ] = inserted.as_slice()
    else {
        panic!("expected one insert, got {inserted:?}");
    };
    // Tests count the batches their own writes make, not the seed row's.
    world.lock().unwrap().write_batches = 0;
    let column = |id: ColumnId| {
        world
            .lock()
            .unwrap()
            .columns
            .iter()
            .find(|column| column.id == id)
            .unwrap()
            .clone()
    };
    Seeded {
        database_id: database.id,
        table_id,
        row_id: inserted[0],
        name_column: column(name_column),
        status_column: column(status_column),
        plus_ones_column: column(plus_ones_column),
        world,
        service,
    }
}
