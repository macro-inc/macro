//! A selected database takes precedence without hiding qualified tables.

use super::*;
use crate::resolve::{Query, ResolveError};
use crate::{CompileError, compile};

fn schema() -> Schema {
    let mut schema: Schema = serde_json::from_value(fixture("scoped")["schema"].clone()).unwrap();
    schema.databases[1].name = "Archive".into();
    schema.databases[1].tables[0].name = "Contacts".into();
    schema
}

#[test]
fn unqualified_reads_prefer_the_selected_database_after_a_wire_round_trip() {
    let schema = schema();
    for database in &schema.databases {
        let catalog = build(&schema, Some(database.id));
        let catalog = serde_json::from_value(serde_json::to_value(catalog).unwrap()).unwrap();
        let Query::Select(select) = compile(&catalog, "SELECT row_id FROM Contacts").unwrap()
        else {
            panic!("a select");
        };
        let expected = database
            .tables
            .iter()
            .find(|table| table.name == "Contacts")
            .unwrap();
        assert_eq!(select.relations[0].table, expected.id);
    }
}

#[test]
fn the_selected_database_wins_over_an_exact_spelling_in_another_database() {
    let mut schema = schema();
    schema.databases[1].tables[0].name = "contacts".into();
    let catalog = build(&schema, Some(schema.databases[1].id));
    let Query::Select(select) = compile(&catalog, "SELECT row_id FROM Contacts").unwrap() else {
        panic!("a select");
    };
    assert_eq!(select.relations[0].table, schema.databases[1].tables[0].id);
}

#[test]
fn unqualified_writes_prefer_the_selected_database() {
    let schema = schema();
    let catalog = build(&schema, Some(schema.databases[1].id));
    for sql in [
        "INSERT INTO Contacts (Email) VALUES ('a@example.com')",
        "UPDATE Contacts SET Email = 'a@example.com' WHERE Email IS NOT NULL",
        "DELETE FROM Contacts WHERE Email IS NOT NULL",
        "ALTER TABLE Contacts ALTER COLUMN Email TYPE TEXT",
    ] {
        let table = match compile(&catalog, sql).unwrap() {
            Query::Insert(query) => query.table,
            Query::Update(query) => query.table,
            Query::Delete(query) => query.table,
            Query::AlterColumnType(query) => query.table,
            Query::Select(_) => panic!("a write"),
        };
        assert_eq!(table, schema.databases[1].tables[0].id, "{sql}");
    }
}

#[test]
fn qualified_joins_keep_both_databases_available() {
    let schema = schema();
    let catalog = build(&schema, Some(schema.databases[0].id));
    let Query::Select(select) = compile(
        &catalog,
        "SELECT a.row_id, b.row_id FROM CRM.Contacts a \
         JOIN Archive.Contacts b ON a.row_id = b.row_id",
    )
    .unwrap() else {
        panic!("a select");
    };
    assert_eq!(
        select
            .relations
            .iter()
            .map(|relation| relation.table)
            .collect::<Vec<_>>(),
        vec![
            schema.databases[0].tables[1].id,
            schema.databases[1].tables[0].id
        ]
    );
}

#[test]
fn unscoped_duplicates_remain_ambiguous() {
    let catalog = build(&schema(), None);
    assert!(matches!(
        compile(&catalog, "SELECT row_id FROM Contacts"),
        Err(CompileError::Resolve(ResolveError::AmbiguousTable { .. }))
    ));
}

#[test]
fn a_unique_name_outside_the_selected_database_still_resolves() {
    let schema = schema();
    let catalog = build(&schema, Some(schema.databases[0].id));
    let Query::Select(select) = compile(&catalog, "SELECT row_id FROM Leads").unwrap() else {
        panic!("a select");
    };
    assert_eq!(select.relations[0].table, schema.databases[1].tables[1].id);
}
