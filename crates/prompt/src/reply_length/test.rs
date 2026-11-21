use crate::{
    BASE_PROMPT, CODE_MODE_SESSION_TOOL_USE_PROMPT, DIRECT_TOOL_USE_PROMPT,
    SESSION_TOOL_USE_PROMPT, TOOL_USE_PROMPT, agent_session, channel_mention,
};

const LENGTH_RULE: &str = "Most replies are one to three sentences";
const CONFIRMATION_CARVE_OUT: &str = "Asking whether to go ahead with an action the user asked for";
const REQUESTED_LIST_CARVE_OUT: &str = "When the user asks for a list, a summary or a comparison";

#[test]
fn macro_agent_prompts_get_the_length_rules_once() {
    let session = agent_session::PROMPT.to_string();
    let channel = channel_mention::PROMPT.to_string();
    for prompt in [&session, &channel] {
        assert_eq!(prompt.matches(LENGTH_RULE).count(), 1);
        assert!(prompt.contains(CONFIRMATION_CARVE_OUT));
    }
}

#[test]
fn length_rules_yield_to_a_requested_list_or_summary() {
    // "List my tasks due this week" or "summarize this thread" must not be
    // clipped to three sentences or folded into one.
    let session = agent_session::PROMPT.to_string();
    let channel = channel_mention::PROMPT.to_string();
    for prompt in [&session, &channel] {
        let carve_out = prompt
            .find(REQUESTED_LIST_CARVE_OUT)
            .expect("the length rules name the requested-list carve-out");
        assert!(prompt[carve_out..].contains("include every item"));
        assert!(prompt.contains("Prefer a sentence to a list unless the user asked for a list"));
    }
}

#[test]
fn shared_tool_prompts_do_not_get_the_length_rules() {
    // Memory research, MCP and structured completions (call recaps, drafts)
    // use these; their output must stay complete.
    for prompt in [&BASE_PROMPT, &TOOL_USE_PROMPT, &DIRECT_TOOL_USE_PROMPT] {
        assert!(!prompt.to_string().contains(LENGTH_RULE));
    }
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
