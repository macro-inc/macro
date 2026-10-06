//! Turning a pair of file contents (plus engine output) into a [`FileDiff`].

use crate::difft::EngineDiff;
use crate::highlight::highlight;
use crate::kinds;
use crate::lang::Lang;
use crate::linediff;
use crate::model::{FileDiff, FileStatus, Omitted, Revision, Row, SideText, Snapshot};
use crate::symbols::definitions;
use crate::text::{Utf16Cols, split_lines};

/// One changed file, as read from the repository.
#[derive(Debug, Clone, PartialEq)]
pub struct FileInput {
    pub path: String,
    pub old_path: Option<String>,
    pub status: FileStatus,
    /// `None` when the file doesn't exist on that side.
    pub old: Option<String>,
    pub new: Option<String>,
    /// Why the contents aren't shown; `old` and `new` are then empty.
    pub omitted: Option<Omitted>,
    /// Changes the rows can't show (see [`FileDiff::details`]).
    pub details: Vec<String>,
    pub collapsed: Option<String>,
}

/// What difftastic calls a file in no language it knows.
const PLAIN_TEXT: &str = "Text";

/// Build a file's diff. `engine` is difftastic's result for modified files;
/// without it (or when it has no alignment) a line diff is used.
pub fn build_file(input: &FileInput, engine: Option<EngineDiff>) -> FileDiff {
    let generated = kinds::generated(&input.path, input.new.as_deref().or(input.old.as_deref()));
    let labels = [(kinds::is_test(&input.path), kinds::TEST), (generated.is_some(), kinds::GENERATED)]
        .into_iter()
        .filter(|(is, _)| *is)
        .map(|(_, label)| label.to_owned())
        .collect();
    let mut file = FileDiff {
        path: input.path.clone(),
        old_path: input.old_path.clone(),
        status: input.status,
        language: None,
        omitted: input.omitted,
        details: input.details.clone(),
        // The agent's reason first: it knows why better than a guess.
        collapsed: input.collapsed.clone().or_else(|| generated.map(str::to_owned)),
        labels,
        added: 0,
        removed: 0,
        old: None,
        new: None,
        rows: Vec::new(),
        since: Vec::new(),
    };
    if input.omitted.is_some() {
        return file;
    }
    let old_lines = input.old.as_deref().map(split_lines);
    let new_lines = input.new.as_deref().map(split_lines);

    let diff = match (&old_lines, &new_lines) {
        (None, Some(new)) => one_sided(new, false),
        (Some(old), None) => one_sided(old, true),
        (Some(old), Some(new)) => match engine {
            // Unchanged to difftastic but not to git (whitespace, say): show
            // the lines that differ rather than nothing.
            Some(e) if e.unchanged && old == new => EngineDiff {
                language: e.language,
                novel_old: vec![Vec::new(); old.len()],
                novel_new: vec![Vec::new(); new.len()],
                ..linediff::diff(old, new)
            },
            // Plain text, which difftastic diffs a whole line at a time: the
            // line diff marks the words that changed.
            Some(e) if e.unchanged || e.language.as_deref() == Some(PLAIN_TEXT) => {
                EngineDiff { language: e.language, ..linediff::diff(old, new) }
            }
            Some(e) if !e.rows.is_empty() || (old.is_empty() && new.is_empty()) => e,
            _ => linediff::diff(old, new),
        },
        (None, None) => EngineDiff::default(),
    };

    let lang = Lang::from_path(&input.path);
    file.language = lang.map(|l| l.display_name().to_owned()).or(diff.language.clone());
    file.rows = diff.rows;
    let old_lang = input.old_path.as_deref().and_then(Lang::from_path).or(lang);
    file.old = old_lines.map(|lines| side(input.old.as_deref().unwrap_or(""), lines, &diff.novel_old, old_lang));
    file.new = new_lines.map(|lines| side(input.new.as_deref().unwrap_or(""), lines, &diff.novel_new, lang));

    let has_novel = |s: &Option<SideText>, i: Option<u32>| match (s, i) {
        (Some(s), Some(i)) => !s.novel[i as usize].is_empty(),
        _ => false,
    };
    for &Row(a, b) in &file.rows {
        let changed = a.is_none() || b.is_none() || has_novel(&file.old, a) || has_novel(&file.new, b);
        if changed && b.is_some() {
            file.added += 1;
        }
        if changed && a.is_some() {
            file.removed += 1;
        }
    }
    file
}

/// Rows and novelty for a file that exists on one side only: every line is new.
fn one_sided(lines: &[String], old_side: bool) -> EngineDiff {
    let whole: Vec<Vec<(usize, usize)>> = lines
        .iter()
        .map(|l| {
            let s = l.len() - l.trim_start().len();
            if s == l.len() { Vec::new() } else { vec![(s, l.len())] }
        })
        .collect();
    let rows = (0..lines.len() as u32).map(|i| if old_side { Row(Some(i), None) } else { Row(None, Some(i)) }).collect();
    EngineDiff {
        language: None,
        rows,
        novel_old: if old_side { whole.clone() } else { Vec::new() },
        novel_new: if old_side { Vec::new() } else { whole },
        unchanged: false,
    }
}

fn side(source: &str, lines: Vec<String>, novel_bytes: &[Vec<(usize, usize)>], lang: Option<Lang>) -> SideText {
    let syntax = match lang {
        Some(l) => highlight(l, source, lines.len()),
        None => vec![Vec::new(); lines.len()],
    };
    let novel = lines
        .iter()
        .enumerate()
        .map(|(i, line)| {
            novel_bytes
                .get(i)
                .filter(|ranges| !ranges.is_empty())
                .map(|ranges| {
                    let cols = Utf16Cols::new(line);
                    ranges.iter().flat_map(|&(a, b)| [cols.col(a), cols.col(b)]).collect()
                })
                .unwrap_or_default()
        })
        .collect();
    SideText { lines, syntax, novel }
}

/// Assemble a snapshot, collecting definitions from both sides of every file.
pub fn snapshot(revision: Revision, inputs: &[FileInput], files: Vec<FileDiff>) -> Snapshot {
    let mut symbols = Vec::new();
    for (i, (input, file)) in inputs.iter().zip(&files).enumerate() {
        let i = i as u32;
        if let (Some(src), Some(text)) = (&input.new, &file.new)
            && let Some(lang) = Lang::from_path(&input.path)
        {
            symbols.extend(definitions(lang, src, i, crate::model::Side::New, &text.lines));
        }
        // Old-side definitions only matter for deleted files; elsewhere they duplicate new ones.
        if input.status == FileStatus::Deleted
            && let (Some(src), Some(text)) = (&input.old, &file.old)
        {
            let path = input.old_path.as_deref().unwrap_or(&input.path);
            if let Some(lang) = Lang::from_path(path) {
                symbols.extend(definitions(lang, src, i, crate::model::Side::Old, &text.lines));
            }
        }
    }
    Snapshot { revision, files, symbols }
}

/// Mark new-side lines that changed since the previous revision of the same file.
pub fn mark_since(prev: &FileDiff, cur: &mut FileDiff) {
    let (Some(p), Some(c)) = (&prev.new, &cur.new) else { return };
    cur.since = linediff::changed_lines(&p.lines, &c.lines);
}

#[cfg(test)]
mod tests {
    use super::*;

    fn input(old: Option<&str>, new: Option<&str>) -> FileInput {
        FileInput {
            path: "src/lib.rs".into(),
            old_path: None,
            status: match (old, new) {
                (None, _) => FileStatus::Added,
                (_, None) => FileStatus::Deleted,
                _ => FileStatus::Modified,
            },
            old: old.map(str::to_owned),
            new: new.map(str::to_owned),
            omitted: None,
            details: Vec::new(),
            collapsed: None,
        }
    }

    #[test]
    fn added_file_is_all_new() {
        let f = build_file(&input(None, Some("fn a() {}\n\nfn b() {}\n")), None);
        assert_eq!(f.rows, vec![Row(None, Some(0)), Row(None, Some(1)), Row(None, Some(2))]);
        assert_eq!(f.added, 3);
        let new = f.new.unwrap();
        assert_eq!(new.novel[0], vec![0, 9]);
        assert!(new.novel[1].is_empty());
        assert!(!new.syntax[0].is_empty());
        assert_eq!(f.language.as_deref(), Some("Rust"));
    }

    #[test]
    fn falls_back_to_line_diff() {
        let f = build_file(&input(Some("let a = 1;\n"), Some("let a = 2;\n")), None);
        assert_eq!(f.rows, vec![Row(Some(0), Some(0))]);
        assert_eq!(f.new.as_ref().unwrap().novel[0], vec![8, 9]);
        assert_eq!((f.added, f.removed), (1, 1));
    }

    #[test]
    fn whitespace_changes_difftastic_ignores_still_show() {
        let e = EngineDiff { unchanged: true, ..Default::default() };
        let f = build_file(&input(Some("f(a,b)\n"), Some("f(a, b)\n")), Some(e));
        assert_eq!((f.added, f.removed), (1, 1));
        assert_eq!(f.new.unwrap().novel[0], vec![4, 5], "only the added space");

        let e = EngineDiff { unchanged: true, ..Default::default() };
        let f = build_file(&input(Some("same\n"), Some("same\n")), Some(e));
        assert_eq!((f.added, f.removed), (0, 0));
    }

    #[test]
    fn novel_offsets_are_utf16() {
        let e = EngineDiff {
            language: None,
            rows: vec![Row(Some(0), Some(0))],
            novel_old: vec![vec![]],
            novel_new: vec![vec![(25, 28)]],
            unchanged: false,
        };
        let f = build_file(&input(Some("let s = \"héllo wörld\";\n"), Some("let s = \"héllo wörld\"; let z = 1;\n")), Some(e));
        assert_eq!(f.new.unwrap().novel[0], vec![23, 26]);
    }
}
