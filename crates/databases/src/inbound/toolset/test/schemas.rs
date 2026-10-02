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
