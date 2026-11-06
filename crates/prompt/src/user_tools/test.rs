#[test]
fn code_mode_reviews_leave_questions_on_acp() {
    let instructions = crate::CODE_MODE_SESSION_TOOL_USE_PROMPT.to_string();
    assert!(instructions.contains("existing ACP question interaction (`AskUser` in Macro)"));
    assert!(instructions.contains("not a saved review"));
    assert!(instructions.contains("email drafts and calendar proposals"));
}

#[test]
fn code_mode_thread_prompts_send_email_through_the_confirmed_sdk_method() {
    let instructions = crate::CODE_MODE_SESSION_TOOL_USE_PROMPT.to_string();
    assert!(instructions.contains("`macro.email.sendConfirmed` sends the email"));
    assert!(instructions.contains("`macro.calendar.createConfirmed`"));
    assert!(!instructions.contains("SendConfirmedEmail"));
    assert!(!instructions.contains("CreateConfirmedCalendarEvent"));
}
