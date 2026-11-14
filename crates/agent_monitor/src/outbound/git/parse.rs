//! Parsers for the git output the backend asks for: one record per line,
//! fields separated by NUL, so no subject or path can break a field.

use std::collections::BTreeMap;
use std::path::PathBuf;

use chrono::DateTime;

use crate::domain::model::{Oid, Timestamp};

/// `for-each-ref`: name, object, commit time, worktree, symref target.
pub const REF_FORMAT: &str =
    "--format=%(refname)%00%(objectname)%00%(committerdate:unix)%00%(worktreepath)%00%(symref)";

/// `log`: id, parents, commit time, author, subject.
pub const COMMIT_FORMAT: &str = "--format=%H%x00%P%x00%ct%x00%an%x00%s";

/// `log --boundary`: the boundary mark (`-`), then [`COMMIT_FORMAT`]'s fields.
pub const LOG_FORMAT: &str = "--format=%m%x00%H%x00%P%x00%ct%x00%an%x00%s";

/// One ref.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RefRow {
    /// The full name, such as `refs/heads/main`.
    pub name: String,
    /// The commit it points at.
    pub oid: Oid,
    /// The commit's time.
    pub at: Option<Timestamp>,
    /// The worktree it is checked out in, for a local branch.
    pub worktree: Option<PathBuf>,
    /// For a symbolic ref (`origin/HEAD`), the full name it points at.
    pub symref: Option<String>,
}

/// One commit as `log` prints it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct RawCommit {
    /// Its id.
    pub oid: Oid,
    /// Its parents, first parent first.
    pub parents: Vec<Oid>,
    /// Its commit time.
    pub at: Timestamp,
    /// Its author.
    pub author: String,
    /// Its subject.
    pub subject: String,
}

/// One line of `log --boundary`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LogLine {
    /// The walk stopped here: excluded by the trunk, or cut off by the limit.
    pub boundary: bool,
    /// The commit.
    pub commit: RawCommit,
}

/// A Unix time in seconds.
pub fn unix(text: &str) -> Option<Timestamp> {
    DateTime::from_timestamp(text.trim().parse().ok()?, 0)
}

fn lines(output: &[u8]) -> impl Iterator<Item = &str> {
    std::str::from_utf8(output)
        .unwrap_or_default()
        .lines()
        .filter(|line| !line.is_empty())
}

fn non_empty(text: &str) -> Option<&str> {
    Some(text).filter(|text| !text.is_empty())
}

/// Rows of [`REF_FORMAT`]; a row that does not parse is skipped.
pub fn refs(output: &[u8]) -> Vec<RefRow> {
    lines(output)
        .filter_map(|line| {
            let mut fields = line.split('\0');
            let name = fields.next()?.to_owned();
            let oid = Oid::parse(fields.next()?)?;
            let at = unix(fields.next().unwrap_or(""));
            let worktree = non_empty(fields.next().unwrap_or("")).map(PathBuf::from);
            let symref = non_empty(fields.next().unwrap_or("")).map(str::to_owned);
            Some(RefRow {
                name,
                oid,
                at,
                worktree,
                symref,
            })
        })
        .collect()
}

/// `refname NUL "ahead behind"` rows.
pub fn ahead_behind(output: &[u8]) -> BTreeMap<String, (u32, u32)> {
    lines(output)
        .filter_map(|line| {
            let (name, counts) = line.split_once('\0')?;
            let mut counts = counts.split_whitespace();
            let ahead = counts.next()?.parse().ok()?;
            let behind = counts.next()?.parse().ok()?;
            Some((name.to_owned(), (ahead, behind)))
        })
        .collect()
}

/// `rev-list --left-right --count A...B`: `left right`.
pub fn left_right(output: &[u8]) -> Option<(u32, u32)> {
    let text = std::str::from_utf8(output).ok()?;
    let mut counts = text.split_whitespace();
    Some((counts.next()?.parse().ok()?, counts.next()?.parse().ok()?))
}

fn commit<'a>(mut fields: impl Iterator<Item = &'a str>) -> Option<RawCommit> {
    let oid = Oid::parse(fields.next()?)?;
    let parents = fields
        .next()?
        .split_whitespace()
        .filter_map(Oid::parse)
        .collect();
    let at = unix(fields.next()?)?;
    let author = fields.next()?.to_owned();
    let subject = fields.next().unwrap_or("").to_owned();
    Some(RawCommit {
        oid,
        parents,
        at,
        author,
        subject,
    })
}

/// Rows of [`COMMIT_FORMAT`].
pub fn commits(output: &[u8]) -> Vec<RawCommit> {
    lines(output)
        .filter_map(|line| commit(line.split('\0')))
        .collect()
}

/// Rows of [`LOG_FORMAT`].
pub fn log_lines(output: &[u8]) -> Vec<LogLine> {
    lines(output)
        .filter_map(|line| {
            let mut fields = line.split('\0');
            let mark = fields.next()?;
            Some(LogLine {
                boundary: mark == "-",
                commit: commit(fields)?,
            })
        })
        .collect()
}
