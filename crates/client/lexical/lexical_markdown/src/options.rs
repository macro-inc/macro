//! Import/export options, including configurable list indentation.
/// Shared conversion options.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct MarkdownOptions {
    /// Spaces per nesting level; must be positive. Macro callers pass 2.
    pub list_indent: u8,
    /// Preserve source line boundaries and literal backslashes.
    pub should_preserve_new_lines: bool,
    /// Import soft breaks as spaces unless preserving newlines.
    pub should_merge_adjacent_lines: bool,
}
impl Default for MarkdownOptions {
    fn default() -> Self {
        Self {
            list_indent: 4,
            should_preserve_new_lines: false,
            should_merge_adjacent_lines: false,
        }
    }
}
impl MarkdownOptions {
    /// Reject a zero indentation divisor.
    pub fn validate(&self) -> crate::Result<()> {
        if self.list_indent == 0 {
            Err(crate::Error::InvalidArgument(
                "list_indent must be positive",
            ))
        } else {
            Ok(())
        }
    }
}
