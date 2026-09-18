//! Reading a git-style unified diff into per-file facts.
//!
//! Every extractor hands the service a raw patch - `git diff` output, or the
//! diff GitHub renders for a compare - and this is the one place that reads
//! it: which files it touches, what happened to each, how many lines moved,
//! and which files carry no text at all. Doing it here, once, is what keeps
//! extractors trivial and the summary identical whichever harness produced it.
//!
//! The reader is deliberately forgiving. A patch is a stream of `diff --git`
//! blocks; anything before the first block is ignored, an unknown extended
//! header line is skipped, and a block with no hunks is a rename, a mode
//! change, or a binary file rather than an error.

use super::model::{ChangedFile, FileChangeKind};

#[cfg(test)]
mod test;

/// The most patch text stored for one changeset. Past this, whole files are
/// left out (largest last-in-order first) and the summary says so.
pub const MAX_PATCH_BYTES: usize = 6 * 1024 * 1024;

/// The most patch text stored for one file. A single file past this is a
/// generated artifact or a vendored tree, not something anyone reviews line
/// by line; its summary row stays, its hunks go.
pub const MAX_FILE_PATCH_BYTES: usize = 1024 * 1024;

/// One file's slice of a patch: the facts, and the text they were read from.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ParsedFile {
    /// What the diff says about the file.
    pub file: ChangedFile,
    /// This file's complete block, `diff --git` header through its last
    /// hunk line, without a trailing newline.
    pub text: String,
}

/// Split `patch` into its files, in order.
#[must_use]
pub fn parse_git_patch(patch: &str) -> Vec<ParsedFile> {
    let mut files = Vec::new();
    let mut current: Option<BlockReader> = None;
    for line in patch.split_inclusive('\n') {
        let content = line.strip_suffix('\n').unwrap_or(line);
        let content = content.strip_suffix('\r').unwrap_or(content);
        if let Some(rest) = content.strip_prefix("diff --git ") {
            if let Some(block) = current.take() {
                files.push(block.finish());
            }
            current = Some(BlockReader::start(rest, line));
            continue;
        }
        if let Some(block) = current.as_mut() {
            block.push(content, line);
        }
    }
    if let Some(block) = current.take() {
        files.push(block.finish());
    }
    files
}

/// A patch cut down to the size budget: the text to store, the files with
/// `patch_omitted` set where their hunks were dropped, and whether anything
/// was.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BudgetedPatch {
    /// The concatenated blocks that fit.
    pub patch: String,
    /// Every file, in patch order.
    pub files: Vec<ChangedFile>,
    /// Whether any file's hunks were left out.
    pub truncated: bool,
}

/// Keep as much of `files` as the budget allows.
///
/// A file larger than `max_file_bytes` is always omitted; the rest are kept
/// in patch order while the running total stays within `max_total_bytes`.
/// Order is preserved rather than packing by size so the stored patch reads
/// like the diff it came from.
#[must_use]
pub fn budget_patch(
    files: Vec<ParsedFile>,
    max_total_bytes: usize,
    max_file_bytes: usize,
) -> BudgetedPatch {
    let mut patch = String::new();
    let mut kept = Vec::with_capacity(files.len());
    let mut truncated = false;
    for parsed in files {
        let ParsedFile { mut file, text } = parsed;
        let block_bytes = text.len() + 1;
        let fits = text.len() <= max_file_bytes && patch.len() + block_bytes <= max_total_bytes;
        if fits && !file.binary {
            patch.push_str(&text);
            patch.push('\n');
        } else if !file.binary {
            file.patch_omitted = true;
            truncated = true;
        }
        kept.push(file);
    }
    BudgetedPatch {
        patch,
        files: kept,
        truncated,
    }
}

/// Totals across a changeset's files.
#[must_use]
pub fn totals(files: &[ChangedFile]) -> (u32, u32) {
    files.iter().fold((0, 0), |(adds, dels), file| {
        (
            adds.saturating_add(file.additions),
            dels.saturating_add(file.deletions),
        )
    })
}

/// Reads one `diff --git` block line by line.
struct BlockReader {
    header_old: String,
    header_new: String,
    old_path: Option<String>,
    new_path: Option<String>,
    rename_from: Option<String>,
    rename_to: Option<String>,
    added: bool,
    deleted: bool,
    binary: bool,
    in_hunks: bool,
    additions: u32,
    deletions: u32,
    text: String,
}

impl BlockReader {
    fn start(header_rest: &str, raw_line: &str) -> Self {
        let (header_old, header_new) = split_header_paths(header_rest);
        Self {
            header_old,
            header_new,
            old_path: None,
            new_path: None,
            rename_from: None,
            rename_to: None,
            added: false,
            deleted: false,
            binary: false,
            in_hunks: false,
            additions: 0,
            deletions: 0,
            text: raw_line.to_owned(),
        }
    }

    fn push(&mut self, content: &str, raw_line: &str) {
        self.text.push_str(raw_line);
        if self.in_hunks {
            self.count(content);
            return;
        }
        if content.starts_with("@@") {
            self.in_hunks = true;
            return;
        }
        if let Some(path) = content.strip_prefix("--- ") {
            self.old_path = Some(strip_side(path, "a/"));
        } else if let Some(path) = content.strip_prefix("+++ ") {
            self.new_path = Some(strip_side(path, "b/"));
        } else if content.starts_with("new file mode") {
            self.added = true;
        } else if content.starts_with("deleted file mode") {
            self.deleted = true;
        } else if let Some(from) = content.strip_prefix("rename from ") {
            self.rename_from = Some(unquote(from));
        } else if let Some(to) = content.strip_prefix("rename to ") {
            self.rename_to = Some(unquote(to));
        } else if content.starts_with("Binary files ") || content.starts_with("GIT binary patch") {
            self.binary = true;
        }
    }

    fn count(&mut self, content: &str) {
        // `--- `/`+++ ` cannot be headers here: a header only precedes the
        // first hunk, and inside one a leading `-`/`+` is a changed line
        // whatever follows it.
        if content.starts_with('+') {
            self.additions = self.additions.saturating_add(1);
        } else if content.starts_with('-') {
            self.deletions = self.deletions.saturating_add(1);
        }
    }

    fn finish(mut self) -> ParsedFile {
        while self.text.ends_with('\n') || self.text.ends_with('\r') {
            self.text.pop();
        }
        let dev_null = |path: &Option<String>| path.as_deref() == Some("/dev/null");
        let added = self.added || dev_null(&self.old_path);
        let deleted = self.deleted || dev_null(&self.new_path);
        let renamed = self.rename_from.is_some() || self.rename_to.is_some();

        let new_name = self
            .new_path
            .clone()
            .filter(|path| path != "/dev/null")
            .or_else(|| self.rename_to.clone())
            .unwrap_or_else(|| self.header_new.clone());
        let old_name = self
            .old_path
            .clone()
            .filter(|path| path != "/dev/null")
            .or_else(|| self.rename_from.clone())
            .unwrap_or_else(|| self.header_old.clone());

        let (kind, path, previous_path) = if deleted && !added {
            (FileChangeKind::Deleted, old_name, None)
        } else if added && !deleted {
            (FileChangeKind::Added, new_name, None)
        } else if renamed || old_name != new_name {
            (FileChangeKind::Renamed, new_name, Some(old_name))
        } else {
            (FileChangeKind::Modified, new_name, None)
        };

        ParsedFile {
            file: ChangedFile {
                path,
                previous_path,
                kind,
                additions: self.additions,
                deletions: self.deletions,
                binary: self.binary,
                patch_omitted: false,
            },
            text: self.text,
        }
    }
}

/// `a/OLD b/NEW` into `(OLD, NEW)`.
///
/// Paths can contain spaces, so the split point is the ` b/` after which
/// the two sides read the same - the common case of an unrenamed file - and
/// failing that the first ` b/`. Quoted paths are split on the closing quote.
fn split_header_paths(rest: &str) -> (String, String) {
    if rest.starts_with('"')
        && let Some((old, new)) = split_quoted_pair(rest)
    {
        return (strip_side(&old, "a/"), strip_side(&new, "b/"));
    }
    let candidates: Vec<usize> = rest.match_indices(" b/").map(|(index, _)| index).collect();
    for index in &candidates {
        let old = &rest[..*index];
        let new = &rest[index + 1..];
        if old.strip_prefix("a/") == new.strip_prefix("b/") {
            return (strip_side(old, "a/"), strip_side(new, "b/"));
        }
    }
    match candidates.first() {
        Some(index) => (
            strip_side(&rest[..*index], "a/"),
            strip_side(&rest[index + 1..], "b/"),
        ),
        None => (strip_side(rest, "a/"), strip_side(rest, "b/")),
    }
}

/// Two C-quoted strings separated by a space.
fn split_quoted_pair(rest: &str) -> Option<(String, String)> {
    let mut escaped = false;
    for (index, character) in rest.char_indices().skip(1) {
        match character {
            '\\' if !escaped => escaped = true,
            '"' if !escaped => {
                let first = &rest[..=index];
                let second = rest.get(index + 1..)?.trim_start();
                return Some((unquote(first), unquote(second)));
            }
            _ => escaped = false,
        }
    }
    None
}

/// Drop git's `a/`/`b/` prefix and any `\t<timestamp>` suffix, unquoting a
/// C-quoted path on the way.
fn strip_side(path: &str, prefix: &str) -> String {
    let path = path.split('\t').next().unwrap_or(path);
    let unquoted = unquote(path);
    if unquoted == "/dev/null" {
        return unquoted;
    }
    unquoted
        .strip_prefix(prefix)
        .map(str::to_owned)
        .unwrap_or(unquoted)
}

/// Undo git's C-style quoting of paths with unusual characters.
fn unquote(path: &str) -> String {
    let path = path.trim();
    let Some(inner) = path
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
    else {
        return path.to_owned();
    };
    let mut bytes = Vec::with_capacity(inner.len());
    let mut chars = inner.chars().peekable();
    while let Some(character) = chars.next() {
        if character != '\\' {
            let mut buffer = [0u8; 4];
            bytes.extend_from_slice(character.encode_utf8(&mut buffer).as_bytes());
            continue;
        }
        match chars.next() {
            Some('n') => bytes.push(b'\n'),
            Some('t') => bytes.push(b'\t'),
            Some('r') => bytes.push(b'\r'),
            Some('\\') => bytes.push(b'\\'),
            Some('"') => bytes.push(b'"'),
            Some(digit @ '0'..='7') => {
                let mut value = digit.to_digit(8).unwrap_or(0);
                for _ in 0..2 {
                    match chars.peek().and_then(|next| next.to_digit(8)) {
                        Some(next) => {
                            value = value * 8 + next;
                            chars.next();
                        }
                        None => break,
                    }
                }
                bytes.push(value.min(255) as u8);
            }
            Some(other) => {
                let mut buffer = [0u8; 4];
                bytes.extend_from_slice(other.encode_utf8(&mut buffer).as_bytes());
            }
            None => bytes.push(b'\\'),
        }
    }
    String::from_utf8_lossy(&bytes).into_owned()
}
