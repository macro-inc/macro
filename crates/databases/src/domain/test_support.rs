//! Fixture builders shared by the SQL-machinery test families: property
//! definitions with options, tables, placements, catalog entries, and a
//! seeded generator so randomized tests stay deterministic.

use std::collections::HashMap;

use chrono::Utc;
use models_properties::service::property_definition::PropertyDefinition;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::{PropertyOption, PropertyOptionValue};
use models_properties::shared::{DataType, EntityType as PropertyEntityType, PropertyOwner};
use rand::rngs::StdRng;
use rand::{Rng, SeedableRng};
use uuid::Uuid;

use crate::domain::catalog::{TableEntry, build_user_tables};
use crate::domain::models::{AccessGrant, Column, ColumnConfig, DatabaseId, Table, TableVersion};

/// A property definition of the given type with no options.
pub fn definition(name: &str, data_type: DataType, multi: bool) -> PropertyDefinitionWithOptions {
    PropertyDefinitionWithOptions {
        definition: PropertyDefinition {
            id: Uuid::new_v4(),
            owner: PropertyOwner::System,
            display_name: name.to_string(),
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

/// Attach options to a definition (string labels for select-string/tag,
/// numbers for select-number).
pub fn with_options(
    mut def: PropertyDefinitionWithOptions,
    values: Vec<PropertyOptionValue>,
) -> PropertyDefinitionWithOptions {
    def.property_options = values
        .into_iter()
        .enumerate()
        .map(|(i, value)| PropertyOption {
            id: Uuid::new_v4(),
            property_definition_id: def.definition.id,
            display_order: i as i32,
            value,
            color: None,
            created_at: Utc::now(),
            updated_at: Utc::now(),
        })
        .collect();
    def
}

/// A table in `database`.
pub fn table(database: DatabaseId, name: &str) -> Table {
    Table {
        id: Uuid::new_v4(),
        database_id: database,
        name: name.to_string(),
        position: "0".to_string(),
        version: TableVersion(0),
    }
}

/// A column placement of `def` on `table_id`.
pub fn placement(
    table_id: Uuid,
    def: &PropertyDefinitionWithOptions,
    config: Option<ColumnConfig>,
) -> Column {
    Column {
        infer_type: false,
        display_name: None,
        id: Uuid::new_v4(),
        table_id,
        property_definition_id: def.definition.id,
        position: "0".to_string(),
        config,
    }
}

/// Build the catalog entries for one table holding the given placements
/// under `grant`.
pub fn entries_for(
    table: &Table,
    columns: &[Column],
    definitions: &[PropertyDefinitionWithOptions],
    grant: AccessGrant,
) -> Vec<TableEntry> {
    let definitions: HashMap<_, _> = definitions
        .iter()
        .map(|d| (d.definition.id, d.clone()))
        .collect();
    let grants = HashMap::from([(table.database_id, grant)]);
    let database = crate::domain::models::Database {
        id: table.database_id,
        name: "Test Database".to_string(),
        owner_id: "macro|tests@macro.com".to_string(),
        created_at: chrono::Utc::now(),
        trashed_at: None,
    };
    build_user_tables(
        std::slice::from_ref(&database),
        std::slice::from_ref(table),
        columns,
        &definitions,
        &grants,
        &[],
    )
}

/// A deterministic generator: every randomized test seeds it with a fixed
/// value so failures reproduce.
pub fn rng(seed: u64) -> StdRng {
    StdRng::seed_from_u64(seed)
}

/// Fragments chosen to stress quoting, escaping, JSON parsing, and Unicode
/// handling at every boundary.
pub const NASTY_FRAGMENTS: &[&str] = &[
    "",
    " ",
    "'",
    "''",
    "\"",
    "\\",
    ",",
    "a,b",
    "[\"x\"]",
    "{\"k\": 1}",
    "[]",
    "null",
    "NULL",
    "true",
    "0",
    "1e20",
    "-1",
    "2.5",
    "Going",
    "it's",
    "say \"hi\"",
    "tab\there",
    "new\nline",
    "日本語",
    "émoji 🎉",
    "𝔘𝔫𝔦𝔠𝔬𝔡𝔢",
    "a HAS b",
    "-- comment",
    "/* c */",
    "; DROP TABLE t",
    "row_id",
    "sqlite_master",
    "SELECT",
];

/// A random string built from nasty fragments and random ASCII, so it
/// contains quotes, JSON-looking text, and Unicode with high probability.
pub fn random_string(rng: &mut StdRng) -> String {
    let parts = rng.random_range(0..4);
    let mut out = String::new();
    for _ in 0..parts {
        if rng.random_bool(0.6) {
            out.push_str(NASTY_FRAGMENTS[rng.random_range(0..NASTY_FRAGMENTS.len())]);
        } else {
            let len = rng.random_range(1..6);
            for _ in 0..len {
                out.push(rng.random_range(b'a'..=b'z') as char);
            }
        }
    }
    out
}

/// Representative finite numbers: exact integers, halves, huge and tiny
/// magnitudes, negatives, and random values with limited precision.
pub fn random_number(rng: &mut StdRng) -> f64 {
    const EDGE: &[f64] = &[
        0.0,
        1.0,
        2.0,
        2.5,
        -3.0,
        -0.25,
        1e20,
        -1e20,
        1e-7,
        123456789.125,
        0.1 + 0.2,
        f64::MAX,
        f64::MIN_POSITIVE,
        1e15,
        999_999_999_999_999.0,
    ];
    if rng.random_bool(0.5) {
        EDGE[rng.random_range(0..EDGE.len())]
    } else {
        rng.random_range(-1_000_000_000i64..1_000_000_000) as f64 / 1000.0
    }
}
