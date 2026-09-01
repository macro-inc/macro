use super::*;

/// A stand-in for the toolset prompt, short enough to assert on positionally.
const TOOLS: &str = "TOOLS";

#[test]
fn instructions_are_a_delimited_section_after_the_standing_prompt() {
    let prompt = system_prompt(&TOOLS, Some("be terse"), None);

    assert!(
        prompt.starts_with(&format!("{TOOLS}\n{}", prompt::agent_session::PROMPT)),
        "the standing prompt comes first, unchanged"
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
