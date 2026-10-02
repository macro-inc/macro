//! A line diff with word-level highlights, used when difftastic can't help:
//! unknown or binary-ish text, files past its limits, or a timeout.

use std::time::{Duration, Instant};

use similar::{Algorithm, DiffOp, capture_diff_slices_deadline};

use crate::difft::EngineDiff;
use crate::model::Row;

/// Past this, a file's line diff settles for a coarser (still correct) answer.
const FILE_DEADLINE: Duration = Duration::from_secs(2);
/// The same for the words of one changed line.
const LINE_DEADLINE: Duration = Duration::from_millis(20);

pub fn diff(old: &[String], new: &[String]) -> EngineDiff {
    let mut d = EngineDiff {
        language: None,
        rows: Vec::with_capacity(old.len().max(new.len())),
        novel_old: vec![Vec::new(); old.len()],
        novel_new: vec![Vec::new(); new.len()],
        unchanged: false,
    };
    for op in capture_diff_slices_deadline(Algorithm::Patience, old, new, Some(Instant::now() + FILE_DEADLINE)) {
        match op {
            DiffOp::Equal { old_index, new_index, len } => {
                for k in 0..len {
                    d.rows.push(Row(Some((old_index + k) as u32), Some((new_index + k) as u32)));
                }
            }
            DiffOp::Delete { old_index, old_len, .. } => deleted(&mut d, old, old_index..old_index + old_len),
            DiffOp::Insert { new_index, new_len, .. } => inserted(&mut d, new, new_index..new_index + new_len),
            DiffOp::Replace { old_index, old_len, new_index, new_len } => {
                let paired = old_len.min(new_len);
                for k in 0..paired {
                    let (i, j) = (old_index + k, new_index + k);
                    d.rows.push(Row(Some(i as u32), Some(j as u32)));
                    let (a, b) = word_diff(&old[i], &new[j]);
                    d.novel_old[i] = a;
                    d.novel_new[j] = b;
                }
                deleted(&mut d, old, old_index + paired..old_index + old_len);
                inserted(&mut d, new, new_index + paired..new_index + new_len);
            }
        }
    }
    d
}

type Ranges = Vec<(usize, usize)>;

fn deleted(d: &mut EngineDiff, old: &[String], range: std::ops::Range<usize>) {
    for (i, line) in old[range.clone()].iter().enumerate() {
        d.rows.push(Row(Some((range.start + i) as u32), None));
        d.novel_old[range.start + i] = whole_line(line);
    }
}

fn inserted(d: &mut EngineDiff, new: &[String], range: std::ops::Range<usize>) {
    for (i, line) in new[range.clone()].iter().enumerate() {
        d.rows.push(Row(None, Some((range.start + i) as u32)));
        d.novel_new[range.start + i] = whole_line(line);
    }
}

/// New-side lines (1-based) that were inserted or changed relative to `prev`.
pub fn changed_lines(prev: &[String], cur: &[String]) -> Vec<u32> {
    let mut out = Vec::new();
    for op in capture_diff_slices_deadline(Algorithm::Patience, prev, cur, Some(Instant::now() + FILE_DEADLINE)) {
        if let DiffOp::Insert { new_index, new_len, .. } | DiffOp::Replace { new_index, new_len, .. } = op {
            out.extend((new_index..new_index + new_len).map(|i| i as u32 + 1));
        }
    }
    out
}

fn whole_line(line: &str) -> Ranges {
    let start = line.len() - line.trim_start().len();
    if start == line.len() { Vec::new() } else { vec![(start, line.len())] }
}

/// Split a line into words, runs of whitespace and single punctuation marks.
fn tokens(line: &str) -> Vec<(usize, &str)> {
    let mut out = Vec::new();
    let mut chars = line.char_indices().peekable();
    while let Some((i, c)) = chars.next() {
        let class = |c: char| {
            if c.is_alphanumeric() || c == '_' {
                0
            } else if c.is_whitespace() {
                1
            } else {
                2
            }
        };
        let k = class(c);
        let mut end = i + c.len_utf8();
        if k != 2 {
            while let Some(&(j, d)) = chars.peek() {
                if class(d) != k {
                    break;
                }
                end = j + d.len_utf8();
                chars.next();
            }
        }
        out.push((i, &line[i..end]));
    }
    out
}

fn word_diff(a: &str, b: &str) -> (Ranges, Ranges) {
    let (ta, tb) = (tokens(a), tokens(b));
    let wa: Vec<&str> = ta.iter().map(|t| t.1).collect();
    let wb: Vec<&str> = tb.iter().map(|t| t.1).collect();
    let ops = capture_diff_slices_deadline(Algorithm::Myers, &wa, &wb, Some(Instant::now() + LINE_DEADLINE));
    // Whitespace is marked only when nothing else changed: otherwise it's noise.
    let marked = |blanks: bool| {
        let (mut na, mut nb) = (Vec::new(), Vec::new());
        let mark = |out: &mut Ranges, toks: &[(usize, &str)], from: usize, len: usize| {
            for &(at, text) in &toks[from..from + len] {
                if !blanks && text.trim().is_empty() {
                    continue;
                }
                match out.last_mut() {
                    Some(last) if last.1 == at => last.1 = at + text.len(),
                    _ => out.push((at, at + text.len())),
                }
            }
        };
        for op in &ops {
            match *op {
                DiffOp::Equal { .. } => {}
                DiffOp::Delete { old_index, old_len, .. } => mark(&mut na, &ta, old_index, old_len),
                DiffOp::Insert { new_index, new_len, .. } => mark(&mut nb, &tb, new_index, new_len),
                DiffOp::Replace { old_index, old_len, new_index, new_len } => {
                    mark(&mut na, &ta, old_index, old_len);
                    mark(&mut nb, &tb, new_index, new_len);
                }
            }
        }
        (na, nb)
    };
    match marked(false) {
        (na, nb) if na.is_empty() && nb.is_empty() && a != b => marked(true),
        words => words,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(s: &str) -> Vec<String> {
        s.lines().map(str::to_owned).collect()
    }

    #[test]
    fn diffs_lines_and_words() {
        let d = diff(&lines("a\nlet x = 1;\nc"), &lines("a\nlet x = 2;\nnew\nc"));
        assert_eq!(d.rows.len(), 4);
        assert_eq!(d.novel_old[1], vec![(8, 9)]);
        assert_eq!(d.novel_new[1], vec![(8, 9)]);
        assert_eq!(d.novel_new[2], vec![(0, 3)]);
    }

    #[test]
    fn finds_changed_lines() {
        assert_eq!(changed_lines(&lines("a\nb\nc"), &lines("a\nB\nc\nd")), vec![2, 4]);
    }
}
