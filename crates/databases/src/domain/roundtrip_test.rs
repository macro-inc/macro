//! Cross-boundary tests for the SQL machinery, run through the real
//! `RusqliteExecutor` rather than hand-built changesets.
//!
//! # Design note: what can go wrong at each boundary, and which family catches it
//!
//! The pipeline crosses four representations of one value — `PropertyValue`
//! (Postgres cell) → `SqlValue` (materialization) → SQLite storage class
//! (through the compiled `STRICT`/`CHECK` schema) → `SqlValue` (session
//! changeset) → `SetPropertyValue` (translate) → `PropertyValue` (apply).
//! Each hop has its own failure modes:
//!
//! 1. **Materialize → SQLite → translate → apply round trip.** Display-string
//!    encodings (option labels, RFC 3339 dates, JSON arrays, `format_number`)
//!    must be parsed back to exactly the value that produced them, for every
//!    `DataType` × multi-select and for hostile content (quotes, commas,
//!    JSON-looking labels, Unicode, empty strings, huge/negative/fractional
//!    numbers, dates with sub-second precision). The `roundtrip_*` tests
//!    generate values from a seeded RNG, materialize them, write the
//!    materialized literal back through `INSERT` and through `UPDATE`, and
//!    compare `convert_set_property_value_to_property_value(translated)`
//!    against a documented normal form (`expected`): single-valued cells keep
//!    only their first element, multi-valued cells are compared as sets
//!    (the converter deduplicates through a `HashSet`), entity references
//!    lose `specific_message_id` and take the definition's entity type, and
//!    empty single-valued arrays normalize to "cell cleared".
//!    `materialized_values_survive_load` separately pins that loading a
//!    materialized row and selecting it back is the identity (a STRICT typing
//!    or CHECK failure at load time would surface as `Infrastructure`, which
//!    is how the stale-option bug fixed alongside these tests manifested).
//!
//! 2. **Catalog → DDL → SQLite acceptance and enforcement.** Generated
//!    catalogs with hostile display names (keywords, `sqlite_` prefixes,
//!    punctuation, digits first, collisions) must compile to DDL SQLite
//!    accepts, and every constraint the catalog claims — STRICT types, CHECK
//!    on options, primary keys, junction foreign keys, NOT NULL — must reject
//!    the corresponding bad write as `QueryError::Sql` carrying SQLite's own
//!    message. Multi-valued columns deliberately carry no CHECK (they are
//!    JSON), so their validation lives in `translate`; that hand-off is
//!    asserted too.
//!
//! 3. **Changeset → domain command translation over real changesets.** The
//!    session extension coalesces changes per row; the tests pin the
//!    consequences the service relies on: inserts default `row_id` and drop a
//!    user-supplied one, updates report only columns whose value changed,
//!    `NULL` clears, insert+update in one batch is a single insert with final
//!    values, insert+delete is nothing, and refusals (View grant, derived
//!    link JSON column, multi-value junction mirrors) are made by the
//!    executor's authorizer before a changeset exists. Links to rows inserted
//!    in the same statement pass SQLite's foreign key (the row exists in the
//!    scratch database) and must be refused by translate with the documented
//!    message.
//!
//! 4. **`HAS` sugar against real data.** The rewrite is textual; beyond the
//!    unit tests in `sugar/test.rs`, membership must be right for present,
//!    absent, empty-array, and NULL cells on both multi-select and link
//!    columns, and on a quoted identifier.

use std::collections::HashMap;

use chrono::{DateTime, TimeZone, Utc};
use models_properties::api::requests::SetPropertyValue;
use models_properties::convert_set_property_value_to_property_value;
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_properties::service::property_option::PropertyOptionValue;
use models_properties::service::property_value::PropertyValue;
use models_properties::shared::{DataType, EntityReference, EntityType as PropertyEntityType};
use rand::Rng;
use rand::rngs::StdRng;
use uuid::Uuid;

use crate::domain::catalog::{self, TableEntry, format_number, schemas};
use crate::domain::materialize;
use crate::domain::models::{
    AccessGrant, Catalog, ColumnConfig, ColumnId, MaterializedTable, QueryError, QueryResult, Row,
    RowChange, RowId, SqlValue, TableSchema,
};
use crate::domain::ports::SqlExecutor;
use crate::domain::sugar::desugar;
use crate::domain::test_support::{
    NASTY_FRAGMENTS, definition, entries_for, placement, random_number, random_string, rng, table,
    with_options,
};
use crate::domain::translate::translate;
use crate::outbound::rusqlite_executor::{ExecutorLimits, RusqliteExecutor};

type Links = HashMap<ColumnId, HashMap<RowId, Vec<RowId>>>;

fn executor() -> RusqliteExecutor {
    RusqliteExecutor::new(ExecutorLimits::default())
}

fn catalog_of(entries: &[TableEntry]) -> Catalog {
    Catalog {
        tables: schemas(entries).collect(),
    }
}

/// Materialize `entries` (main tables and junctions) and run `sql` through
/// the real executor, then translate the changeset.
fn run(
    entries: &[TableEntry],
    rows: &HashMap<Uuid, Vec<Row>>,
    links: &Links,
    sql: &str,
) -> Result<(Vec<QueryResult>, Vec<RowChange>), QueryError> {
    let mut tables: Vec<MaterializedTable> = Vec::new();
    for entry in entries {
        let table_rows = rows.get(&entry.table.id).cloned().unwrap_or_default();
        tables.push(materialize::user_table(entry, &table_rows, links));
        for junction in &entry.junctions {
            tables.push(materialize::junction(entry, junction, &table_rows, links));
        }
    }
    let (results, raw) = executor().execute(&catalog_of(entries), tables, &desugar(sql))?;
    Ok((results, translate(raw, entries)?))
}

/// Render a materialized value as a SQL literal, exactly as a user would
/// have to type it to write that value.
fn literal(value: &SqlValue) -> String {
    match value {
        SqlValue::Null => "NULL".to_string(),
        SqlValue::Integer(i) => i.to_string(),
        SqlValue::Real(f) => format!("{f:?}"),
        SqlValue::Text(t) => format!("'{}'", t.replace('\'', "''")),
    }
}

fn row(table_id: Uuid, cells: Vec<(Uuid, PropertyValue)>) -> Row {
    Row {
        id: Uuid::new_v4(),
        table_id,
        position: "0".into(),
        cells: cells.into_iter().collect(),
    }
}

/// One table `t` with a single column `col` bound to `def`.
fn single_column(def: &PropertyDefinitionWithOptions) -> TableEntry {
    let t = table(Uuid::new_v4(), "T");
    let cols = vec![placement(t.id, def, None)];
    entries_for(&t, &cols, std::slice::from_ref(def), AccessGrant::Edit).remove(0)
}

// ===== Family 1: round trip =====

/// Sort multi-valued cells so set-equality is a plain `==`.
fn canonical(value: PropertyValue) -> PropertyValue {
    match value {
        PropertyValue::SelectOption(mut ids) => {
            ids.sort();
            ids.dedup();
            PropertyValue::SelectOption(ids)
        }
        PropertyValue::EntityRef(mut refs) => {
            refs.sort_by(|a, b| a.entity_id.cmp(&b.entity_id));
            refs.dedup_by(|a, b| a.entity_id == b.entity_id);
            PropertyValue::EntityRef(refs)
        }
        PropertyValue::Link(mut urls) => {
            urls.sort();
            urls.dedup();
            PropertyValue::Link(urls)
        }
        other => other,
    }
}

/// The documented normal form a cell takes after a full round trip.
fn expected(
    def: &PropertyDefinitionWithOptions,
    original: &PropertyValue,
) -> Option<PropertyValue> {
    let d = &def.definition;
    let retyped = |r: &EntityReference| {
        EntityReference::new(
            r.entity_id.clone(),
            d.specific_entity_type.expect("entity columns carry a type"),
        )
    };
    let value = match original {
        PropertyValue::SelectOption(ids) if !d.is_multi_select => {
            PropertyValue::SelectOption(vec![*ids.first()?])
        }
        PropertyValue::EntityRef(refs) if !d.is_multi_select => {
            PropertyValue::EntityRef(vec![retyped(refs.first()?)])
        }
        PropertyValue::EntityRef(refs) => {
            PropertyValue::EntityRef(refs.iter().map(retyped).collect())
        }
        PropertyValue::Link(urls) if !d.is_multi_select => {
            PropertyValue::Link(vec![urls.first()?.clone()])
        }
        other => other.clone(),
    };
    Some(canonical(value))
}

/// Materialize `value`, write the materialized literal back through both an
/// `INSERT` and an `UPDATE` from NULL, and return the converted cell.
fn roundtrip(def: &PropertyDefinitionWithOptions, value: &PropertyValue) -> Option<PropertyValue> {
    let entry = single_column(def);
    let def_id = def.definition.id;
    let seeded = row(entry.table.id, vec![(def_id, value.clone())]);
    let materialized = materialize::user_table(&entry, &[seeded], &HashMap::new());
    let sql_value = materialized.rows[0][1].clone();
    let sql_literal = literal(&sql_value);

    let (_, inserted) = run(
        std::slice::from_ref(&entry),
        &HashMap::new(),
        &HashMap::new(),
        &format!("INSERT INTO t (col) VALUES ({sql_literal})"),
    )
    .unwrap_or_else(|e| panic!("insert of {value:?} as {sql_literal}: {e:?}"));
    let via_insert = match inserted.as_slice() {
        [RowChange::Insert { cells, .. }] => cells.get(&def_id).cloned(),
        other => panic!("expected one insert, got {other:?}"),
    };

    let blank = row(entry.table.id, vec![]);
    let (_, updated) = run(
        std::slice::from_ref(&entry),
        &HashMap::from([(entry.table.id, vec![blank])]),
        &HashMap::new(),
        &format!("UPDATE t SET col = {sql_literal}"),
    )
    .unwrap_or_else(|e| panic!("update of {value:?} as {sql_literal}: {e:?}"));
    let via_update: Option<SetPropertyValue> = match (updated.as_slice(), sql_value) {
        // Setting NULL on a NULL cell is not a change at all.
        ([], SqlValue::Null) => None,
        ([RowChange::Update { cells, .. }], _) => cells.get(&def_id).cloned().flatten(),
        (other, _) => panic!("expected one update, got {other:?}"),
    };
    assert_eq!(
        via_insert, via_update,
        "INSERT and UPDATE paths disagree for {value:?}"
    );
    via_insert
        .as_ref()
        .map(convert_set_property_value_to_property_value)
        .map(canonical)
}

fn assert_roundtrip(def: &PropertyDefinitionWithOptions, value: PropertyValue) {
    assert_eq!(
        roundtrip(def, &value),
        expected(def, &value),
        "{:?} multi={} value {value:?}",
        def.definition.data_type,
        def.definition.is_multi_select
    );
}

fn random_date(rng: &mut StdRng) -> DateTime<Utc> {
    let secs = rng.random_range(-2_000_000_000i64..4_000_000_000);
    let nanos = match rng.random_range(0..4) {
        0 => 0,
        1 => rng.random_range(0..1000) * 1_000_000,
        2 => rng.random_range(0..1_000_000) * 1000,
        _ => rng.random_range(0..1_000_000_000),
    };
    Utc.timestamp_opt(secs, nanos).single().expect("in range")
}

/// Distinct option labels (option display values are the lookup key, so a
/// definition with two identical labels is not round-trippable by design).
fn string_options(rng: &mut StdRng) -> Vec<PropertyOptionValue> {
    let mut labels: Vec<String> = Vec::new();
    while labels.len() < rng.random_range(1..6) {
        let label = random_string(rng);
        if !label.trim().is_empty() && !labels.contains(&label) {
            labels.push(label);
        }
    }
    labels
        .into_iter()
        .map(PropertyOptionValue::String)
        .collect()
}

fn number_options(rng: &mut StdRng) -> Vec<PropertyOptionValue> {
    let mut values: Vec<f64> = Vec::new();
    while values.len() < rng.random_range(1..6) {
        let n = random_number(rng);
        if !values.iter().any(|v| format_number(*v) == format_number(n)) {
            values.push(n);
        }
    }
    values
        .into_iter()
        .map(PropertyOptionValue::Number)
        .collect()
}

fn pick_options(rng: &mut StdRng, def: &PropertyDefinitionWithOptions, multi: bool) -> Vec<Uuid> {
    let n = if multi {
        rng.random_range(0..5)
    } else {
        rng.random_range(0..2)
    };
    (0..n)
        .map(|_| def.property_options[rng.random_range(0..def.property_options.len())].id)
        .collect()
}

fn random_refs(rng: &mut StdRng, multi: bool) -> Vec<EntityReference> {
    let n = if multi {
        rng.random_range(0..5)
    } else {
        rng.random_range(0..2)
    };
    (0..n)
        .map(|_| {
            let entity_type = if rng.random_bool(0.8) {
                PropertyEntityType::User
            } else {
                PropertyEntityType::Document
            };
            let id = random_string(rng);
            if rng.random_bool(0.2) {
                EntityReference::with_message_id(id, entity_type, Uuid::new_v4())
            } else {
                EntityReference::new(id, entity_type)
            }
        })
        .collect()
}

const ITERATIONS: usize = 40;

#[test]
fn roundtrip_booleans() {
    let def = definition("Col", DataType::Boolean, false);
    assert_roundtrip(&def, PropertyValue::Bool(true));
    assert_roundtrip(&def, PropertyValue::Bool(false));
}

#[test]
fn roundtrip_numbers() {
    let mut rng = rng(1);
    let def = definition("Col", DataType::Number, false);
    for _ in 0..ITERATIONS * 3 {
        assert_roundtrip(&def, PropertyValue::Num(random_number(&mut rng)));
    }
}

#[test]
fn roundtrip_strings() {
    let mut rng = rng(2);
    let def = definition("Col", DataType::String, false);
    for fragment in NASTY_FRAGMENTS {
        assert_roundtrip(&def, PropertyValue::Str(fragment.to_string()));
    }
    for _ in 0..ITERATIONS {
        assert_roundtrip(&def, PropertyValue::Str(random_string(&mut rng)));
    }
}

#[test]
fn roundtrip_dates() {
    let mut rng = rng(3);
    let def = definition("Col", DataType::Date, false);
    assert_roundtrip(
        &def,
        PropertyValue::Date(Utc.with_ymd_and_hms(2026, 9, 18, 0, 0, 0).unwrap()),
    );
    for _ in 0..ITERATIONS {
        assert_roundtrip(&def, PropertyValue::Date(random_date(&mut rng)));
    }
}

#[test]
fn roundtrip_links() {
    let mut rng = rng(4);
    for multi in [false, true] {
        let def = definition("Col", DataType::Link, multi);
        for _ in 0..ITERATIONS {
            let n = if multi {
                rng.random_range(0..5)
            } else {
                rng.random_range(0..2)
            };
            let urls = (0..n).map(|_| random_string(&mut rng)).collect();
            assert_roundtrip(&def, PropertyValue::Link(urls));
        }
    }
}

#[test]
fn roundtrip_select_options() {
    let mut rng = rng(5);
    for data_type in [
        DataType::SelectString,
        DataType::Tag,
        DataType::SelectNumber,
    ] {
        for multi in [false, true] {
            for _ in 0..ITERATIONS / 4 {
                let options = if data_type == DataType::SelectNumber {
                    number_options(&mut rng)
                } else {
                    string_options(&mut rng)
                };
                let def = with_options(definition("Col", data_type, multi), options);
                for _ in 0..4 {
                    let ids = pick_options(&mut rng, &def, multi);
                    assert_roundtrip(&def, PropertyValue::SelectOption(ids));
                }
            }
        }
    }
}

#[test]
fn roundtrip_entities() {
    let mut rng = rng(6);
    for multi in [false, true] {
        let def = definition("Col", DataType::Entity, multi);
        for _ in 0..ITERATIONS {
            assert_roundtrip(&def, PropertyValue::EntityRef(random_refs(&mut rng, multi)));
        }
    }
}

/// Loading a materialized row and selecting it back must be the identity,
/// for every type — including cells whose option was deleted after being
/// set (they materialize as the raw option id, which is not in the CHECK
/// list and must not make the whole query fail).
#[test]
fn materialized_values_survive_load() {
    let mut rng = rng(7);
    let mut defs: Vec<(PropertyDefinitionWithOptions, Vec<PropertyValue>)> = vec![
        (
            definition("Col", DataType::Boolean, false),
            vec![PropertyValue::Bool(true), PropertyValue::Bool(false)],
        ),
        (
            definition("Col", DataType::Number, false),
            (0..ITERATIONS)
                .map(|_| PropertyValue::Num(random_number(&mut rng)))
                .collect(),
        ),
        (
            definition("Col", DataType::String, false),
            NASTY_FRAGMENTS
                .iter()
                .map(|s| PropertyValue::Str(s.to_string()))
                .collect(),
        ),
        (
            definition("Col", DataType::Date, false),
            (0..ITERATIONS)
                .map(|_| PropertyValue::Date(random_date(&mut rng)))
                .collect(),
        ),
        (
            definition("Col", DataType::Entity, true),
            (0..ITERATIONS)
                .map(|_| PropertyValue::EntityRef(random_refs(&mut rng, true)))
                .collect(),
        ),
    ];
    let select = with_options(
        definition("Col", DataType::SelectString, false),
        string_options(&mut rng),
    );
    let ghost = Uuid::new_v4();
    defs.push((
        select.clone(),
        vec![
            PropertyValue::SelectOption(vec![select.property_options[0].id]),
            PropertyValue::SelectOption(vec![ghost]),
            PropertyValue::SelectOption(vec![]),
        ],
    ));

    for (def, values) in defs {
        let entry = single_column(&def);
        for value in values {
            let seeded = row(entry.table.id, vec![(def.definition.id, value.clone())]);
            let materialized =
                materialize::user_table(&entry, std::slice::from_ref(&seeded), &HashMap::new());
            let (results, changes) = run(
                std::slice::from_ref(&entry),
                &HashMap::from([(entry.table.id, vec![seeded])]),
                &HashMap::new(),
                "SELECT col FROM t",
            )
            .unwrap_or_else(|e| panic!("{value:?}: {e:?}"));
            assert!(changes.is_empty());
            assert_eq!(
                results[0].rows[0][0], materialized.rows[0][1],
                "value read back differs for {value:?}"
            );
        }
    }

    // A row holding a deleted option can still be read, deleted, and have
    // its other columns updated; only writing the stale label is refused.
    let t = table(Uuid::new_v4(), "T");
    let notes = definition("Notes", DataType::String, false);
    let entries = entries_for(
        &t,
        &[
            placement(t.id, &select, None),
            placement(t.id, &notes, None),
        ],
        &[select.clone(), notes.clone()],
        AccessGrant::Edit,
    );
    let stale = row(
        t.id,
        vec![(
            select.definition.id,
            PropertyValue::SelectOption(vec![ghost]),
        )],
    );
    let rows = HashMap::from([(t.id, vec![stale.clone()])]);
    let (results, changes) = run(
        &entries,
        &rows,
        &HashMap::new(),
        "UPDATE t SET notes = 'touched'; SELECT col, notes FROM t",
    )
    .unwrap();
    assert_eq!(results[0].rows[0][0], SqlValue::Text(ghost.to_string()));
    assert_eq!(results[0].rows[0][1], SqlValue::Text("touched".into()));
    assert_eq!(changes.len(), 1);
    let (_, changes) = run(&entries, &rows, &HashMap::new(), "DELETE FROM t").unwrap();
    assert_eq!(changes.len(), 1);
    assert!(
        sql_error(
            run(
                &entries,
                &rows,
                &HashMap::new(),
                &format!("UPDATE t SET col = '{ghost}'"),
            ),
            "stale label",
        )
        .contains("CHECK constraint failed")
    );
}

/// Values a user types that are not the materialized form but are still
/// meaningful: integers into number columns, numeric text into REAL, SQL
/// booleans, and dates without a time.
#[test]
fn roundtrip_accepts_user_spellings() {
    let write = |def: &PropertyDefinitionWithOptions, lit: &str| -> Option<PropertyValue> {
        let entry = single_column(def);
        let (_, changes) = run(
            std::slice::from_ref(&entry),
            &HashMap::new(),
            &HashMap::new(),
            &format!("INSERT INTO t (col) VALUES ({lit})"),
        )
        .unwrap_or_else(|e| panic!("{lit}: {e:?}"));
        match changes.as_slice() {
            [RowChange::Insert { cells, .. }] => cells
                .get(&def.definition.id)
                .map(convert_set_property_value_to_property_value),
            other => panic!("{other:?}"),
        }
    };
    let number = definition("Col", DataType::Number, false);
    assert_eq!(write(&number, "2"), Some(PropertyValue::Num(2.0)));
    assert_eq!(write(&number, "'2.5'"), Some(PropertyValue::Num(2.5)));
    assert_eq!(write(&number, "-1e3"), Some(PropertyValue::Num(-1000.0)));

    let boolean = definition("Col", DataType::Boolean, false);
    assert_eq!(write(&boolean, "TRUE"), Some(PropertyValue::Bool(true)));
    assert_eq!(write(&boolean, "0"), Some(PropertyValue::Bool(false)));
    assert_eq!(write(&boolean, "'1'"), Some(PropertyValue::Bool(true)));
    assert_eq!(
        write(&boolean, "7"),
        Some(PropertyValue::Bool(true)),
        "any non-zero integer is true"
    );

    let date = definition("Col", DataType::Date, false);
    assert_eq!(
        write(&date, "'2026-09-18'"),
        Some(PropertyValue::Date(
            Utc.with_ymd_and_hms(2026, 9, 18, 0, 0, 0).unwrap()
        )),
        "a bare date is midnight UTC"
    );
    assert_eq!(
        write(&date, "'2026-09-18T10:00:00-02:00'"),
        Some(PropertyValue::Date(
            Utc.with_ymd_and_hms(2026, 9, 18, 12, 0, 0).unwrap()
        )),
        "offsets normalize to UTC"
    );

    let text = definition("Col", DataType::String, false);
    assert_eq!(
        write(&text, "42"),
        Some(PropertyValue::Str("42".into())),
        "STRICT TEXT stores an integer as its text"
    );
    assert_eq!(write(&text, "NULL"), None, "NULL on insert writes nothing");
}

// ===== Family 2: schema compilation vs. executor enforcement =====

/// Hostile display names: keywords, reserved prefixes, punctuation only,
/// digits first, Unicode, and duplicates.
const HOSTILE_NAMES: &[&str] = &[
    "select",
    "FROM",
    "order",
    "sqlite_master",
    "sqlite_sequence",
    "row_id",
    "linked_id",
    "2024 budget",
    "!!!",
    "Plus ones (+1)",
    "日本語",
    "a\"b",
    "a'b",
    "Guests",
    "guests",
    "GUESTS!",
    "t__x",
    "json_each",
    "",
];

#[test]
fn generated_catalogs_compile_and_query() {
    let mut rng = rng(8);
    for _ in 0..ITERATIONS {
        let database = Uuid::new_v4();
        let n_tables = rng.random_range(1..4);
        let tables: Vec<_> = (0..n_tables)
            .map(|_| {
                table(
                    database,
                    HOSTILE_NAMES[rng.random_range(0..HOSTILE_NAMES.len())],
                )
            })
            .collect();
        let mut definitions = Vec::new();
        let mut columns = Vec::new();
        for t in &tables {
            for _ in 0..rng.random_range(0..6) {
                let name = HOSTILE_NAMES[rng.random_range(0..HOSTILE_NAMES.len())];
                let data_type = [
                    DataType::Boolean,
                    DataType::Number,
                    DataType::String,
                    DataType::Date,
                    DataType::Link,
                    DataType::SelectString,
                    DataType::SelectNumber,
                    DataType::Tag,
                    DataType::Entity,
                ][rng.random_range(0..9)];
                let multi = rng.random_bool(0.4);
                let mut def = definition(name, data_type, multi);
                if matches!(
                    data_type,
                    DataType::SelectString | DataType::SelectNumber | DataType::Tag
                ) {
                    let options = if data_type == DataType::SelectNumber {
                        number_options(&mut rng)
                    } else {
                        string_options(&mut rng)
                    };
                    def = with_options(def, options);
                }
                let config = rng.random_bool(0.2).then(|| ColumnConfig::Link {
                    database_id: database,
                    table_id: tables[rng.random_range(0..tables.len())].id,
                });
                columns.push(placement(t.id, &def, config));
                definitions.push(def);
            }
        }
        let definitions: HashMap<_, _> = definitions
            .into_iter()
            .map(|d| (d.definition.id, d))
            .collect();
        let grants = HashMap::from([(database, AccessGrant::Edit)]);
        let databases: Vec<crate::domain::models::Database> = grants
            .keys()
            .map(|id| crate::domain::models::Database {
                id: *id,
                name: format!("db {id}"),
                owner_id: "macro|tests@macro.com".to_string(),
                created_at: chrono::Utc::now(),
                trashed_at: None,
            })
            .collect();
        let entries =
            catalog::build_user_tables(&databases, &tables, &columns, &definitions, &grants, &[]);
        let catalog = catalog_of(&entries);

        let names: Vec<&str> = catalog.tables.iter().map(|t| t.sql_name.as_str()).collect();
        let mut unique = names.clone();
        unique.sort_unstable();
        unique.dedup();
        assert_eq!(unique.len(), names.len(), "SQL names collide: {names:?}");

        for schema in &catalog.tables {
            let column_names: Vec<&str> =
                schema.columns.iter().map(|c| c.sql_name.as_str()).collect();
            let mut unique = column_names.clone();
            unique.sort_unstable();
            unique.dedup();
            assert_eq!(
                unique.len(),
                column_names.len(),
                "column names collide in {}: {column_names:?}",
                schema.sql_name
            );
            let sql = format!("SELECT * FROM \"{}\"", schema.sql_name.replace('"', "\"\""));
            let deps = executor()
                .analyze(&catalog, &sql)
                .unwrap_or_else(|e| panic!("{sql} over {}: {e:?}", catalog_ddl(&catalog)));
            assert_eq!(
                deps.tables.len(),
                1,
                "SELECT * from one table depends on exactly it: {:?}",
                deps.tables.keys().collect::<Vec<_>>()
            );
            let read = &deps.tables[&schema.sql_name];
            assert_eq!(
                read.read_columns.len(),
                schema.columns.len(),
                "SELECT * reads every column of {}",
                schema.sql_name
            );
        }
        // Empty execution over the whole catalog: the DDL loads.
        let (results, _) = executor()
            .execute(
                &catalog,
                catalog
                    .tables
                    .iter()
                    .map(|schema| MaterializedTable {
                        schema: schema.clone(),
                        rows: vec![],
                    })
                    .collect(),
                "SELECT 1",
            )
            .unwrap_or_else(|e| panic!("{e:?} for {}", catalog_ddl(&catalog)));
        assert_eq!(results[0].rows[0][0], SqlValue::Integer(1));
    }
}

fn catalog_ddl(catalog: &Catalog) -> String {
    catalog
        .tables
        .iter()
        .flat_map(RusqliteExecutor::compile_ddl)
        .collect::<Vec<_>>()
        .join(";\n")
}

/// A table named after a SQLite-internal object must still be queryable.
#[test]
fn reserved_table_names_are_escaped() {
    let t = table(Uuid::new_v4(), "sqlite_master");
    let notes = definition("Notes", DataType::String, false);
    let entries = entries_for(
        &t,
        &[placement(t.id, &notes, None)],
        &[notes],
        AccessGrant::Edit,
    );
    let name = entries[0].schema.sql_name.clone();
    assert!(!name.starts_with("sqlite_"), "{name}");
    let deps = executor()
        .analyze(&catalog_of(&entries), &format!("SELECT notes FROM {name}"))
        .unwrap();
    assert!(deps.tables.contains_key(&name), "{:?}", deps.tables);
}

/// A guests table with one column of every constraint-bearing kind plus a
/// link column to itself, and both junction views.
struct Constrained {
    entries: Vec<TableEntry>,
    status: PropertyDefinitionWithOptions,
    tags: PropertyDefinitionWithOptions,
    link_column: ColumnId,
}

fn constrained() -> Constrained {
    let database = Uuid::new_v4();
    let t = table(database, "Guests");
    let status = with_options(
        definition("Status", DataType::SelectString, false),
        vec![
            PropertyOptionValue::String("Going".into()),
            PropertyOptionValue::String("it's \"quoted\", ok".into()),
        ],
    );
    let tags = with_options(
        definition("Tags", DataType::Tag, true),
        vec![PropertyOptionValue::String("vip".into())],
    );
    let plus_ones = definition("Plus ones", DataType::Number, false);
    let vip = definition("VIP", DataType::Boolean, false);
    let sessions = definition("Sessions", DataType::Entity, false);
    let mut columns = vec![
        placement(t.id, &status, None),
        placement(t.id, &tags, None),
        placement(t.id, &plus_ones, None),
        placement(t.id, &vip, None),
        placement(
            t.id,
            &sessions,
            Some(ColumnConfig::Link {
                database_id: database,
                table_id: t.id,
            }),
        ),
    ];
    let link_column = columns[4].id;
    columns
        .iter_mut()
        .enumerate()
        .for_each(|(i, c)| c.position = i.to_string());
    let entries = entries_for(
        &t,
        &columns,
        &[status.clone(), tags.clone(), plus_ones, vip, sessions],
        AccessGrant::Edit,
    );
    Constrained {
        entries,
        status,
        tags,
        link_column,
    }
}

fn sql_error(result: Result<(Vec<QueryResult>, Vec<RowChange>), QueryError>, sql: &str) -> String {
    match result {
        Err(QueryError::Sql(msg)) => msg,
        other => panic!("{sql}: expected Sql error, got {other:?}"),
    }
}

#[test]
fn every_claimed_constraint_rejects_its_bad_write() {
    let c = constrained();
    let row_a = row(c.entries[0].table.id, vec![]);
    let row_b = row(c.entries[0].table.id, vec![]);
    let rows = HashMap::from([(c.entries[0].table.id, vec![row_a.clone(), row_b.clone()])]);
    let no_links = Links::new();
    let exec = |sql: &str| run(&c.entries, &rows, &no_links, sql);

    // STRICT typing.
    assert!(
        sql_error(exec("UPDATE guests SET plus_ones = 'lots'"), "text→REAL")
            .contains("cannot store TEXT value in REAL column")
    );
    assert!(
        sql_error(exec("UPDATE guests SET vip = 1.5"), "fraction→INTEGER")
            .contains("cannot store REAL value in INTEGER column")
    );
    assert!(
        sql_error(exec("UPDATE guests SET vip = 'yes'"), "text→INTEGER").contains("cannot store")
    );

    // CHECK on single-select options, including a label with quotes.
    assert!(
        sql_error(exec("UPDATE guests SET status = 'Maybe'"), "bad option")
            .contains("CHECK constraint failed")
    );
    let (_, ok) = exec("UPDATE guests SET status = 'it''s \"quoted\", ok'").unwrap();
    assert_eq!(ok.len(), 2, "both rows updated to the quoted label");

    // Primary key: a duplicate row_id.
    let dup = format!("INSERT INTO guests (row_id) VALUES ('{}')", row_a.id);
    assert!(sql_error(exec(&dup), "duplicate pk").contains("UNIQUE constraint failed"));

    // NOT NULL on row_id.
    assert!(
        sql_error(exec("INSERT INTO guests (row_id) VALUES (NULL)"), "null pk")
            .contains("NOT NULL constraint failed")
    );

    // Junction: FK to the parent, NOT NULL on both keys, composite PK.
    assert!(
        sql_error(
            exec("INSERT INTO guests__sessions (row_id, linked_id) VALUES ('ghost', 'x')"),
            "fk"
        )
        .contains("FOREIGN KEY constraint failed")
    );
    assert!(
        sql_error(
            exec(&format!(
                "INSERT INTO guests__sessions (row_id, linked_id) VALUES ('{}', NULL)",
                row_a.id
            )),
            "null linked_id"
        )
        .contains("NOT NULL constraint failed")
    );
    assert!(
        sql_error(
            exec(&format!(
                "INSERT INTO guests__sessions (row_id, linked_id) VALUES ('{a}', '{b}'), ('{a}', '{b}')",
                a = row_a.id,
                b = row_b.id
            )),
            "duplicate edge"
        )
        .contains("UNIQUE constraint failed")
    );

    // Multi-valued columns carry no CHECK; translate validates the labels.
    match exec("UPDATE guests SET tags = '[\"nope\"]'") {
        Err(QueryError::UntranslatableChange(msg)) => {
            assert!(msg.contains("not an option"), "{msg}")
        }
        other => panic!("{other:?}"),
    }
    match exec("UPDATE guests SET tags = 'vip'") {
        Err(QueryError::UntranslatableChange(msg)) => {
            assert!(msg.contains("JSON array"), "{msg}")
        }
        other => panic!("{other:?}"),
    }
    match exec("UPDATE guests SET tags = '{\"a\":1}'") {
        Err(QueryError::UntranslatableChange(msg)) => {
            assert!(msg.contains("JSON array"), "{msg}")
        }
        other => panic!("{other:?}"),
    }
    let (_, ok) = exec("UPDATE guests SET tags = '[\"vip\", \"vip\"]'").unwrap();
    let RowChange::Update { cells, .. } = &ok[0] else {
        panic!("{ok:?}")
    };
    assert_eq!(
        cells[&c.tags.definition.id],
        Some(SetPropertyValue::MultiSelectOption {
            option_ids: vec![c.tags.property_options[0].id, c.tags.property_options[0].id]
        }),
        "duplicates are the converter's job to collapse"
    );
    let _ = &c.status;
    let _ = c.link_column;
}

// ===== Family 3: changeset translation over real changesets =====

#[test]
fn inserts_default_row_id_and_ignore_a_supplied_one() {
    let c = constrained();
    let no_rows = HashMap::new();
    let no_links = Links::new();
    let (_, changes) = run(
        &c.entries,
        &no_rows,
        &no_links,
        "INSERT INTO guests (status) VALUES ('Going')",
    )
    .unwrap();
    assert_eq!(changes.len(), 1);
    let RowChange::Insert { table_id, cells } = &changes[0] else {
        panic!("{:?}", changes[0])
    };
    assert_eq!(*table_id, c.entries[0].table.id);
    assert_eq!(cells.len(), 1, "unset columns are not writes: {cells:?}");

    // Row ids are minted by the server; a caller-supplied one is refused.
    let err = run(
        &c.entries,
        &no_rows,
        &no_links,
        "INSERT INTO guests (row_id, plus_ones) VALUES ('mine', 3)",
    )
    .unwrap_err();
    assert!(
        matches!(&err, QueryError::UntranslatableChange(msg) if msg.contains("assigned by the server")),
        "{err:?}"
    );
}

#[test]
fn updates_report_only_changed_columns_and_null_clears() {
    let c = constrained();
    let def_status = c.status.definition.id;
    let plus_ones = c.entries[0].columns[2].definition.definition.id;
    let seeded = row(
        c.entries[0].table.id,
        vec![
            (
                def_status,
                PropertyValue::SelectOption(vec![c.status.property_options[0].id]),
            ),
            (plus_ones, PropertyValue::Num(2.0)),
        ],
    );
    let rows = HashMap::from([(c.entries[0].table.id, vec![seeded.clone()])]);
    let no_links = Links::new();

    let (_, changes) = run(
        &c.entries,
        &rows,
        &no_links,
        "UPDATE guests SET status = status, plus_ones = plus_ones + 1, vip = NULL",
    )
    .unwrap();
    let RowChange::Update { row_id, cells, .. } = &changes[0] else {
        panic!("{changes:?}")
    };
    assert_eq!(*row_id, seeded.id);
    assert_eq!(cells.len(), 1, "status unchanged, vip NULL→NULL: {cells:?}");
    assert_eq!(
        cells[&plus_ones],
        Some(SetPropertyValue::Number { value: 3.0 })
    );

    let (_, changes) = run(
        &c.entries,
        &rows,
        &no_links,
        "UPDATE guests SET plus_ones = NULL, status = NULL",
    )
    .unwrap();
    let RowChange::Update { cells, .. } = &changes[0] else {
        panic!("{changes:?}")
    };
    assert_eq!(cells.len(), 2);
    assert!(cells.values().all(Option::is_none), "{cells:?}");

    let (_, changes) = run(
        &c.entries,
        &rows,
        &no_links,
        "UPDATE guests SET plus_ones = 2.0",
    )
    .unwrap();
    assert!(
        changes.is_empty(),
        "writing the current value is not a change"
    );
}

#[test]
fn batches_coalesce_per_row() {
    let c = constrained();
    let seeded = row(c.entries[0].table.id, vec![]);
    let rows = HashMap::from([(c.entries[0].table.id, vec![seeded.clone()])]);
    let no_links = Links::new();

    // Insert then update the new row: one insert carrying the final values.
    let (_, changes) = run(
        &c.entries,
        &rows,
        &no_links,
        "INSERT INTO guests (status, plus_ones) VALUES ('Going', 1); \
         UPDATE guests SET plus_ones = 5 WHERE status = 'Going'",
    )
    .unwrap();
    assert_eq!(changes.len(), 1);
    let RowChange::Insert { cells, .. } = &changes[0] else {
        panic!("{changes:?}")
    };
    assert_eq!(
        cells[&c.entries[0].columns[2].definition.definition.id],
        SetPropertyValue::Number { value: 5.0 }
    );

    // Insert then delete: nothing happened.
    let (_, changes) = run(
        &c.entries,
        &rows,
        &no_links,
        "INSERT INTO guests (status) VALUES ('Going'); DELETE FROM guests WHERE status = 'Going'",
    )
    .unwrap();
    assert!(changes.is_empty(), "{changes:?}");

    // Update then delete an existing row: a single delete.
    let (_, changes) = run(
        &c.entries,
        &rows,
        &no_links,
        &format!(
            "UPDATE guests SET plus_ones = 9 WHERE row_id = '{id}'; DELETE FROM guests WHERE row_id = '{id}'",
            id = seeded.id
        ),
    )
    .unwrap();
    assert_eq!(
        changes,
        vec![RowChange::Delete {
            table_id: c.entries[0].table.id,
            row_id: seeded.id
        }]
    );
}

#[test]
fn executor_refuses_read_only_targets_before_a_changeset_exists() {
    let c = constrained();
    let seeded = row(c.entries[0].table.id, vec![]);
    let rows = HashMap::from([(c.entries[0].table.id, vec![seeded.clone()])]);
    let no_links = Links::new();
    let read_only = |sql: &str, needle: &str| match run(&c.entries, &rows, &no_links, sql) {
        Err(QueryError::ReadOnly(msg)) => assert!(msg.contains(needle), "{sql}: {msg}"),
        other => panic!("{sql}: {other:?}"),
    };
    read_only("UPDATE guests SET sessions = '[]'", "sessions");
    read_only("UPDATE guests SET row_id = 'x'", "row_id");
    read_only(
        &format!(
            "INSERT INTO guests__tags (row_id, linked_id) VALUES ('{}', 'vip')",
            seeded.id
        ),
        "guests__tags",
    );
    read_only("DELETE FROM guests__tags", "guests__tags");

    // A View grant compiles every table read-only.
    let t = table(Uuid::new_v4(), "T");
    let notes = definition("Notes", DataType::String, false);
    let entries = entries_for(
        &t,
        &[placement(t.id, &notes, None)],
        &[notes],
        AccessGrant::View,
    );
    match run(
        &entries,
        &HashMap::new(),
        &no_links,
        "INSERT INTO t (notes) VALUES ('x')",
    ) {
        Err(QueryError::ReadOnly(msg)) => assert!(msg.contains("read-only"), "{msg}"),
        other => panic!("{other:?}"),
    }
}

#[test]
fn junction_writes_become_links_and_fresh_rows_cannot_be_linked() {
    let c = constrained();
    let table_id = c.entries[0].table.id;
    let a = row(table_id, vec![]);
    let b = row(table_id, vec![]);
    let rows = HashMap::from([(table_id, vec![a.clone(), b.clone()])]);
    let links: Links = HashMap::from([(c.link_column, HashMap::from([(a.id, vec![b.id])]))]);

    let (results, changes) = run(
        &c.entries,
        &rows,
        &links,
        &format!(
            "DELETE FROM guests__sessions WHERE row_id = '{a}' AND linked_id = '{b}'; \
             INSERT INTO guests__sessions (row_id, linked_id) VALUES ('{b}', '{a}'); \
             SELECT sessions FROM guests WHERE row_id = '{b}'",
            a = a.id,
            b = b.id
        ),
    )
    .unwrap();
    assert_eq!(
        results[0].rows[0][0],
        SqlValue::Text("[]".into()),
        "the JSON mirror reflects Postgres, not junction writes made in the same batch"
    );
    assert_eq!(changes.len(), 2);
    assert!(changes.contains(&RowChange::Unlink {
        column_id: c.link_column,
        source_row_id: a.id,
        target_row_id: b.id
    }));
    assert!(changes.contains(&RowChange::Link {
        column_id: c.link_column,
        source_row_id: b.id,
        target_row_id: a.id
    }));

    // The FK is satisfied inside SQLite (the row exists in the scratch DB),
    // so this must be refused by translate with the documented message.
    let err = run(
        &c.entries,
        &rows,
        &links,
        &format!(
            "INSERT INTO guests (status) VALUES ('Going'); \
             INSERT INTO guests__sessions (row_id, linked_id) \
             SELECT row_id, '{}' FROM guests WHERE status = 'Going'",
            b.id
        ),
    )
    .unwrap_err();
    match err {
        QueryError::UntranslatableChange(msg) => {
            assert!(msg.contains("same statement"), "{msg}")
        }
        other => panic!("{other:?}"),
    }
}

// ===== Family 4: HAS against real data =====

#[test]
fn has_membership_is_correct_on_json_and_link_columns() {
    let c = constrained();
    let table_id = c.entries[0].table.id;
    let tags_id = c.tags.definition.id;
    let vip = c.tags.property_options[0].id;
    let with_tag = row(
        table_id,
        vec![(tags_id, PropertyValue::SelectOption(vec![vip]))],
    );
    let empty_tags = row(
        table_id,
        vec![(tags_id, PropertyValue::SelectOption(vec![]))],
    );
    let no_tags = row(table_id, vec![]);
    let rows = HashMap::from([(
        table_id,
        vec![with_tag.clone(), empty_tags.clone(), no_tags.clone()],
    )]);
    let links: Links = HashMap::from([(
        c.link_column,
        HashMap::from([(no_tags.id, vec![with_tag.id])]),
    )]);
    let ids = |results: Vec<QueryResult>| -> Vec<String> {
        results[0]
            .rows
            .iter()
            .map(|r| match &r[0] {
                SqlValue::Text(t) => t.clone(),
                other => panic!("{other:?}"),
            })
            .collect()
    };

    let (results, _) = run(
        &c.entries,
        &rows,
        &links,
        "SELECT row_id FROM guests g WHERE g.tags HAS 'vip' ORDER BY row_id",
    )
    .unwrap();
    assert_eq!(ids(results), vec![with_tag.id.to_string()]);

    let (results, _) = run(
        &c.entries,
        &rows,
        &links,
        "SELECT row_id FROM guests WHERE tags HAS 'nope'",
    )
    .unwrap();
    assert!(ids(results).is_empty());

    let (results, _) = run(
        &c.entries,
        &rows,
        &links,
        "SELECT row_id FROM guests WHERE NOT (tags HAS 'vip') ORDER BY row_id",
    )
    .unwrap();
    assert_eq!(
        ids(results),
        {
            let mut both = vec![empty_tags.id.to_string(), no_tags.id.to_string()];
            both.sort();
            both
        },
        "json_each(NULL) yields no rows, so a NULL cell behaves like an empty array"
    );

    let (results, _) = run(
        &c.entries,
        &rows,
        &links,
        &format!(
            "SELECT row_id FROM guests WHERE \"sessions\" HAS '{}'",
            with_tag.id
        ),
    )
    .unwrap();
    assert_eq!(ids(results), vec![no_tags.id.to_string()]);

    let (results, _) = run(
        &c.entries,
        &rows,
        &links,
        "SELECT count(*) FROM guests WHERE tags has 'vip' AND status IS NULL",
    )
    .unwrap();
    assert_eq!(results[0].rows[0][0], SqlValue::Integer(1));
}

/// `json_each` and CTE/subquery aliases are not catalog tables and must not
/// leak into the dependency set the service materializes from.
#[test]
fn analyze_reports_only_catalog_tables() {
    let c = constrained();
    let catalog = catalog_of(&c.entries);
    let deps = executor()
        .analyze(
            &catalog,
            &desugar(
                "WITH going AS (SELECT row_id FROM guests WHERE status = 'Going') \
                 SELECT g.row_id FROM going g JOIN (SELECT row_id AS r FROM guests) s ON s.r = g.row_id \
                 JOIN guests g2 ON g2.row_id = g.row_id \
                 WHERE EXISTS (SELECT 1 FROM guests__tags j WHERE j.row_id = g.row_id) \
                 AND g2.tags HAS 'vip'",
            ),
        )
        .unwrap();
    let mut names: Vec<&String> = deps.tables.keys().collect();
    names.sort();
    assert_eq!(names, vec!["guests", "guests__tags"]);
    let _ = &c.status;
}

fn assert_schema_columns(schema: &TableSchema, expected: &[&str]) {
    let names: Vec<&str> = schema.columns.iter().map(|c| c.sql_name.as_str()).collect();
    assert_eq!(names, expected);
}

#[test]
fn constrained_fixture_has_the_expected_shape() {
    let c = constrained();
    assert_schema_columns(
        &c.entries[0].schema,
        &["row_id", "status", "tags", "plus_ones", "vip", "sessions"],
    );
    let junctions: Vec<&str> = c.entries[0]
        .junctions
        .iter()
        .map(|j| j.schema.sql_name.as_str())
        .collect();
    assert_eq!(junctions, vec!["guests__tags", "guests__sessions"]);
}
