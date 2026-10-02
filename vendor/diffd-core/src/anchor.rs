//! Following a thread's lines from one revision to the next.

/// Where a thread's anchored text ended up in a new revision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Reanchor {
    /// Same text, same place.
    Same,
    /// Same text, found elsewhere; new 1-based line range.
    Moved { start: u32, end: u32 },
    /// The text is gone or changed.
    Changed,
}

/// Find `text` (the anchored lines) in `lines`, preferring the occurrence
/// closest to where it used to start (`start`, 1-based).
pub fn reanchor(text: &str, start: u32, lines: &[String]) -> Reanchor {
    let want: Vec<&str> = text.split('\n').collect();
    let n = want.len();
    if n == 0 || n > lines.len() {
        return Reanchor::Changed;
    }
    let origin = start.saturating_sub(1) as usize;
    let best =
        (0..=lines.len() - n).filter(|&i| lines[i..i + n].iter().zip(&want).all(|(a, b)| a == b)).min_by_key(|&i| i.abs_diff(origin));
    match best {
        Some(i) if i == origin => Reanchor::Same,
        Some(i) => Reanchor::Moved { start: i as u32 + 1, end: (i + n) as u32 },
        None => Reanchor::Changed,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn lines(s: &str) -> Vec<String> {
        s.lines().map(str::to_owned).collect()
    }

    #[test]
    fn follows_moved_lines() {
        assert_eq!(reanchor("b\nc", 2, &lines("a\nb\nc")), Reanchor::Same);
        assert_eq!(reanchor("b\nc", 2, &lines("x\ny\na\nb\nc")), Reanchor::Moved { start: 4, end: 5 });
        assert_eq!(reanchor("b\nc", 2, &lines("a\nB\nc")), Reanchor::Changed);
    }

    #[test]
    fn prefers_the_nearest_copy() {
        assert_eq!(reanchor("x", 5, &lines("x\na\na\na\na\nx")), Reanchor::Moved { start: 6, end: 6 });
    }
}

/// Where 1-based `line` of `prev` ends up in `cur`, following the line diff
/// between them: unchanged lines keep their place, edited or removed lines
/// map to the start of whatever replaced them.
pub fn map_line(prev: &[String], cur: &[String], line: u32) -> u32 {
    use similar::{Algorithm, DiffOp, capture_diff_slices};
    let target = line.saturating_sub(1) as usize;
    for op in capture_diff_slices(Algorithm::Patience, prev, cur) {
        let (old, new) = (op.old_range(), op.new_range());
        if !old.contains(&target) {
            continue;
        }
        let mapped = match op {
            DiffOp::Equal { .. } => new.start + (target - old.start),
            _ => new.start + (target - old.start).min(new.len().saturating_sub(1)),
        };
        return (mapped.min(cur.len().saturating_sub(1)) + 1) as u32;
    }
    (line as usize).min(cur.len().max(1)) as u32
}

#[cfg(test)]
mod map_tests {
    use super::map_line;

    fn lines(s: &str) -> Vec<String> {
        s.lines().map(str::to_owned).collect()
    }

    #[test]
    fn follows_insertions_and_edits() {
        let prev = lines("a\nb\nc\nd");
        let cur = lines("x\ny\na\nb\nC\nd");
        assert_eq!(map_line(&prev, &cur, 1), 3);
        assert_eq!(map_line(&prev, &cur, 3), 5);
        assert_eq!(map_line(&prev, &cur, 4), 6);
    }
}
