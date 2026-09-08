use super::*;

/// A stand-in for the toolset prompt, short enough to assert on positionally.
const TOOLS: &str = "TOOLS";

fn has_ask_user(supports_user_input: bool) -> bool {
    let base_tools = ai_tools::harness_tools();
    tools_for_turn(base_tools, supports_user_input)
        .request_schemas()
        .expect("tool schemas should be valid")
        .iter()
        .any(|schema| schema.name == "AskUser")
}

#[test]
fn ask_user_is_only_advertised_when_the_client_supports_it() {
    assert!(has_ask_user(true));
    assert!(!has_ask_user(false));
}

#[test]
fn instructions_are_a_delimited_section_after_the_standing_prompt() {
    let prompt = system_prompt(&TOOLS, Some("be terse"), None);

    assert!(
        prompt.starts_with(&prompt::agent_session::PROMPT.to_string()),
        "the session preamble comes first"
    );
    assert!(
        prompt.contains(&format!(
            "{TOOLS}\n<session_instructions>\nbe terse\n</session_instructions>"
        )),
        "the static Macro prompt sits immediately before session instructions"
    );
    assert!(prompt.ends_with("\n<session_instructions>\nbe terse\n</session_instructions>"));
}

/// The order is the contract, not an accident: instructions qualify the
/// standing prompt, and memory comes last so a remembered fact is never read
/// as an instruction.
#[test]
fn memory_follows_instructions_rather_than_preceding_them() {
    let prompt = system_prompt(&TOOLS, Some("be terse"), Some("prefers Rust"));

    let instructions = prompt
        .find("<session_instructions>")
        .expect("the instructions section should be present");
    let memory = prompt
        .find("<user_memory>")
        .expect("the memory section should be present");
    assert!(instructions < memory);
}

/// Absent instructions add no section at all, rather than an empty one the
/// model would have to interpret.
#[test]
fn no_instructions_means_no_section() {
    let prompt = system_prompt(&TOOLS, None, Some("prefers Rust"));

    assert!(!prompt.contains("session_instructions"));
    assert!(prompt.contains("<user_memory>\nprefers Rust\n</user_memory>"));
}

/// An empty string is a caller stating "no instructions" clumsily, and it must
/// not become a blank delimited section.
#[test]
fn empty_instructions_add_no_section() {
    let prompt = system_prompt(&TOOLS, Some(""), None);

    assert!(!prompt.contains("session_instructions"));
}

#[test]
fn main_agent_registers_only_harness_utilities() {
    let tools = tools_for_turn(ai_tools::harness_tools(), true);
    let mut names: Vec<_> = tools
        .request_schemas()
        .unwrap()
        .into_iter()
        .map(|s| s.name)
        .collect();
    names.sort();
    assert_eq!(
        names,
        ["AskUser", "DisplayResults", "LoadTools", "SearchTools"]
    );
}

#[test]
fn historical_native_calls_and_results_use_current_mcp_names_only_in_model_context() {
    use agent::types::{AssistantMessagePart as Part, ChatMessage, ChatMessageContent, Role};
    let original = vec![
        Part::ToolCall {
            name: "SendEmail".into(),
            id: "call".into(),
            json: serde_json::json!({}),
        },
        Part::ToolCallResponseJson {
            name: "SendEmail".into(),
            id: "call".into(),
            json: serde_json::json!("Rejected"),
        },
        Part::ToolCall {
            name: "AskUser".into(),
            id: "ask".into(),
            json: serde_json::json!({}),
        },
    ];
    let mut messages = vec![ChatMessage {
        content: ChatMessageContent::AssistantMessageParts(original.clone()),
        role: Role::Assistant,
        attachments: None,
    }];
    normalize_tool_history(
        &mut messages,
        &std::collections::HashSet::from(["mcp__macro__SendEmail".into()]),
    );
    let ChatMessageContent::AssistantMessageParts(parts) = &messages[0].content else {
        panic!("parts");
    };
    assert!(
        matches!(&parts[0], Part::ToolCall {name, id, ..} if name == "mcp__macro__SendEmail" && id == "call")
    );
    assert!(
        matches!(&parts[1], Part::ToolCallResponseJson {name, ..} if name == "mcp__macro__SendEmail")
    );
    assert_eq!(parts[2], original[2]);
    assert!(matches!(&original[0], Part::ToolCall {name, ..} if name == "SendEmail"));
}
