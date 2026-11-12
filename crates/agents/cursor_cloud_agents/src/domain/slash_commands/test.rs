use super::*;

#[test]
fn catalog_names_are_unique_and_stable() {
    let names: Vec<&str> = CATALOG.iter().map(|entry| entry.name).collect();
    let mut sorted = names.clone();
    sorted.sort_unstable();
    sorted.dedup();
    assert_eq!(
        names, sorted,
        "catalog must stay unique and alphabetically ordered"
    );
}

#[test]
fn catalog_includes_cloud_skills_and_omits_local_only_ones() {
    let names: Vec<&str> = CATALOG.iter().map(|entry| entry.name).collect();
    for required in ["goal", "loop", "review", "env-setup", "subscribe", "shell"] {
        assert!(
            names.contains(&required),
            "{required} is a cloud-usable Cursor skill and must be advertised"
        );
    }
    for excluded in [
        "rename-chat",
        "statusline",
        "clone",
        "update-cursor-settings",
    ] {
        assert!(
            !names.contains(&excluded),
            "{excluded} is local/IDE-only and must not be advertised"
        );
    }
}

#[test]
fn advertised_commands_carry_hints_only_when_the_skill_parses_leftover_text() {
    let commands = cursor_slash_commands();
    let hint = |name: &str| {
        commands
            .iter()
            .find(|command| command.name == name)
            .and_then(|command| match &command.input {
                Some(AvailableCommandInput::Unstructured(input)) => Some(input.hint.as_str()),
                _ => None,
            })
    };
    assert_eq!(hint("goal"), Some("<objective>"));
    assert_eq!(hint("loop"), Some("[interval] <prompt>"));
    assert_eq!(hint("shell"), Some("<command>"));
    assert_eq!(hint("review"), None);
}

#[test]
fn advertised_commands_are_pinned_whole() {
    let commands: Vec<serde_json::Value> = cursor_slash_commands()
        .into_iter()
        .map(|command| serde_json::to_value(command).expect("commands serialize"))
        .collect();
    insta::assert_json_snapshot!(commands);
}
