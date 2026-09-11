use super::*;
use crate::domain::engine::AgentIdentity;

/// A stand-in for the toolset prompt, short enough to assert on positionally.
const TOOLS: &str = "TOOLS";

fn has_ask_user(supports_user_input: bool) -> bool {
    let tools = tools_for(AiHost::AgentSession);
    let base_tools = Arc::into_inner(tools.toolset)
        .expect("tools_for should return a fresh, uniquely owned collection");
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
    let prompt = system_prompt(&TOOLS, None, Some("be terse"), None);

    assert!(
        prompt.starts_with(&prompt::agent_session::PROMPT.to_string()),
        "the session preamble comes first when the agent is unnamed"
    );
    assert!(
        prompt.contains(&format!(
            "{TOOLS}\n<session_instructions>\nbe terse\n</session_instructions>"
        )),
        "the static Macro prompt sits immediately before session instructions"
    );
    assert!(prompt.ends_with("\n<session_instructions>\nbe terse\n</session_instructions>"));
}

/// A named agent is told who it is before anything else, even when it has
/// no session instructions — otherwise "who are you" has nothing to go on.
#[test]
fn identity_precedes_the_standing_prompt_and_does_not_need_instructions() {
    let identity = AgentIdentity {
        name: "Grunk".to_owned(),
        handle: "grunk".to_owned(),
    };
    let prompt = system_prompt(&TOOLS, Some(&identity), None, None);
    let identity_section = prompt::agent_identity::render("Grunk", "grunk");

    assert!(
        prompt.starts_with(&identity_section),
        "identity is the first thing the model reads"
    );
    assert!(prompt.contains(&prompt::agent_session::PROMPT.to_string()));
    assert!(!prompt.contains("session_instructions"));
}

/// The order is the contract, not an accident: instructions qualify the
/// standing prompt, and memory comes last so a remembered fact is never read
/// as an instruction.
#[test]
fn memory_follows_instructions_rather_than_preceding_them() {
    let prompt = system_prompt(&TOOLS, None, Some("be terse"), Some("prefers Rust"));

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
    let prompt = system_prompt(&TOOLS, None, None, Some("prefers Rust"));

    assert!(!prompt.contains("session_instructions"));
    assert!(prompt.contains("<user_memory>\nprefers Rust\n</user_memory>"));
}

/// An empty string is a caller stating "no instructions" clumsily, and it must
/// not become a blank delimited section.
#[test]
fn empty_instructions_add_no_section() {
    let prompt = system_prompt(&TOOLS, None, Some(""), None);

    assert!(!prompt.contains("session_instructions"));
}
