//! Reading difftastic's JSON output (`DFT_UNSTABLE=yes difft --display json`).
//!
//! difftastic reports a full line alignment plus, for each changed line, the
//! byte ranges of its novel tokens. We turn that into an [`EngineDiff`].

use serde::Deserialize;

use crate::model::Row;

/// What a diff engine produces for one file. Offsets are bytes within a line.
#[derive(Debug, Clone, PartialEq, Default)]
pub struct EngineDiff {
    pub language: Option<String>,
    pub rows: Vec<Row>,
    pub novel_old: Vec<Vec<(usize, usize)>>,
    pub novel_new: Vec<Vec<(usize, usize)>>,
    /// difftastic found no syntactic change (e.g. only whitespace moved).
    pub unchanged: bool,
}

#[derive(Debug, thiserror::Error)]
#[error("difftastic output was not valid JSON: {0}")]
pub struct ParseError(#[from] serde_json::Error);

#[derive(Deserialize)]
struct Output {
    #[serde(default)]
    aligned_lines: Option<Vec<(Option<u32>, Option<u32>)>>,
    #[serde(default)]
    chunks: Vec<Vec<Entry>>,
    language: Option<String>,
    status: String,
}

#[derive(Deserialize)]
struct Entry {
    lhs: Option<LineChanges>,
    rhs: Option<LineChanges>,
}

#[derive(Deserialize)]
struct LineChanges {
    line_number: usize,
    changes: Vec<Change>,
}

#[derive(Deserialize)]
struct Change {
    start: usize,
    end: usize,
}

/// Byte spans of changes, minus empty or reversed ones (never trust a subprocess).
fn spans(changes: &[Change]) -> impl Iterator<Item = (usize, usize)> + '_ {
    changes.iter().filter(|c| c.start < c.end).map(|c| (c.start, c.end))
}

/// Parse one file's JSON. Returns `None` when difftastic couldn't align the
/// file (it only reports that for created/deleted files), so the caller
/// falls back to a line diff.
pub fn parse(json: &str, old_lines: usize, new_lines: usize) -> Result<Option<EngineDiff>, ParseError> {
    let out: Output = serde_json::from_str(json)?;
    let unchanged = out.status == "unchanged";
    let Some(aligned) = out.aligned_lines else {
        return Ok(unchanged.then(|| EngineDiff { language: out.language, unchanged, ..Default::default() }));
    };
    let mut diff = EngineDiff {
        language: out.language,
        rows: normalize(aligned.into_iter().map(|(a, b)| Row(a, b)), old_lines, new_lines),
        novel_old: vec![Vec::new(); old_lines],
        novel_new: vec![Vec::new(); new_lines],
        unchanged,
    };
    for entry in out.chunks.into_iter().flatten() {
        if let Some(lhs) = entry.lhs
            && let Some(line) = diff.novel_old.get_mut(lhs.line_number)
        {
            line.extend(spans(&lhs.changes));
        }
        if let Some(rhs) = entry.rhs
            && let Some(line) = diff.novel_new.get_mut(rhs.line_number)
        {
            line.extend(spans(&rhs.changes));
        }
    }
    for line in diff.novel_old.iter_mut().chain(diff.novel_new.iter_mut()) {
        line.sort_unstable();
    }
    Ok(Some(diff))
}

/// Make an alignment cover every line of both files exactly once, in order.
///
/// Out-of-range and backwards indices are dropped, and any line the engine
/// skipped is filled in, paired with a skipped line on the other side when
/// possible.
pub fn normalize(rows: impl IntoIterator<Item = Row>, old_lines: usize, new_lines: usize) -> Vec<Row> {
    let (n_old, n_new) = (old_lines as u32, new_lines as u32);
    let mut out = Vec::with_capacity(old_lines.max(new_lines));
    let (mut next_old, mut next_new) = (0u32, 0u32);
    let fill = |out: &mut Vec<Row>, next_old: &mut u32, next_new: &mut u32, to_old: u32, to_new: u32| {
        while *next_old < to_old && *next_new < to_new {
            out.push(Row(Some(*next_old), Some(*next_new)));
            *next_old += 1;
            *next_new += 1;
        }
        while *next_old < to_old {
            out.push(Row(Some(*next_old), None));
            *next_old += 1;
        }
        while *next_new < to_new {
            out.push(Row(None, Some(*next_new)));
            *next_new += 1;
        }
    };
    for Row(a, b) in rows {
        let a = a.filter(|&a| a < n_old && a >= next_old);
        let b = b.filter(|&b| b < n_new && b >= next_new);
        if a.is_none() && b.is_none() {
            continue;
        }
        let (to_old, to_new) = (a.unwrap_or(next_old), b.unwrap_or(next_new));
        fill(&mut out, &mut next_old, &mut next_new, to_old, to_new);
        out.push(Row(a, b));
        if let Some(a) = a {
            next_old = a + 1;
        }
        if let Some(b) = b {
            next_new = b + 1;
        }
    }
    fill(&mut out, &mut next_old, &mut next_new, n_old, n_new);
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_difftastic_json() {
        let json = r#"{"aligned_lines":[[0,0],[1,1],[2,2]],"chunks":[[{"lhs":{"line_number":1,"changes":[{"start":8,"end":9,"content":"1","highlight":"normal"}]},"rhs":{"line_number":1,"changes":[{"start":8,"end":9,"content":"2","highlight":"normal"}]}}]],"language":"JavaScript","path":"u.js","status":"changed"}"#;
        let d = parse(json, 2, 2).unwrap().unwrap();
        assert_eq!(d.language.as_deref(), Some("JavaScript"));
        assert_eq!(d.rows, vec![Row(Some(0), Some(0)), Row(Some(1), Some(1))]);
        assert_eq!(d.novel_old[1], vec![(8, 9)]);
        assert_eq!(d.novel_new[1], vec![(8, 9)]);
    }

    #[test]
    fn created_files_have_no_alignment() {
        let json = r#"{"language":"Text","path":"p.txt","status":"created"}"#;
        assert!(parse(json, 0, 2).unwrap().is_none());
    }

    #[test]
    fn normalize_fills_gaps_and_drops_junk() {
        let rows = vec![Row(Some(0), Some(0)), Row(Some(3), Some(2)), Row(Some(1), None), Row(Some(9), Some(9))];
        assert_eq!(
            normalize(rows, 5, 3),
            vec![Row(Some(0), Some(0)), Row(Some(1), Some(1)), Row(Some(2), None), Row(Some(3), Some(2)), Row(Some(4), None),]
        );
    }
}
