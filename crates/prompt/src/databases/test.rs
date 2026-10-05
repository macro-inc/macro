use crate::{
    DATABASE_TOOL_USE_PROMPT, DIRECT_TOOL_USE_PROMPT, SESSION_TOOL_USE_PROMPT, TOOL_USE_PROMPT,
};

#[test]
fn database_workflow_reaches_every_agent_host_without_unrelated_scoped_tools() {
    for prompt in [
        &DATABASE_TOOL_USE_PROMPT,
        &DIRECT_TOOL_USE_PROMPT,
        &SESSION_TOOL_USE_PROMPT,
        &TOOL_USE_PROMPT,
    ] {
        let text = prompt.to_string();
        for capability in [
            "ListDatabases",
            "tables[].name",
            "DescribeDatabase",
            "sqlName",
            "SaveDatabaseView",
            "insertedRowIds",
            "cannot save charts",
            "CREATE DATABASE",
            "ALTER TABLE",
            "RENAME COLUMN",
            "DROP COLUMN",
            "REORDER COLUMNS",
            "REORDER TABLES",
            "SaveDatabaseQuery",
            "<m-db-query>",
            "verbatim",
            "databaseId",
            "macro.people",
            "entity(USER)",
            "ListTeamMembers",
            "single-select or single-person column",
            "DeleteDatabaseView",
        ] {
            assert!(
                text.contains(capability),
                "missing database guidance: {capability}"
            );
        }
    }
    let text = TOOL_USE_PROMPT.to_string();
    assert!(!text.contains("clearInvalid"), "casts never clear values");
    let scoped = DATABASE_TOOL_USE_PROMPT.to_string();
    assert_eq!(scoped, format!("{}{}", crate::BASE_PROMPT, super::PROMPT));
    // BASE_PROMPT's Markdown formatting note mentions email bodies without
    // granting an email tool; the scoped prompt must omit its action rules.
    assert!(!scoped.contains("MUST use the `SendEmail` tool"));
    assert!(!scoped.contains("PendingUserExecution"));
}

#[test]
fn database_prompts_do_not_advertise_removed_schema_tools() {
    let text = DATABASE_TOOL_USE_PROMPT.to_string();
    for removed in [
        "`CreateDatabase`",
        "`CreateTable`",
        "`RenameTable`",
        "`AddColumn`",
        "`ChangeColumnType`",
    ] {
        assert!(!text.contains(removed), "obsolete tool {removed}");
    }
    let read_only = crate::DATABASE_READ_ONLY_TOOL_USE_PROMPT.to_string();
    assert!(read_only.contains("QueryDatabase's registered description"));
    assert!(read_only.contains("This host is read-only"));
    assert!(!read_only.contains("SaveDatabaseQuery"));
}
