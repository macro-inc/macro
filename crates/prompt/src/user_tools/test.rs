#[test]
fn code_mode_reviews_leave_questions_on_acp() {
    let instructions = crate::CODE_MODE_SESSION_TOOL_USE_PROMPT.to_string();
    assert!(instructions.contains("existing ACP question interaction (`AskUser` in Macro)"));
    assert!(instructions.contains("not a saved review"));
    assert!(instructions.contains("email drafts and calendar proposals"));
}
