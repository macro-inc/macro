use std::sync::LazyLock;

/// Shared base system prompt: tone, citation/mention formats, terminology.
/// Used directly for sessions without tools.
pub static BASE_PROMPT: &str = include_str!("base.md");

/// Tool-specific additions layered on top of the base prompt.
static TOOL_USE_PROMPT: &str = include_str!("tool_use.md");

/// Full system prompt for tool-enabled sessions: [`BASE_PROMPT`] plus tool-use additions.
pub static TOOLS_PROMPT: LazyLock<&'static str> = LazyLock::new(|| {
    Box::leak(format!("{BASE_PROMPT}\n\n---\n\n{TOOL_USE_PROMPT}").into_boxed_str())
});
