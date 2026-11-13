//! The attestation section of an authorship note (`authorship/3.0.0`, git-ai
//! `specs/git_ai_standard_v3.0.0.md` §1.2.3, Apache-2.0): which lines of
//! each file a session wrote. The section is file path lines, each followed
//! by entry lines indented two spaces: `<key> <ranges>`, where ranges are
//! `1-4,9,12-20`. It ends at the `---` line before the metadata JSON.
//!
//! Keys: `s_<14hex>::t_<14hex>` is a session plus one edit (the session id
//! is the part before `::`), `h_<14hex>` a known human, and a bare hex key a
//! legacy prompt hash, which is its own session id.

use std::collections::{BTreeMap, BTreeSet};

use nom::branch::alt;
use nom::bytes::complete::{tag, take_till1, take_while1};
use nom::character::complete::{char, u32 as line_number};
use nom::combinator::{all_consuming, map, opt};
use nom::multi::separated_list1;
use nom::sequence::{delimited, preceded, separated_pair};
use nom::{IResult, Parser};

#[cfg(test)]
mod test;

const SECTION_END: &str = "---";
const ENTRY_INDENT: &str = "  ";
const SESSION_KEY_PREFIX: &str = "s_";
const HUMAN_KEY_PREFIX: &str = "h_";
const TRACE_SEPARATOR: &str = "::";

/// Lines each session wrote, per file: path → session id → line numbers.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct Attestations(BTreeMap<String, BTreeMap<String, BTreeSet<u32>>>);

impl Attestations {
    /// Parses a note's attestation section. Lines that do not fit the
    /// grammar are skipped, so one odd line never hides the rest.
    pub fn parse(note: &str) -> Self {
        let mut files: BTreeMap<String, BTreeMap<String, BTreeSet<u32>>> = BTreeMap::new();
        let mut current: Option<String> = None;

        for line in note.lines() {
            if line == SECTION_END {
                break;
            }

            if let Some(entry) = line.strip_prefix(ENTRY_INDENT) {
                let (Some(path), Ok((_, (key, ranges)))) = (&current, entry_line(entry)) else {
                    continue;
                };
                let Some(session_id) = session_id_of_key(key) else {
                    continue;
                };
                let lines = files
                    .entry(path.clone())
                    .or_default()
                    .entry(session_id.to_owned())
                    .or_default();
                for (start, end) in ranges {
                    lines.extend(start..=end);
                }
                continue;
            }

            current = file_line(line).ok().map(|(_, path)| path.to_owned());
        }

        Self(files)
    }

    /// Sessions that wrote lines of `path`, with how many.
    pub fn sessions_in_file(&self, path: &str) -> BTreeMap<&str, usize> {
        self.0
            .get(path)
            .into_iter()
            .flatten()
            .map(|(session, lines)| (session.as_str(), lines.len()))
            .collect()
    }

    /// The session that wrote `line` of `path`, if one did.
    pub fn session_at(&self, path: &str, line: u32) -> Option<&str> {
        self.0
            .get(path)?
            .iter()
            .find(|(_, lines)| lines.contains(&line))
            .map(|(session, _)| session.as_str())
    }

    /// Lines each session wrote, over every file.
    pub fn lines_per_session(&self) -> BTreeMap<&str, u64> {
        let mut totals: BTreeMap<&str, u64> = BTreeMap::new();
        for sessions in self.0.values() {
            for (session, lines) in sessions {
                let count = u64::try_from(lines.len()).unwrap_or(u64::MAX);
                *totals.entry(session.as_str()).or_default() += count;
            }
        }
        totals
    }
}

/// The session id an attestation key names; `None` for a human key.
fn session_id_of_key(key: &str) -> Option<&str> {
    if key.starts_with(HUMAN_KEY_PREFIX) {
        return None;
    }
    if key.starts_with(SESSION_KEY_PREFIX) {
        return key.split(TRACE_SEPARATOR).next();
    }
    Some(key)
}

/// A file path line: a quoted path, or the whole line.
fn file_line(input: &str) -> IResult<&str, &str> {
    let quoted = delimited(char('"'), take_till1(|c| c == '"'), char('"'));
    let bare = take_while1(|_| true);
    all_consuming(alt((quoted, bare))).parse(input)
}

/// Inclusive (start, end) line ranges.
type LineRanges = Vec<(u32, u32)>;

/// `<key> <ranges>`, after the two-space indent.
fn entry_line(input: &str) -> IResult<&str, (&str, LineRanges)> {
    let key = take_while1(|c: char| !c.is_whitespace());
    all_consuming(separated_pair(key, char(' '), ranges)).parse(input)
}

/// `1-4,9,12-20` as inclusive (start, end) pairs.
fn ranges(input: &str) -> IResult<&str, LineRanges> {
    let range = map(
        (line_number, opt(preceded(tag("-"), line_number))),
        |(start, end)| (start, end.unwrap_or(start)),
    );
    separated_list1(char(','), range).parse(input)
}
