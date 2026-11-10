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

#[test]
fn code_mode_reviews_skip_the_offer_when_the_user_held_the_send() {
    let instructions = crate::CODE_MODE_SESSION_TOOL_USE_PROMPT.to_string();
    assert!(instructions.contains("\"Should I kick it off?\""));
    assert!(instructions.contains(
        "If they said not to send, create or import it yet, do not ask; say it is waiting on the card for them."
    ));
}
