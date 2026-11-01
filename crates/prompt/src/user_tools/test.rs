#[test]
fn booking_links_require_a_reply_to_the_proposal_in_chat_and_sessions() {
    for instructions in [
        crate::TOOL_USE_PROMPT.to_string(),
        crate::SESSION_TOOL_USE_PROMPT.to_string(),
        crate::CODE_MODE_SESSION_TOOL_USE_PROMPT.to_string(),
    ] {
        for rule in [
            "Booking links use conversational confirmation",
            "never ask for IDs, revisions or JSON",
            "Ask whether to proceed, and end the turn",
            "Only after the user's reply approving",
            "`userConfirmation`",
            "Do not quote the original request or invent approval",
            "Do not use `AskUser` or an elicitation",
            "re-read and reconfirm",
        ] {
            assert!(instructions.contains(rule), "Missing booking rule: {rule}");
        }
    }
}

#[test]
fn code_mode_reviews_leave_questions_on_acp() {
    let instructions = crate::CODE_MODE_SESSION_TOOL_USE_PROMPT.to_string();
    assert!(instructions.contains("existing ACP question interaction (`AskUser` in Macro)"));
    assert!(instructions.contains("not a saved review"));
    assert!(instructions.contains("email drafts and calendar proposals"));
}
