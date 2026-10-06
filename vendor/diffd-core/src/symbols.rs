//! Definitions via tree-sitter tags queries, the same way GitHub's
//! search-based code navigation finds them.

use std::sync::OnceLock;

use tree_sitter_tags::{TagsConfiguration, TagsContext};

use crate::lang::Lang;
use crate::model::{Side, Symbol};
use crate::text::{line_starts, utf16_col};

fn config(lang: Lang) -> Option<&'static TagsConfiguration> {
    static CONFIGS: OnceLock<Vec<OnceLock<Option<TagsConfiguration>>>> = OnceLock::new();
    let slots = CONFIGS.get_or_init(|| Lang::ALL.iter().map(|_| OnceLock::new()).collect());
    slots[lang.index()].get_or_init(|| TagsConfiguration::new(lang.language(), &lang.tags_query()?, "").ok()).as_ref()
}

/// Definitions in one side of one file.
pub fn definitions(lang: Lang, source: &str, file: u32, side: Side, lines: &[String]) -> Vec<Symbol> {
    let Some(cfg) = config(lang) else { return Vec::new() };
    if source.len() > crate::highlight::MAX_HIGHLIGHT_BYTES {
        return Vec::new();
    }
    let mut ctx = TagsContext::new();
    let Ok((tags, _)) = ctx.generate_tags(cfg, source.as_bytes(), None) else { return Vec::new() };
    let starts = line_starts(source);
    let mut out = Vec::new();
    for tag in tags.flatten() {
        if !tag.is_definition {
            continue;
        }
        let Some(name) = source.get(tag.name_range.clone()) else { continue };
        let row = starts.partition_point(|&s| s <= tag.name_range.start).saturating_sub(1);
        let Some(line) = lines.get(row) else { continue };
        let start = tag.name_range.start - starts[row];
        let end = (tag.name_range.end - starts[row]).min(line.len());
        let row_of = |byte: usize| starts.partition_point(|&s| s <= byte).saturating_sub(1) as u32 + 1;
        // The node's end is exclusive; step back so a trailing newline doesn't count as the next line.
        let lines = [row_of(tag.range.start), row_of(tag.range.end.saturating_sub(1).max(tag.range.start))];
        out.push(Symbol {
            name: name.to_owned(),
            kind: cfg.syntax_type_name(tag.syntax_type_id).to_owned(),
            file,
            side,
            line: row as u32 + 1,
            start: utf16_col(line, start),
            end: utf16_col(line, end),
            lines,
        });
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::split_lines;

    #[test]
    fn finds_rust_definitions() {
        let src = "pub struct Gate {}\n\nimpl Gate {\n    pub fn poll(&self) {}\n}\n";
        let syms = definitions(Lang::Rust, src, 0, Side::New, &split_lines(src));
        let names: Vec<_> = syms.iter().map(|s| (s.name.as_str(), s.line)).collect();
        assert!(names.contains(&("Gate", 1)));
        let poll = syms.iter().find(|s| s.name == "poll").unwrap();
        assert_eq!(poll.lines, [4, 4]);
        let imp = syms.iter().find(|s| s.name == "Gate" && s.line == 3);
        if let Some(imp) = imp {
            assert_eq!(imp.lines, [3, 5], "the impl block with its body");
        }
        assert!(names.contains(&("poll", 4)));
        let poll = syms.iter().find(|s| s.name == "poll").unwrap();
        assert_eq!((poll.start, poll.end), (11, 15));
    }

    #[test]
    fn finds_typescript_definitions() {
        let src = "export function describe(d: number): string { return ''; }\n";
        let syms = definitions(Lang::TypeScript, src, 0, Side::New, &split_lines(src));
        assert!(syms.iter().any(|s| s.name == "describe"));
    }
}
