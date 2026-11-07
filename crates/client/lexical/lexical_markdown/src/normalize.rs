//! Upstream line normalization, including HTML and fenced-code boundaries.
use crate::{matcher::Matcher, patterns::*, state::parse_markdown_hard_line_break, util::*};
/// Normalize source lines before markdown import.
pub fn normalize_markdown(input: &str, should_merge_adjacent_lines: bool) -> String {
    let lines: Vec<_> = input.split('\n').collect();
    let mut sanitized: Vec<String> = Vec::new();
    let mut in_code = false;
    for (i, raw) in lines.iter().enumerate() {
        let line = js_trim_end(raw);
        let last = sanitized.last();
        let hard = i + 1 < lines.len() && parse_markdown_hard_line_break(raw).is_some();
        let last_hard = last.is_some_and(|l| parse_markdown_hard_line_break(l).is_some());
        if CODE_SINGLE_LINE.test(line) {
            sanitized.push(line.into());
            continue;
        }
        if CODE_START.test(line) || CODE_END.test(line) {
            in_code = !in_code;
            sanitized.push(line.into());
            continue;
        }
        if in_code {
            sanitized.push((*raw).into());
            continue;
        }
        let separate = line.is_empty()
            || last.is_none_or(|s| s.is_empty())
            || last.is_some_and(|s| {
                HEADING.test(s)
                    || TAG_START_AT_END.test(s)
                    || TAG_END_AT_END.test(s)
                    || CODE_END.test(s)
            })
            || HEADING.test(line)
            || QUOTE.test(line)
            || ORDERED_LIST.test(line)
            || UNORDERED_LIST.test(line)
            || CHECK_LIST.test(line)
            || TABLE_ROW.test(line)
            || TABLE_ROW_DIVIDER.test(line)
            || last_hard
            || !should_merge_adjacent_lines
            || TAG_START.test(line)
            || TAG_END.test(line);
        if separate {
            sanitized.push(
                if !should_merge_adjacent_lines && !line.is_empty() || hard {
                    (*raw).into()
                } else {
                    line.into()
                },
            );
        } else if let Some(last) = sanitized.last_mut() {
            last.push(' ');
            last.push_str(js_trim_start(if hard { raw } else { line }));
        }
    }
    sanitized.join("\n")
}
#[cfg(test)]
mod test;
