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
        for rule in [
            "check every database's tables",
            "entity(USER)",
            "Never use text for people",
            "Never invent a person or an id",
            "never fake it with text",
            "explicit delete or clear",
            "authorizes that operation",
            "read back the affected schema or rows",
            "saved live query block",
        ] {
            assert!(text.contains(rule), "missing database rule: {rule}");
        }
        // How to call the database tools is in their descriptions, not here.
        for tool in [
            "SaveDatabaseQuery",
            "DescribeDatabase",
            "ALTER TABLE",
            "macro.people",
        ] {
            assert!(!text.contains(tool), "tool how-to in the prompt: {tool}");
        }
    }
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
