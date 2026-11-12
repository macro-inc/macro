use super::*;

#[test]
fn read_description_uses_bound_tables_not_sql_text() {
    let catalog = catalog();
    let read = describe_read(
        &catalog,
        "SELECT d.name FROM crm.deals d WHERE d.name = 'macro.people'",
    )
    .expect("read");
    assert_eq!(read.read_tables, [DEALS]);
    let joined = describe_read(
        &catalog,
        "SELECT d.name, p.email FROM crm.deals d JOIN macro.people p ON d.owner = p.id",
    )
    .expect("join");
    assert_eq!(joined.read_tables, [DEALS, crate::catalog::PEOPLE_TABLE]);
    assert_eq!(joined.columns.len(), 2);
    assert_eq!(joined.columns[1].column, Some(crate::catalog::PEOPLE_EMAIL));
    let mut scoped = catalog.clone();
    scoped.scope = Some(CRM);
    assert_eq!(
        describe_read(&scoped, "SELECT name FROM people")
            .expect("scoped table")
            .read_tables,
        [PEOPLE]
    );
}

#[test]
fn descriptions_reject_writes_including_schema_commands_without_reading_rows() {
    for sql in [
        "DELETE FROM crm.deals WHERE name = 'old'",
        "INSERT INTO crm.deals (name) VALUES ('new')",
        "UPDATE crm.deals SET name = 'new' WHERE name = 'old'",
        "CREATE DATABASE \"New\"",
    ] {
        assert_eq!(
            describe_read(&catalog(), sql),
            Err(RunError::ReadOnly),
            "{sql}"
        );
    }
}
