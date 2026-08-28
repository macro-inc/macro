use super::*;

/// A stand-in for the toolset prompt, short enough to assert on positionally.
const TOOLS: &str = "TOOLS";

fn global_block() -> String {
    format!(
        "<global_instructions>\n{}\n</global_instructions>",
        prompt::math::GLOBAL_INSTRUCTIONS
    )
}

#[test]
fn global_instructions_are_always_injected_after_the_standing_prompt() {
    let prompt = system_prompt(&TOOLS, None, None);

    assert!(
        prompt.starts_with(&format!("{TOOLS}\n{}", prompt::agent_session::PROMPT)),
        "the standing prompt comes first, unchanged"
    );
    assert!(
        prompt.contains(&global_block()),
        "the compact XML-syntax rule is always present"
    );
    assert!(
        prompt.contains("<m-katex-equation>"),
        "the global block names the internal math tag"
    );
    assert!(
        prompt.contains("<m-document-mention>"),
        "the global block names the document @mention tag"
    );
    assert!(
        prompt.contains("<m-user-mention>"),
        "the global block names the user @mention tag"
    );
}

#[test]
fn instructions_are_a_delimited_section_after_the_standing_prompt() {
    let prompt = system_prompt(&TOOLS, Some("be terse"), None);

    assert!(
        prompt.starts_with(&format!("{TOOLS}\n{}", prompt::agent_session::PROMPT)),
        "the standing prompt comes first, unchanged"
    );
    assert!(prompt.ends_with("\n<session_instructions>\nbe terse\n</session_instructions>"));
}

/// The order is the contract, not an accident: global syntax rules come
/// first, per-session instructions qualify them, and memory comes last so a
/// remembered fact is never read as an instruction.
#[test]
fn memory_follows_instructions_rather_than_preceding_them() {
    let prompt = system_prompt(&TOOLS, Some("be terse"), Some("prefers Rust"));

    let global = prompt
        .find("<global_instructions>")
        .expect("the global instructions section should be present");
    let instructions = prompt
        .find("<session_instructions>")
        .expect("the instructions section should be present");
    let memory = prompt
        .find("<user_memory>")
        .expect("the memory section should be present");
    assert!(global < instructions);
    assert!(instructions < memory);
}

/// Absent session instructions add no session section at all, rather than an
/// empty one the model would have to interpret. Global instructions still
/// land.
#[test]
fn absent_session_instructions_add_no_session_section() {
    let prompt = system_prompt(&TOOLS, None, Some("prefers Rust"));

    assert!(!prompt.contains("session_instructions"));
    assert!(prompt.contains(&global_block()));
    assert!(prompt.contains("<user_memory>\nprefers Rust\n</user_memory>"));
}

/// An empty string is a caller stating "no instructions" clumsily, and it must
/// not become a blank delimited section.
#[test]
fn empty_session_instructions_add_no_session_section() {
    let prompt = system_prompt(&TOOLS, Some(""), None);

    assert!(!prompt.contains("session_instructions"));
    assert!(prompt.contains(&global_block()));
}
