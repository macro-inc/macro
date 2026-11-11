//! Rendering tests for the composed prompts exported from the crate root.

use prompt::{BASE_PROMPT, TOOL_USE_PROMPT};

const BASE_TITLES: [&str; 6] = [
    "# Tone and Style",
    "# Math Rendering Rules",
    "# Citation Rules",
    "# Mentioning documents, people, dates, agent sessions, and other chips",
    "# Do Not Rules",
    "# Terms",
];

#[test]
fn base_prompt_renders_all_sections_in_order() {
    let rendered = BASE_PROMPT.to_string();
    let mut last = 0;
    for title in BASE_TITLES {
        let position = rendered[last..]
            .find(title)
            .unwrap_or_else(|| panic!("missing or out-of-order section: {title}"));
        last += position + title.len();
    }
    assert!(!rendered.contains("# Tool Use"));
}

#[test]
fn base_prompt_includes_channel_message_mention_format() {
    let rendered = BASE_PROMPT.to_string();
    assert!(
        rendered.contains(
            r#""blockName":"channel","blockParams":{"channel_message_id":"{message_id}"}"#
        )
    );
    assert!(rendered.contains("mention that message, not just its channel"));
}

#[test]
fn tool_use_prompt_appends_tool_sections_to_base_and_no_area_guidance() {
    let rendered = TOOL_USE_PROMPT.to_string();
    assert!(rendered.starts_with(&BASE_PROMPT.to_string()));
    // How each area of Macro works is the SDK's `@agent` guidance, which
    // `ai_tools` composes; none of it lives in this crate.
    assert!(!rendered.contains("How Macro databases work"));
    assert!(!rendered.contains("Labels are per inbox"));
}
