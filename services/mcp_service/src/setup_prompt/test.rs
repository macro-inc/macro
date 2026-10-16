use rmcp::model::PromptMessageContent;
use serde_json::json;

use super::*;

fn request(arguments: Option<serde_json::Value>) -> GetPromptRequestParams {
    serde_json::from_value(json!({
        "name": SETUP_PROMPT,
        "arguments": arguments,
    }))
    .expect("valid request")
}

fn text(result: &GetPromptResult) -> &str {
    match &result.messages[0].content {
        PromptMessageContent::Text { text } => text,
        other => panic!("expected text, got {other:?}"),
    }
}

#[test]
fn the_setup_prompt_is_offered_with_an_optional_tools_argument() {
    let prompts = prompts();
    assert_eq!(prompts.len(), 1);
    assert_eq!(prompts[0].name, "setup");
    assert_eq!(prompts[0].title.as_deref(), Some("Set up Macro"));
    let arguments = prompts[0].arguments.as_ref().expect("arguments");
    assert_eq!(arguments[0].required, Some(false));
}

#[test]
fn the_prompt_asks_for_setup_with_the_checklist() {
    let result = get(&request(Some(
        json!({ "tools": "Notion, Linear and Gmail" }),
    )))
    .expect("setup");

    let text = text(&result);
    assert!(text.starts_with("Set up my Macro workspace. I use Notion, Linear and Gmail."));
    assert!(text.contains("SetupGetState"));
    assert!(text.contains("# Macro Setup"));
}

#[test]
fn without_tools_the_agent_is_asked_to_check() {
    let result = get(&request(None)).expect("setup");
    assert!(text(&result).contains("Check my other connected tools"));
}

#[test]
fn other_prompt_names_are_not_found() {
    let mut other = request(None);
    other.name = "something-else".to_owned();
    assert!(get(&other).is_none());
}
