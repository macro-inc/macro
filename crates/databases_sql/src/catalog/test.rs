use chrono::Utc;
use database_sql::catalog::{
    ColumnSchema, DataType as SchemaDataType, DatabaseSchema, EntityKind, OptionSchema,
    OptionValue, PlatformTable, PropertyType, Schema, TableSchema,
};
use databases::domain::models::{
    Column, ColumnConfig, ColumnDetail, Database, DatabaseDetail, Table, TableDetail, TableVersion,
};
use entity_access::domain::models::AccessLevel;
use models_databases::position::Position;
use models_databases::{ColumnId, DatabaseId, OptionId, TableId};
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::PropertyOption;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::shared::{DataType, PropertyOwner};
use uuid::Uuid;

use super::schema;

const CRM: DatabaseId = DatabaseId::from_uuid(Uuid::from_u128(0xdb01));
const DEALS: TableId = TableId::from_uuid(Uuid::from_u128(0x7a01));

#[test]
fn details_become_the_schema_the_engine_builds_its_catalog_from() {
    let details = vec![DatabaseDetail {
        database: Database {
            id: CRM,
            name: "CRM".into(),
            owner_id: "macro|owner@macro.com".into(),
            created_at: Utc::now(),
            trashed_at: None,
        },
        grant: AccessLevel::Owner,
        tables: vec![TableDetail {
            table: Table {
                id: DEALS,
                database_id: CRM,
                name: "Deals".into(),
                position: "80".parse::<Position>().unwrap(),
                version: TableVersion(1),
            },
            sql_name: "\"Deals\"".into(),
            columns: vec![
                ColumnDetail {
                    column: Column {
                        protections: vec![],
                        nullable: true,
                        id: ColumnId::from_uuid(Uuid::from_u128(0xb001)),
                        table_id: DEALS,
                        property_definition_id: Uuid::from_u128(0xc001),
                        position: "80".parse::<Position>().unwrap(),
                        config: None,
                        display_name: Some("Deal name".into()),
                        infer_type: false,
                    },
                    sql_name: "\"Name\"".into(),
                    definition: PropertyDefinitionWithOptions {
                        definition: PropertyDefinition {
                            id: Uuid::from_u128(0xc001),
                            owner: PropertyOwner::System,
                            display_name: "Name".into(),
                            data_type: DataType::String,
                            is_multi_select: false,
                            specific_entity_type: None,
                            created_at: Utc::now(),
                            updated_at: Utc::now(),
                            is_system: false,
                            is_metadata: false,
                        },
                        property_options: Vec::new(),
                    },
                    writable: true,
                    shared_outside_database: true,
                },
                ColumnDetail {
                    column: Column {
                        protections: vec![],
                        nullable: true,
                        id: ColumnId::from_uuid(Uuid::from_u128(0xb002)),
                        table_id: DEALS,
                        property_definition_id: Uuid::from_u128(0xc002),
                        position: "8180".parse::<Position>().unwrap(),
                        config: None,
                        display_name: None,
                        infer_type: false,
                    },
                    sql_name: "\"Tier\"".into(),
                    definition: PropertyDefinitionWithOptions {
                        definition: PropertyDefinition {
                            id: Uuid::from_u128(0xc002),
                            owner: PropertyOwner::System,
                            display_name: "Tier".into(),
                            data_type: DataType::SelectNumber,
                            is_multi_select: true,
                            specific_entity_type: None,
                            created_at: Utc::now(),
                            updated_at: Utc::now(),
                            is_system: false,
                            is_metadata: false,
                        },
                        property_options: vec![
                            PropertyOption {
                                id: Uuid::from_u128(0xa001),
                                property_definition_id: Uuid::from_u128(0xc002),
                                display_order: 0,
                                value: PropertyOptionValue::Number(2.0),
                                color: None,
                                created_at: Utc::now(),
                                updated_at: Utc::now(),
                            },
                            PropertyOption {
                                id: Uuid::from_u128(0xa002),
                                property_definition_id: Uuid::from_u128(0xc002),
                                display_order: 1,
                                value: PropertyOptionValue::Number(2.5),
                                color: None,
                                created_at: Utc::now(),
                                updated_at: Utc::now(),
                            },
                        ],
                    },
                    writable: true,
                    shared_outside_database: true,
                },
                ColumnDetail {
                    column: Column {
                        protections: vec![],
                        nullable: true,
                        id: ColumnId::from_uuid(Uuid::from_u128(0xb003)),
                        table_id: DEALS,
                        property_definition_id: Uuid::from_u128(0xc003),
                        position: "8280".parse::<Position>().unwrap(),
                        config: None,
                        display_name: None,
                        infer_type: false,
                    },
                    sql_name: "\"Owner\"".into(),
                    definition: PropertyDefinitionWithOptions {
                        definition: PropertyDefinition {
                            id: Uuid::from_u128(0xc003),
                            owner: PropertyOwner::System,
                            display_name: "Owner".into(),
                            data_type: DataType::Entity,
                            is_multi_select: false,
                            specific_entity_type: Some(models_properties::EntityType::User),
                            created_at: Utc::now(),
                            updated_at: Utc::now(),
                            is_system: false,
                            is_metadata: false,
                        },
                        property_options: Vec::new(),
                    },
                    writable: true,
                    shared_outside_database: true,
                },
                ColumnDetail {
                    column: Column {
                        protections: vec![],
                        nullable: true,
                        id: ColumnId::from_uuid(Uuid::from_u128(0xb004)),
                        table_id: DEALS,
                        property_definition_id: Uuid::from_u128(0xc004),
                        position: "8380".parse::<Position>().unwrap(),
                        config: Some(ColumnConfig::Link {
                            database_id: CRM,
                            table_id: DEALS,
                        }),
                        display_name: None,
                        infer_type: false,
                    },
                    sql_name: "\"Related\"".into(),
                    definition: PropertyDefinitionWithOptions {
                        definition: PropertyDefinition {
                            id: Uuid::from_u128(0xc004),
                            owner: PropertyOwner::System,
                            display_name: "Related".into(),
                            data_type: DataType::Entity,
                            is_multi_select: true,
                            specific_entity_type: None,
                            created_at: Utc::now(),
                            updated_at: Utc::now(),
                            is_system: false,
                            is_metadata: false,
                        },
                        property_options: Vec::new(),
                    },
                    writable: true,
                    shared_outside_database: true,
                },
            ],
            views: Vec::new(),
        }],
    }];

    assert_eq!(
        schema(&details),
        Schema {
            databases: vec![DatabaseSchema {
                id: CRM,
                name: "CRM".into(),
                tables: vec![TableSchema {
                    id: DEALS,
                    name: "Deals".into(),
                    columns: vec![
                        ColumnSchema {
                            id: ColumnId::from_uuid(Uuid::from_u128(0xb001)),
                            definition: Uuid::from_u128(0xc001),
                            name: "Deal name".into(),
                            property: PropertyType {
                                data_type: SchemaDataType::String,
                                multi: false,
                                entity_type: None,
                                relation: false,
                            },
                            options: vec![],
                        },
                        ColumnSchema {
                            id: ColumnId::from_uuid(Uuid::from_u128(0xb002)),
                            definition: Uuid::from_u128(0xc002),
                            name: "Tier".into(),
                            property: PropertyType {
                                data_type: SchemaDataType::SelectNumber,
                                multi: true,
                                entity_type: None,
                                relation: false,
                            },
                            options: vec![
                                OptionSchema {
                                    id: OptionId::from_uuid(Uuid::from_u128(0xa001)),
                                    value: OptionValue::Number(2.0),
                                    order: 0,
                                },
                                OptionSchema {
                                    id: OptionId::from_uuid(Uuid::from_u128(0xa002)),
                                    value: OptionValue::Number(2.5),
                                    order: 1,
                                },
                            ],
                        },
                        ColumnSchema {
                            id: ColumnId::from_uuid(Uuid::from_u128(0xb003)),
                            definition: Uuid::from_u128(0xc003),
                            name: "Owner".into(),
                            property: PropertyType {
                                data_type: SchemaDataType::Entity,
                                multi: false,
                                entity_type: Some(EntityKind::User),
                                relation: false,
                            },
                            options: vec![],
                        },
                        ColumnSchema {
                            id: ColumnId::from_uuid(Uuid::from_u128(0xb004)),
                            definition: Uuid::from_u128(0xc004),
                            name: "Related".into(),
                            property: PropertyType {
                                data_type: SchemaDataType::Entity,
                                multi: true,
                                entity_type: None,
                                relation: true,
                            },
                            options: vec![],
                        },
                    ],
                }],
            }],
            platform: vec![PlatformTable::People],
        }
    );
}

/// Two tables placing one relation definition, each linking elsewhere: the
/// related table is the one the asking table's placement links to.
#[test]
fn a_shared_relation_definition_relates_each_table_to_its_own_target() {
    const LINKED: Uuid = Uuid::from_u128(0xc0de);
    const LEADS: TableId = TableId::from_uuid(Uuid::from_u128(0x7a02));
    const ACCOUNTS: TableId = TableId::from_uuid(Uuid::from_u128(0x7a03));
    const CONTACTS: TableId = TableId::from_uuid(Uuid::from_u128(0x7a04));
    let link = PropertyDefinitionWithOptions {
        definition: PropertyDefinition {
            id: LINKED,
            owner: PropertyOwner::System,
            display_name: "Linked".into(),
            data_type: DataType::Entity,
            is_multi_select: true,
            specific_entity_type: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
            is_system: false,
            is_metadata: false,
        },
        property_options: Vec::new(),
    };
    let table = |id: TableId, name: &str, column: ColumnId, target: TableId| TableDetail {
        table: Table {
            id,
            database_id: CRM,
            name: name.into(),
            position: "80".parse::<Position>().unwrap(),
            version: TableVersion(1),
        },
        sql_name: format!("\"{name}\""),
        columns: vec![ColumnDetail {
            column: Column {
                protections: vec![],
                nullable: true,
                id: column,
                table_id: id,
                property_definition_id: LINKED,
                position: "80".parse::<Position>().unwrap(),
                config: Some(ColumnConfig::Link {
                    database_id: CRM,
                    table_id: target,
                }),
                display_name: None,
                infer_type: false,
            },
            sql_name: "\"Linked\"".into(),
            definition: link.clone(),
            writable: true,
            shared_outside_database: true,
        }],
        views: Vec::new(),
    };
    let catalog = super::ViewerCatalog::new(
        vec![DatabaseDetail {
            database: Database {
                id: CRM,
                name: "CRM".into(),
                owner_id: "macro|owner@macro.com".into(),
                created_at: Utc::now(),
                trashed_at: None,
            },
            grant: AccessLevel::Owner,
            tables: vec![
                table(
                    DEALS,
                    "Deals",
                    ColumnId::from_uuid(Uuid::from_u128(0xb101)),
                    ACCOUNTS,
                ),
                table(
                    LEADS,
                    "Leads",
                    ColumnId::from_uuid(Uuid::from_u128(0xb102)),
                    CONTACTS,
                ),
            ],
        }],
        None,
    );

    assert_eq!(catalog.related_table(DEALS, LINKED), Some(ACCOUNTS));
    assert_eq!(catalog.related_table(LEADS, LINKED), Some(CONTACTS));
}
