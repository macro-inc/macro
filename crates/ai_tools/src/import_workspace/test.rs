use chrono::Utc;
use databases::domain::models::{
    Column, ColumnDetail, Database, DatabaseDetail, Table, TableDetail, TableVersion,
};
use entity_access::domain::models::AccessLevel;
use models_databases::{ColumnId, DatabaseId, TableId};
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::shared::{DataType, PropertyOwner};
use uuid::Uuid;

use super::new_database;

#[test]
fn a_new_database_is_written_into_its_starter_table_and_title_column() {
    let database_id = Uuid::from_u128(0x0dbb_0000_0000_0000_0000_0000_0000_0001);
    let table_id = Uuid::from_u128(0x7ab1_0000_0000_0000_0000_0000_0000_0001);
    let column_id = Uuid::from_u128(0xc01a_0000_0000_0000_0000_0000_0000_0001);
    let detail = DatabaseDetail {
        database: Database {
            id: DatabaseId::from_uuid(database_id),
            name: "Roadmap".to_string(),
            owner_id: "macro|owner@example.com".to_string(),
            created_at: Utc::now(),
            trashed_at: None,
        },
        grant: AccessLevel::Owner,
        tables: vec![TableDetail {
            table: Table {
                id: TableId::from_uuid(table_id),
                database_id: DatabaseId::from_uuid(database_id),
                name: "Table 1".to_string(),
                position: "80".parse().expect("valid position"),
                version: TableVersion(1),
            },
            sql_name: "\"Roadmap\".\"Table 1\"".to_string(),
            columns: vec![ColumnDetail {
                column: Column {
                    id: ColumnId::from_uuid(column_id),
                    table_id: TableId::from_uuid(table_id),
                    property_definition_id: Uuid::nil(),
                    position: "80".parse().expect("valid position"),
                    config: None,
                    display_name: None,
                    infer_type: true,
                    protections: vec![],
                    nullable: true,
                },
                sql_name: "\"Name\"".to_string(),
                definition: PropertyDefinitionWithOptions {
                    definition: PropertyDefinition {
                        id: Uuid::nil(),
                        owner: PropertyOwner::Database { database_id },
                        display_name: "Name".to_string(),
                        data_type: DataType::String,
                        is_multi_select: false,
                        specific_entity_type: None,
                        created_at: Utc::now(),
                        updated_at: Utc::now(),
                        is_system: false,
                        is_metadata: false,
                    },
                    property_options: vec![],
                },
                writable: true,
                shared_outside_database: false,
            }],
            views: vec![],
        }],
    };

    let created = new_database(&detail).expect("a starter table with a title column");

    assert_eq!(
        created,
        import::domain::ports::NewDatabase {
            database_id,
            table: TableId::from_uuid(table_id),
            title_column: ColumnId::from_uuid(column_id),
        }
    );
}

#[test]
fn a_new_database_without_a_starter_table_is_refused() {
    let database_id = Uuid::from_u128(0x0dbb_0000_0000_0000_0000_0000_0000_0002);
    let detail = DatabaseDetail {
        database: Database {
            id: DatabaseId::from_uuid(database_id),
            name: "Roadmap".to_string(),
            owner_id: "macro|owner@example.com".to_string(),
            created_at: Utc::now(),
            trashed_at: None,
        },
        grant: AccessLevel::Owner,
        tables: vec![],
    };

    assert!(new_database(&detail).is_err());
}

#[test]
fn a_new_database_whose_starter_table_has_no_column_is_refused() {
    let database_id = Uuid::from_u128(0x0dbb_0000_0000_0000_0000_0000_0000_0003);
    let table_id = Uuid::from_u128(0x7ab1_0000_0000_0000_0000_0000_0000_0003);
    let detail = DatabaseDetail {
        database: Database {
            id: DatabaseId::from_uuid(database_id),
            name: "Roadmap".to_string(),
            owner_id: "macro|owner@example.com".to_string(),
            created_at: Utc::now(),
            trashed_at: None,
        },
        grant: AccessLevel::Owner,
        tables: vec![TableDetail {
            table: Table {
                id: TableId::from_uuid(table_id),
                database_id: DatabaseId::from_uuid(database_id),
                name: "Table 1".to_string(),
                position: "80".parse().expect("valid position"),
                version: TableVersion(1),
            },
            sql_name: "\"Roadmap\".\"Table 1\"".to_string(),
            columns: vec![],
            views: vec![],
        }],
    };

    assert!(new_database(&detail).is_err());
}
