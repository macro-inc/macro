//! Rendering tests for the composed prompts exported from the crate root.

use prompt::{BASE_PROMPT, TOOL_USE_PROMPT};

const BASE_TITLES: [&str; 6] = [
    "# Tone and Style",
    "# Math Rendering Rules",
    "# Citation Rules",
    "# Mentioning documents, channels, chats, projects, and email threads",
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
fn tool_use_prompt_appends_tool_section_to_base() {
    let rendered = TOOL_USE_PROMPT.to_string();
    assert!(rendered.starts_with(&BASE_PROMPT.to_string()));
    assert!(
        rendered
            .trim_end()
            .ends_with("read the appropriate resource using the read tool.")
    );
    assert!(rendered.contains("# Tool Use"));
}
