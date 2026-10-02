use super::*;

#[test]
fn every_tool_schema_is_valid() {
    assert_eq!(
        generate_validated_input_schema::<SaveDatabaseView>()
            .expect("view schema validates")
            .name,
        "SaveDatabaseView"
    );
    assert_eq!(
        generate_validated_input_schema::<DeleteDatabaseView>()
            .expect("schema should validate")
            .name,
        "DeleteDatabaseView"
    );
    assert_eq!(
        generate_validated_input_schema::<ListDatabases>()
            .expect("schema should validate")
            .name,
        "ListDatabases"
    );
    assert_eq!(
        generate_validated_input_schema::<DescribeDatabase>()
            .expect("schema should validate")
            .name,
        "DescribeDatabase"
    );
    assert_eq!(
        generate_validated_input_schema::<CreateDatabase>()
            .expect("schema should validate")
            .name,
        "CreateDatabase"
    );
    assert_eq!(
        generate_validated_input_schema::<CreateTable>()
            .expect("schema should validate")
            .name,
        "CreateTable"
    );
    assert_eq!(
        generate_validated_input_schema::<RenameTable>()
            .expect("schema should validate")
            .name,
        "RenameTable"
    );
    assert_eq!(
        generate_validated_input_schema::<AddColumn>()
            .expect("schema should validate")
            .name,
        "AddColumn"
    );
    assert_eq!(
        generate_validated_input_schema::<AddColumnOptions>()
            .expect("schema should validate")
            .name,
        "AddColumnOptions"
    );
    assert_eq!(
        generate_validated_input_schema::<RenameDatabase>()
            .expect("schema should validate")
            .name,
        "RenameDatabase"
    );
    assert_eq!(
        generate_validated_input_schema::<DeleteTable>()
            .expect("schema should validate")
            .name,
        "DeleteTable"
    );
    assert_eq!(
        generate_validated_input_schema::<RenameColumn>()
            .expect("schema should validate")
            .name,
        "RenameColumn"
    );
    assert_eq!(
        generate_validated_input_schema::<ChangeColumnType>()
            .expect("schema should validate")
            .name,
        "ChangeColumnType"
    );
    assert_eq!(
        generate_validated_input_schema::<DeleteColumn>()
            .expect("schema should validate")
            .name,
        "DeleteColumn"
    );
    assert_eq!(
        generate_validated_input_schema::<ReorderColumns>()
            .expect("schema should validate")
            .name,
        "ReorderColumns"
    );
    assert_eq!(
        generate_validated_input_schema::<ReorderTables>()
            .expect("schema should validate")
            .name,
        "ReorderTables"
    );
}

/// Every tool has to survive being put in a collection — that is where name
/// conflicts and schema rejections actually surface.
#[test]
fn archival_toolset_keeps_only_retired_tools() {
    let toolset = databases_legacy_toolset::<FakeService, FakeAccess>();

    for name in [
        "CreateDatabase",
        "CreateTable",
        "RenameDatabase",
        "RenameTable",
        "ReorderTables",
        "DeleteTable",
        "AddColumn",
        "AddColumnOptions",
        "RenameColumn",
        "ChangeColumnType",
        "DeleteColumn",
        "ReorderColumns",
    ] {
        assert!(toolset.tools.contains_key(name), "missing {name}");
    }
    assert_eq!(toolset.tools.len(), 12);
    assert!(
        toolset.user_tools.is_empty(),
        "database tools run in the loop, none are user-executed"
    );
}

#[test]
fn the_read_only_toolset_only_discovers() {
    let toolset = databases_read_only_toolset::<FakeService, FakeAccess>();

    let mut names: Vec<&str> = toolset.tools.keys().map(String::as_str).collect();
    names.sort_unstable();
    assert_eq!(names, ["DescribeDatabase", "ListDatabases"]);
}

#[test]
fn runtime_omits_operations_now_exposed_through_sql() {
    let toolset = databases_toolset::<FakeService, FakeAccess>();
    let mut names: Vec<_> = toolset.tools.keys().map(String::as_str).collect();
    names.sort_unstable();
    assert_eq!(
        names,
        [
            "DeleteDatabaseView",
            "DescribeDatabase",
            "ListDatabases",
            "SaveDatabaseView"
        ]
    );
}
