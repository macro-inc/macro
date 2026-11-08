//! Markdown metadata stored on model-owned nodes.
use crate::Result;
use crate::util::is_js_whitespace_unit;
use lexical_model::*;
use serde_json::Value;
/// Original unordered list marker; reset when copying a list.
pub static LIST_MARKER_STATE: StateKey<String> = StateKey::new("mdListMarker", |v| {
    v.and_then(Value::as_str)
        .filter(|s| matches!(*s, "-" | "*" | "+"))
        .unwrap_or("-")
        .into()
})
.reset_on_copy();
/// Original backtick fence; reset when copying a code block.
pub static CODE_FENCE_STATE: StateKey<String> = StateKey::new("mdCodeFence", |v| {
    v.and_then(Value::as_str)
        .filter(|s| s.len() >= 3 && s.bytes().all(|b| b == b'`'))
        .unwrap_or("```")
        .into()
})
.reset_on_copy();
/// Source hard-break marker; reset when copying a line break.
pub static HARD_LINE_BREAK_STATE: StateKey<String> = StateKey::new("mdHardLineBreak", |v| {
    v.and_then(Value::as_str)
        .filter(|s| *s == "\\" || s.len() >= 2 && s.bytes().all(|b| b == b' '))
        .unwrap_or("")
        .into()
})
.reset_on_copy();
/// Parse a trailing backslash or two spaces after a non-whitespace unit.
pub fn parse_markdown_hard_line_break(line: &str) -> Option<(String, String)> {
    if let Some(text) = line.strip_suffix('\\') {
        return Some((text.into(), "\\".into()));
    }
    let stripped = line.trim_end_matches(' ');
    let count = line.len() - stripped.len();
    if count >= 2
        && !stripped.is_empty()
        && !stripped
            .chars()
            .any(|c| matches!(c, '\n' | '\r' | '\u{2028}' | '\u{2029}'))
        && stripped
            .encode_utf16()
            .last()
            .is_some_and(|c| !is_js_whitespace_unit(c))
    {
        Some((stripped.into(), " ".repeat(count)))
    } else {
        None
    }
}
/// Create a detached line break, moving a source marker off the previous text.
pub fn create_markdown_line_break_node(
    tx: &mut Transaction<'_>,
    previous: NodeKey,
) -> Result<NodeKey> {
    let br = tx.create(LineBreak {})?;
    if let Some(last) = tx.last_child(previous).filter(|k| tx.is_text(*k)) {
        let text = tx.text_content(last).into_owned();
        let marker = if let Some((stripped, marker)) = parse_markdown_hard_line_break(&text) {
            tx.text(last)?.set_text_content(&stripped)?;
            Some(marker)
        } else if text.len() >= 2 && text.bytes().all(|b| b == b' ') {
            let has_content = tx
                .prev_siblings(last)
                .rev()
                .take_while(|k| !tx.is_line_break(*k))
                .any(|k| {
                    tx.text_content(k)
                        .encode_utf16()
                        .any(|c| !is_js_whitespace_unit(c))
                });
            if has_content {
                tx.text(last)?.set_text_content("")?;
                Some(text)
            } else {
                None
            }
        } else {
            None
        };
        if let Some(marker) = marker {
            tx.set_state(br, &HARD_LINE_BREAK_STATE, marker)?;
        }
    }
    Ok(br.key())
}
#[cfg(test)]
mod test;
