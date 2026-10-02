//! Syntax highlighting with tree-sitter, baked into the snapshot so the page
//! never parses code. Output is per line, flattened `[start, end, class]`
//! triples in UTF-16 offsets.

use std::sync::OnceLock;

use tree_sitter_highlight::{HighlightConfiguration, HighlightEvent, Highlighter};

use crate::lang::Lang;
use crate::model::SyntaxClass;
use crate::text::{Utf16Cols, line_starts};

/// Files larger than this are shown without highlighting.
pub const MAX_HIGHLIGHT_BYTES: usize = 2 * 1024 * 1024;

/// Capture names we recognise, and the class each maps to. tree-sitter picks
/// the longest recognised prefix of a capture name, so `function.method.call`
/// matches `function`.
const CAPTURES: &[(&str, SyntaxClass)] = &[
    ("attribute", SyntaxClass::Attribute),
    ("boolean", SyntaxClass::Constant),
    ("character", SyntaxClass::String),
    ("comment", SyntaxClass::Comment),
    ("constant", SyntaxClass::Constant),
    ("constant.builtin", SyntaxClass::Constant),
    ("constructor", SyntaxClass::Type),
    ("embedded", SyntaxClass::Variable),
    ("escape", SyntaxClass::Escape),
    ("function", SyntaxClass::Function),
    ("function.builtin", SyntaxClass::Function),
    ("function.macro", SyntaxClass::Function),
    ("function.method", SyntaxClass::Function),
    ("keyword", SyntaxClass::Keyword),
    ("label", SyntaxClass::Tag),
    ("module", SyntaxClass::Module),
    ("namespace", SyntaxClass::Module),
    ("number", SyntaxClass::Number),
    ("float", SyntaxClass::Number),
    ("operator", SyntaxClass::Operator),
    ("property", SyntaxClass::Property),
    ("field", SyntaxClass::Property),
    ("parameter", SyntaxClass::Variable),
    ("storageclass", SyntaxClass::Keyword),
    ("conditional", SyntaxClass::Keyword),
    ("punctuation", SyntaxClass::Punctuation),
    ("punctuation.bracket", SyntaxClass::Punctuation),
    ("punctuation.delimiter", SyntaxClass::Punctuation),
    ("punctuation.special", SyntaxClass::Operator),
    ("string", SyntaxClass::String),
    ("string.special", SyntaxClass::String),
    ("string.escape", SyntaxClass::Escape),
    ("string.regexp", SyntaxClass::String),
    ("tag", SyntaxClass::Tag),
    ("type", SyntaxClass::Type),
    ("type.builtin", SyntaxClass::Type),
    ("variable", SyntaxClass::Variable),
    ("variable.builtin", SyntaxClass::Keyword),
    ("variable.parameter", SyntaxClass::Variable),
    ("text.title", SyntaxClass::Heading),
    ("text.literal", SyntaxClass::String),
    ("text.uri", SyntaxClass::Link),
    ("text.reference", SyntaxClass::Link),
    ("text.emphasis", SyntaxClass::Variable),
    ("text.strong", SyntaxClass::Keyword),
    ("markup.heading", SyntaxClass::Heading),
    ("markup.link", SyntaxClass::Link),
    ("markup.raw", SyntaxClass::String),
];

fn config(lang: Lang) -> Option<&'static HighlightConfiguration> {
    static CONFIGS: OnceLock<Vec<OnceLock<Option<HighlightConfiguration>>>> = OnceLock::new();
    let slots = CONFIGS.get_or_init(|| Lang::ALL.iter().map(|_| OnceLock::new()).collect());
    slots[lang.index()]
        .get_or_init(|| {
            let (highlights, injections, locals) = lang.highlight_queries();
            let mut cfg = HighlightConfiguration::new(lang.language(), lang.display_name(), &highlights, injections, locals).ok()?;
            let names: Vec<&str> = CAPTURES.iter().map(|(n, _)| *n).collect();
            cfg.configure(&names);
            Some(cfg)
        })
        .as_ref()
}

/// Highlight `source`, returning one run list per line of `split_lines(source)`.
pub fn highlight(lang: Lang, source: &str, line_count: usize) -> Vec<Vec<u32>> {
    let mut out = vec![Vec::new(); line_count];
    if source.len() > MAX_HIGHLIGHT_BYTES {
        return out;
    }
    let Some(cfg) = config(lang) else { return out };
    let mut highlighter = Highlighter::new();
    let Ok(events) = highlighter.highlight(cfg, source.as_bytes(), None, |name| Lang::from_name(name).and_then(config)) else {
        return out;
    };

    let starts = line_starts(source);
    // Built on first use per line: many spans land on the same line.
    let mut cols: Vec<Option<Utf16Cols>> = std::iter::repeat_with(|| None).take(line_count).collect();
    let mut stack: Vec<SyntaxClass> = Vec::new();
    for event in events {
        let Ok(event) = event else { return out };
        match event {
            HighlightEvent::HighlightStart(h) => stack.push(CAPTURES[h.0].1),
            HighlightEvent::HighlightEnd => {
                stack.pop();
            }
            HighlightEvent::Source { start, end } => {
                let Some(&class) = stack.last() else { continue };
                push_span(&mut out, &mut cols, source, &starts, start, end, class);
            }
        }
    }
    out
}

/// Record a byte span, split across the lines it covers.
fn push_span(
    out: &mut [Vec<u32>],
    cols: &mut [Option<Utf16Cols>],
    source: &str,
    starts: &[usize],
    start: usize,
    end: usize,
    class: SyntaxClass,
) {
    let mut line = starts.partition_point(|&s| s <= start).saturating_sub(1);
    let mut pos = start;
    while pos < end && line < out.len() {
        let line_start = starts[line];
        let line_end = starts.get(line + 1).map_or(source.len(), |&s| s - 1);
        let text = source[line_start..line_end].strip_suffix('\r').unwrap_or(&source[line_start..line_end]);
        let a = pos - line_start;
        let b = end.min(line_end) - line_start;
        let line_cols = cols[line].get_or_insert_with(|| Utf16Cols::new(text));
        let (a16, b16) = (line_cols.col(a), line_cols.col(b));
        if b16 > a16 {
            let runs = &mut out[line];
            // Merge with the previous run when it continues the same class.
            let n = runs.len();
            if n >= 3 && runs[n - 2] == a16 && runs[n - 1] == class as u32 {
                runs[n - 2] = b16;
            } else {
                runs.extend([a16, b16, class as u32]);
            }
        }
        line += 1;
        pos = starts.get(line).copied().unwrap_or(end);
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::text::split_lines;

    fn classes(lang: Lang, src: &str) -> Vec<Vec<(String, &'static str)>> {
        let lines = split_lines(src);
        highlight(lang, src, lines.len())
            .iter()
            .zip(&lines)
            .map(|(runs, line)| {
                let utf16: Vec<u16> = line.encode_utf16().collect();
                runs.chunks(3)
                    .map(|r| {
                        let text = String::from_utf16_lossy(&utf16[r[0] as usize..r[1] as usize]);
                        (text, SyntaxClass::ALL[r[2] as usize].name())
                    })
                    .collect()
            })
            .collect()
    }

    #[test]
    fn highlights_rust() {
        let got = classes(Lang::Rust, "fn main() {\n    let s = \"hé\"; // hi\n}\n");
        assert!(got[0].contains(&("fn".into(), "keyword")));
        assert!(got[0].contains(&("main".into(), "function")));
        assert!(got[1].contains(&("\"hé\"".into(), "string")));
        assert!(got[1].contains(&("// hi".into(), "comment")));
    }

    #[test]
    fn highlights_every_language() {
        for lang in Lang::ALL {
            assert!(config(lang).is_some(), "{lang:?} queries failed to load");
        }
    }

    #[test]
    fn splits_multiline_tokens() {
        let got = classes(Lang::Rust, "/* a\nb */ fn x() {}\n");
        assert_eq!(got[0], vec![("/* a".to_owned(), "comment")]);
        assert_eq!(got[1][0], ("b */".to_owned(), "comment"));
    }
}
