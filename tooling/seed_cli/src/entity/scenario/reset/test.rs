use super::*;

#[test]
fn statements_scope_to_the_marker() {
    let statements = reset_statements("5eedabcd");
    assert!(!statements.is_empty());
    for statement in &statements {
        assert!(
            statement.contains("5eedabcd%"),
            "statement must be marker-scoped: {statement}"
        );
        assert!(
            !statement.contains(';'),
            "statements must be standalone (no embedded semicolons): {statement}"
        );
    }
}

#[test]
fn covers_every_seeded_table() {
    let all = reset_statements("5eed").join("\n");
    for table in [
        "\"SharePermission\"",
        "\"ChannelSharePermission\"",
        "\"DocumentPermission\"",
        "\"ChatPermission\"",
        "\"ProjectPermission\"",
        "\"EmailThreadPermission\"",
        "entity_access",
        "entity_properties",
        "notification",
        "comms_entity_mentions",
        "comms_activity",
        "comms_channels",
        "call_records",
        "calls",
        "email_links",
        "\"Document\"",
        "\"Chat\"",
        "\"Project\"",
        "team_invite",
        "team_user",
        "team",
        "\"RolesOnUsers\"",
        "macro_user_email_verification",
        "macro_user_info",
        "\"User\"",
        "macro_user",
    ] {
        assert!(all.contains(table), "missing table {table}");
    }
}
