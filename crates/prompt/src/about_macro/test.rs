use crate::{
    BASE_PROMPT, CODE_MODE_SESSION_TOOL_USE_PROMPT, DIRECT_TOOL_USE_PROMPT,
    SESSION_TOOL_USE_PROMPT, TOOL_USE_PROMPT, mcp_instructions,
};

const OUTCOME_RULE: &str = "When a user asks whether Macro can do something";
const NO_INVENTED_CAPABILITIES: &str = "never invent a feature";
const PLAIN_GAP: &str = "say so plainly";

#[test]
fn every_host_gets_the_product_help_rules_once() {
    let mcp = mcp_instructions("https://macro.com");
    for prompt in [
        BASE_PROMPT.to_string(),
        TOOL_USE_PROMPT.to_string(),
        DIRECT_TOOL_USE_PROMPT.to_string(),
        SESSION_TOOL_USE_PROMPT.to_string(),
        CODE_MODE_SESSION_TOOL_USE_PROMPT.to_string(),
        mcp,
    ] {
        assert_eq!(prompt.matches(OUTCOME_RULE).count(), 1);
        assert!(prompt.contains(NO_INVENTED_CAPABILITIES));
        assert!(prompt.contains(PLAIN_GAP));
    }
}
