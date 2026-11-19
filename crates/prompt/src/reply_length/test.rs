use crate::{
    BASE_PROMPT, CODE_MODE_SESSION_TOOL_USE_PROMPT, DIRECT_TOOL_USE_PROMPT,
    SESSION_TOOL_USE_PROMPT, TOOL_USE_PROMPT, agent_session, channel_mention,
};

const LENGTH_RULE: &str = "Most replies are one to three sentences";
const CONFIRMATION_CARVE_OUT: &str = "Asking whether to go ahead with an action the user asked for";

#[test]
fn conversational_hosts_get_the_length_rules_once() {
    let session = agent_session::PROMPT.to_string();
    let chat = TOOL_USE_PROMPT.to_string();
    let channel = channel_mention::PROMPT.to_string();
    for prompt in [&session, &chat, &channel] {
        assert_eq!(prompt.matches(LENGTH_RULE).count(), 1);
        assert!(prompt.contains(CONFIRMATION_CARVE_OUT));
    }
}

#[test]
fn deliverable_hosts_do_not_get_the_length_rules() {
    // Memory research and structured completions (call recaps, drafts) use
    // these; their output must stay complete.
    assert!(!BASE_PROMPT.to_string().contains(LENGTH_RULE));
    assert!(!DIRECT_TOOL_USE_PROMPT.to_string().contains(LENGTH_RULE));
}

#[test]
fn session_prompts_keep_the_confirmation_questions_the_length_rules_allow() {
    // The thread-draft and review flows end by asking to go ahead; the
    // length rules must not ban that.
    let session = format!("{}{}", agent_session::PROMPT, SESSION_TOOL_USE_PROMPT);
    assert!(session.contains("want me to send it?"));
    assert!(session.contains(CONFIRMATION_CARVE_OUT));
    let code_mode = format!(
        "{}{}",
        agent_session::PROMPT,
        CODE_MODE_SESSION_TOOL_USE_PROMPT
    );
    assert!(code_mode.contains("Should I kick it off?"));
    assert!(code_mode.contains(CONFIRMATION_CARVE_OUT));
}
