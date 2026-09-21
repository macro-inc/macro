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
            "readSqlName",
            "SaveDatabaseView",
            "insertedRowIds",
            "cannot save charts",
        ] {
            assert!(
                text.contains(capability),
                "missing database guidance: {capability}"
            );
        }
    }
    let scoped = DATABASE_TOOL_USE_PROMPT.to_string();
    assert_eq!(scoped, format!("{}{}", crate::BASE_PROMPT, super::PROMPT));
    // BASE_PROMPT's Markdown formatting note mentions email bodies without
    // granting an email tool; the scoped prompt must omit its action rules.
    assert!(!scoped.contains("MUST use the `SendEmail` tool"));
    assert!(!scoped.contains("PendingUserExecution"));
}
