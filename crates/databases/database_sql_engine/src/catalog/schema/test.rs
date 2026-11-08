//! The builder against the catalog fixtures under `fixtures/catalogs/`. The
//! browser's tests map a database detail onto each fixture's schema, so the
//! two sides build the same catalog from the same databases.

mod scopes;

use serde_json::Value;

use super::*;
use crate::catalog::{PEOPLE_TABLE, PLATFORM_DATABASE};

fn fixture(name: &str) -> Value {
    let path = format!(
        "{}/fixtures/catalogs/{name}.json",
        env!("CARGO_MANIFEST_DIR")
    );
    serde_json::from_str(&std::fs::read_to_string(&path).unwrap()).unwrap()
}

/// The fixture's schema, built from its scope, as JSON.
fn built(fixture: &Value) -> Value {
    let schema: Schema = serde_json::from_value(fixture["schema"].clone()).unwrap();
    let scope: Option<DatabaseId> = serde_json::from_value(fixture["scope"].clone()).unwrap();
    serde_json::to_value(build(&schema, scope)).unwrap()
}

#[test]
fn tables_and_columns_are_named_as_the_properties_system_stores_them() {
    let fixture = fixture("crm");
    assert_eq!(built(&fixture), fixture["catalog"]);
}

#[test]
fn the_scoped_database_wins_a_table_name_another_database_also_uses() {
    let fixture = fixture("scoped");
    assert_eq!(built(&fixture), fixture["catalog"]);
}

#[test]
fn people_join_the_databases_unless_the_scoped_database_has_its_own() {
    let people = Schema {
        databases: vec![],
        platform: vec![PlatformTable::People],
    };
    let catalog = build(&people, None);
    assert_eq!(
        catalog
            .tables
            .iter()
            .map(|table| (table.id, table.database_id))
            .collect::<Vec<_>>(),
        vec![(PEOPLE_TABLE, PLATFORM_DATABASE)]
    );

    let own = DatabaseId::from_uuid(Uuid::from_u128(0xdb));
    let catalog = build(
        &Schema {
            databases: vec![DatabaseSchema {
                id: own,
                name: "Macro".into(),
                tables: vec![TableSchema {
                    id: TableId::from_uuid(Uuid::from_u128(0x7a)),
                    name: "People".into(),
                    columns: vec![],
                }],
            }],
            platform: vec![PlatformTable::People],
        },
        Some(own),
    );
    assert_eq!(
        catalog
            .tables
            .iter()
            .map(|table| table.id)
            .collect::<Vec<_>>(),
        vec![TableId::from_uuid(Uuid::from_u128(0x7a))]
    );
}
