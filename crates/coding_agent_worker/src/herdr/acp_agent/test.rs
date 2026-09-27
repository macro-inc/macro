use super::*;

#[test]
fn agent_names_satisfy_herdr() {
    let name = agent_name("A2089F46-70e2-4439-935e-1b9c23319df1");
    assert_eq!(name, "macro-a2089f4670e2");
    assert!(name.len() <= 32);
}

#[test]
fn prompts_keep_text_and_reference_files() {
    let prompt = json!([
        {"type": "text", "text": "build a todo app"},
        {"type": "resource_link", "uri": "file:///repo/spec.md", "name": "spec.md"},
        {"type": "image", "data": "..."},
    ]);
    assert_eq!(prompt_text(&prompt), "build a todo app\n@/repo/spec.md");
}

#[test]
fn macro_mcp_servers_become_claude_config() {
    let servers = [
        json!({"type": "http", "name": "macro", "url": "https://x/mcp",
            "headers": [{"name": "Authorization", "value": "Bearer t"}]}),
        json!({"name": "local", "command": "srv", "args": ["--x"], "env": [{"name": "K", "value": "V"}]}),
        json!({"type": "http", "url": "https://nameless"}),
    ];
    assert_eq!(
        Value::Object(claude_mcp_servers(&servers)),
        json!({
            "macro": {"type": "http", "url": "https://x/mcp", "headers": {"Authorization": "Bearer t"}},
            "local": {"command": "srv", "args": ["--x"], "env": {"K": "V"}},
        })
    );
}

#[test]
fn the_model_option_lists_claude_aliases() {
    let options = config_options("sonnet");
    assert_eq!(options[0]["id"], MODEL_CONFIG_ID);
    assert_eq!(options[0]["currentValue"], "sonnet");
    let values: Vec<_> = options[0]["options"]
        .as_array()
        .unwrap()
        .iter()
        .map(|option| option["value"].as_str().unwrap())
        .collect();
    assert_eq!(values, ["default", "opus", "sonnet", "haiku"]);
}

#[test]
fn an_open_tool_is_forgotten_once_it_reports() {
    let mut open = None;
    track_open_tool(
        &mut open,
        &json!({"sessionUpdate": "tool_call", "toolCallId": "t", "title": "Bash ls"}),
    );
    assert_eq!(open, Some(("t".to_owned(), "Bash ls".to_owned())));
    track_open_tool(
        &mut open,
        &json!({"sessionUpdate": "tool_call_update", "toolCallId": "other"}),
    );
    assert!(open.is_some());
    track_open_tool(
        &mut open,
        &json!({"sessionUpdate": "tool_call_update", "toolCallId": "t"}),
    );
    assert_eq!(open, None);
}
