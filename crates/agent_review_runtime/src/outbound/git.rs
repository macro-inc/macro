// Adapted from 404Wolf/diffd 91a5e3e7719d717c2cd1b6238e146023e8afb1df.
// Copyright (c) 2026 Wolf Mermelstein. MIT; see ../../LICENSE.
//! Reading repositories with the `git` CLI, so worktrees, sparse checkouts and
//! config behave exactly as they do in the user's shell.

use std::io::{BufRead, BufReader, Read, Write};
use std::path::Path;
use std::process::{Child, ChildStdin, ChildStdout, Command, Stdio};

use anyhow::{Context, bail};
use diffd_core::build::FileInput;
use diffd_core::model::{FileStatus, Omitted};
use diffd_core::text::{invisible_changes, looks_binary};

use crate::domain::ports::{Contents, MAX_FILE_BYTES, Repo, RepoSource, Resolved};

pub struct GitCli;

/// git's id for the empty tree: the base of a repository with no commits yet.
const EMPTY_TREE: &str = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

fn git(root: &Path, args: &[&str]) -> anyhow::Result<String> {
    let out = Command::new("git")
        .arg("-C")
        .arg(root)
        .args(args)
        .output()
        .context("running git (is it installed?)")?;
    if !out.status.success() {
        bail!(
            "git {}: {}",
            args.join(" "),
            String::from_utf8_lossy(&out.stderr).trim()
        );
    }
    Ok(String::from_utf8_lossy(&out.stdout).into_owned())
}

impl RepoSource for GitCli {
    fn open(&self, path: &Path) -> anyhow::Result<Repo> {
        let root = git(path, &["rev-parse", "--show-toplevel"])
            .with_context(|| format!("{} is not inside a git repository", path.display()))?;
        let root = std::path::PathBuf::from(root.trim());
        let name = root
            .file_name()
            .map(|n| n.to_string_lossy().into_owned())
            .unwrap_or_default();
        Ok(Repo { root, name })
    }

    fn resolve(&self, repo: &Repo, from: &str, to: Option<&str>) -> anyhow::Result<Resolved> {
        let commit = |rev: &str| -> anyhow::Result<String> {
            if rev == EMPTY_TREE {
                return Ok(EMPTY_TREE.to_owned());
            }
            git(
                &repo.root,
                &[
                    "rev-parse",
                    "--verify",
                    "--quiet",
                    "--end-of-options",
                    &format!("{rev}^{{commit}}"),
                ],
            )
            .map(|s| s.trim().to_owned())
            .with_context(|| format!("unknown revision `{rev}`"))
        };
        // Before the first commit there's nothing to compare with but the empty tree.
        if from == "HEAD" && to.is_none() && commit("HEAD").is_err() {
            return Ok(Resolved {
                base: EMPTY_TREE.to_owned(),
                to: None,
            });
        }
        let to_commit = to.map(commit).transpose()?;
        // Only a branch name compares from where it forked; `HEAD`, tags and commits compare directly.
        let is_branch = ["refs/heads/", "refs/remotes/"].iter().any(|prefix| {
            let full = if from.starts_with(prefix) {
                from.to_owned()
            } else {
                format!("{prefix}{from}")
            };
            git(&repo.root, &["show-ref", "--verify", "--quiet", &full]).is_ok()
        });
        let base = if is_branch {
            let other = to_commit.clone().unwrap_or_else(|| "HEAD".to_owned());
            git(
                &repo.root,
                &["merge-base", "--end-of-options", from, &other],
            )
            .map(|s| s.trim().to_owned())
            .with_context(|| format!("`{from}` and `{other}` have no common history"))?
        } else {
            commit(from)?
        };
        Ok(Resolved {
            base,
            to: to_commit,
        })
    }

    fn changes(&self, repo: &Repo, resolved: &Resolved) -> anyhow::Result<Vec<FileInput>> {
        // --raw gives each side's blob id, so contents are read by id: paths
        // (which can hold spaces or even newlines) never go through cat-file.
        let mut args = vec![
            "diff",
            "--raw",
            "--no-abbrev",
            "-z",
            "-M",
            "--no-ext-diff",
            resolved.base.as_str(),
        ];
        if let Some(to) = &resolved.to {
            args.push(to);
        }
        args.push("--");
        let mut entries = parse_raw(&git(&repo.root, &args)?);

        if resolved.to.is_none() {
            let args = vec!["ls-files", "--others", "--exclude-standard", "-z", "--"];
            for path in git(&repo.root, &args)?
                .split('\0')
                .filter(|p| !p.is_empty())
            {
                entries.push(Entry {
                    path: path.to_owned(),
                    ..Entry::added()
                });
            }
        }
        entries.sort_by(|a, b| tree_order(&a.path, &b.path));

        let mut cat = CatFile::spawn(&repo.root)?;
        anyhow::ensure!(
            entries.len() <= 10_000,
            "comparison contains too many files"
        );
        let mut inputs = Vec::with_capacity(entries.len());
        let mut total_bytes = 0usize;
        for e in entries {
            let old = match &e.old_blob {
                Some(id) => cat.read_blob(id)?,
                None => None,
            };
            let new = match (&resolved.to, &e.new_blob) {
                (Some(_), Some(id)) => cat.read_blob(id)?,
                (Some(_), None) => None,
                // The working tree: read the file itself (for a deleted file, nothing). The id
                // git prints for it can be a hash of its contents that was never stored.
                (None, _) if e.status == FileStatus::Deleted || e.submodule => None,
                (None, _) => read_worktree(&repo.root.join(&e.path))?,
            };
            let mut input = to_input(e, old, new);
            let bytes = input.old.as_ref().map_or(0, String::len)
                + input.new.as_ref().map_or(0, String::len);
            if total_bytes + bytes > 64 * 1024 * 1024 {
                input.old = None;
                input.new = None;
                input.omitted = Some(Omitted::TooLarge);
            } else {
                total_bytes += bytes;
            }
            inputs.push(input);
        }
        Ok(inputs)
    }
}

/// Order paths the way the file tree shows them: at each level, folders
/// before files, then by name.
fn tree_order(a: &str, b: &str) -> std::cmp::Ordering {
    let (mut pa, mut pb) = (a.split('/').peekable(), b.split('/').peekable());
    loop {
        match (pa.next(), pb.next()) {
            (Some(x), Some(y)) => {
                let (x_dir, y_dir) = (pa.peek().is_some(), pb.peek().is_some());
                if x_dir != y_dir {
                    return y_dir.cmp(&x_dir);
                }
                match x.cmp(y) {
                    std::cmp::Ordering::Equal => continue,
                    other => return other,
                }
            }
            (None, Some(_)) => return std::cmp::Ordering::Less,
            (Some(_), None) => return std::cmp::Ordering::Greater,
            (None, None) => return std::cmp::Ordering::Equal,
        }
    }
}

struct Entry {
    status: FileStatus,
    old_path: Option<String>,
    path: String,
    /// Blob ids; `None` when that side doesn't exist (or, sometimes, is the working tree).
    old_blob: Option<String>,
    new_blob: Option<String>,
    /// What the rows can't show: mode changes, a submodule's commits.
    details: Vec<String>,
    submodule: bool,
}

impl Entry {
    /// An untracked file.
    fn added() -> Self {
        Self {
            status: FileStatus::Added,
            old_path: None,
            path: String::new(),
            old_blob: None,
            new_blob: None,
            details: Vec::new(),
            submodule: false,
        }
    }
}

const SUBMODULE: &str = "160000";
const SYMLINK: &str = "120000";
const ABSENT: &str = "000000";

/// A mode change, in words: "mode 100644 → 100755", or "symlink → file".
fn mode_change(old: &str, new: &str) -> Option<String> {
    let kind = |m: &str| match m {
        SYMLINK => "symlink",
        SUBMODULE => "submodule",
        _ => "file",
    };
    if old == new || old == ABSENT || new == ABSENT {
        None
    } else if kind(old) != kind(new) {
        Some(format!("{} → {}", kind(old), kind(new)))
    } else {
        Some(format!("mode {old} → {new}"))
    }
}

/// A submodule's commits, in words.
fn submodule_change(old: Option<&str>, new: Option<&str>) -> String {
    let short = |id: &str| id.chars().take(10).collect::<String>();
    match (old, new) {
        (Some(a), Some(b)) => format!("submodule {} → {}", short(a), short(b)),
        (None, Some(b)) => format!("submodule at {}", short(b)),
        (Some(a), None) => format!("submodule was at {}", short(a)),
        (None, None) => "submodule changed".to_owned(),
    }
}

/// Parse `git diff --raw -z --no-abbrev`: `:mode mode id id status\0path\0[path\0]`.
fn parse_raw(out: &str) -> Vec<Entry> {
    let mut parts = out.split('\0');
    let mut entries = Vec::new();
    while let Some(meta) = parts.next() {
        let Some(meta) = meta.strip_prefix(':') else {
            continue;
        };
        let fields: Vec<&str> = meta.split(' ').collect();
        let [old_mode, new_mode, old_id, new_id, code] = fields.as_slice() else {
            continue;
        };
        let Some(first) = parts.next() else { break };
        // All zeros: that side doesn't exist, or it's the working tree.
        let blob = |id: &str| (!id.bytes().all(|b| b == b'0')).then(|| id.to_owned());
        let (old_blob, new_blob) = (blob(old_id), blob(new_id));
        // A submodule is a commit, not a blob: it has no contents to show.
        let submodule = *old_mode == SUBMODULE || *new_mode == SUBMODULE;
        let mut details: Vec<String> = mode_change(old_mode, new_mode).into_iter().collect();
        if submodule {
            let side =
                |mode: &str, id: &Option<String>| if mode == SUBMODULE { id.clone() } else { None };
            details.push(submodule_change(
                side(old_mode, &old_blob).as_deref(),
                side(new_mode, &new_blob).as_deref(),
            ));
        }
        let (status, old_path, path) = match code.as_bytes().first() {
            Some(b'R' | b'C') => {
                let Some(second) = parts.next() else { break };
                let status = if code.starts_with('R') {
                    FileStatus::Renamed
                } else {
                    FileStatus::Added
                };
                (status, Some(first.to_owned()), second.to_owned())
            }
            Some(b'A') => (FileStatus::Added, None, first.to_owned()),
            Some(b'D') => (FileStatus::Deleted, None, first.to_owned()),
            _ => (FileStatus::Modified, None, first.to_owned()),
        };
        let (old_blob, new_blob) = if submodule {
            (None, None)
        } else {
            (old_blob, new_blob)
        };
        entries.push(Entry {
            status,
            old_path,
            path,
            old_blob,
            new_blob,
            details,
            submodule,
        });
    }
    entries
}

/// A file in the working tree, as git sees it: a symlink is its target's path
/// (never followed out of the repository), a directory (a submodule) has no contents.
/// Reads at most [`MAX_FILE_BYTES`] plus one byte to detect oversized contents.
fn read_worktree(path: &Path) -> anyhow::Result<Option<Contents>> {
    let meta = match std::fs::symlink_metadata(path) {
        Ok(meta) => meta,
        // Deleted since git listed it: nothing to show.
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => return Ok(None),
        Err(e) => return Err(anyhow::Error::new(e).context(format!("reading {}", path.display()))),
    };
    if meta.is_symlink() {
        let target = std::fs::read_link(path)?;
        return Ok(Some(Contents::Bytes(
            target.to_string_lossy().into_owned().into_bytes(),
        )));
    }
    if !meta.is_file() {
        return Ok(None);
    }
    if meta.len() > MAX_FILE_BYTES {
        return Ok(Some(Contents::TooLarge));
    }
    match std::fs::File::open(path).and_then(read_contents) {
        Ok(contents) => Ok(Some(contents)),
        Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(None),
        Err(e) => Err(anyhow::Error::new(e).context(format!("reading {}", path.display()))),
    }
}

fn read_contents(reader: impl Read) -> std::io::Result<Contents> {
    // A workspace file can grow after metadata is read. Bound the read itself,
    // with one extra byte to distinguish an exact-limit file from an oversized one.
    let mut bytes = Vec::new();
    reader.take(MAX_FILE_BYTES + 1).read_to_end(&mut bytes)?;
    Ok(if bytes.len() as u64 > MAX_FILE_BYTES {
        Contents::TooLarge
    } else {
        Contents::Bytes(bytes)
    })
}

fn to_input(e: Entry, old: Option<Contents>, new: Option<Contents>) -> FileInput {
    let too_large =
        matches!(old, Some(Contents::TooLarge)) || matches!(new, Some(Contents::TooLarge));
    let bytes = |c: Option<Contents>| match c? {
        Contents::Bytes(b) => Some(b),
        // Too large: the side exists, but its contents aren't read.
        Contents::TooLarge => Some(Vec::new()),
    };
    let (old, new) = (bytes(old), bytes(new));
    let omitted = if e.submodule {
        Some(Omitted::Submodule)
    } else if too_large {
        Some(Omitted::TooLarge)
    } else if [&old, &new]
        .iter()
        .any(|c| c.as_ref().is_some_and(|c| looks_binary(c)))
    {
        Some(Omitted::Binary)
    } else {
        None
    };
    let mut details = e.details;
    if omitted.is_none()
        && let (Some(a), Some(b)) = (&old, &new)
    {
        details.extend(invisible_changes(a, b));
    }
    let text = |c: Option<Vec<u8>>| {
        if omitted.is_some() {
            c.map(|_| String::new())
        } else {
            c.map(|c| String::from_utf8_lossy(&c).into_owned())
        }
    };
    // A copy (C) is reported as added with its source; keep the source as old_path only for renames.
    let old_path = if e.status == FileStatus::Renamed {
        e.old_path
    } else {
        None
    };
    let status = if e.status == FileStatus::Added && old.is_some() {
        FileStatus::Modified
    } else {
        e.status
    };
    FileInput {
        path: e.path,
        old_path,
        status,
        old: if status == FileStatus::Added {
            None
        } else {
            text(old)
        },
        new: text(new),
        omitted,
        details,
        collapsed: None,
    }
}

/// A long-running `git cat-file --batch`, so reading N blobs costs one process.
struct CatFile {
    child: Child,
    stdin: ChildStdin,
    stdout: BufReader<ChildStdout>,
}

impl CatFile {
    fn spawn(root: &Path) -> anyhow::Result<Self> {
        let mut child = Command::new("git")
            .arg("-C")
            .arg(root)
            .args(["cat-file", "--batch"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .spawn()
            .context("running git cat-file")?;
        let stdin = child.stdin.take().context("git cat-file stdin")?;
        let stdout = BufReader::new(child.stdout.take().context("git cat-file stdout")?);
        Ok(Self {
            child,
            stdin,
            stdout,
        })
    }

    /// A blob by id (hex, so no quoting issues). Blobs over [`MAX_FILE_BYTES`]
    /// are skipped over in the stream, never held in memory.
    fn read_blob(&mut self, id: &str) -> anyhow::Result<Option<Contents>> {
        writeln!(self.stdin, "{id}")?;
        self.stdin.flush()?;
        let mut header = String::new();
        self.stdout.read_line(&mut header)?;
        let fields: Vec<&str> = header.split_whitespace().collect();
        match fields.as_slice() {
            [_, "missing"] | [_, "ambiguous"] => Ok(None),
            [_, kind, size] => {
                let size: u64 = size.parse().context("git cat-file size")?;
                // The object, then a newline.
                if size > MAX_FILE_BYTES || *kind != "blob" {
                    std::io::copy(&mut (&mut self.stdout).take(size + 1), &mut std::io::sink())?;
                    return Ok((*kind == "blob").then_some(Contents::TooLarge));
                }
                let mut buf = vec![0; size as usize + 1];
                self.stdout.read_exact(&mut buf)?;
                buf.pop();
                Ok(Some(Contents::Bytes(buf)))
            }
            _ => bail!("unexpected git cat-file output: {header:?}"),
        }
    }
}

impl Drop for CatFile {
    fn drop(&mut self) {
        let _ = self.child.kill();
        let _ = self.child.wait();
    }
}

#[cfg(test)]
mod test;
