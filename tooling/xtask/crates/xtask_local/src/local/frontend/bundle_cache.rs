//! A machine-wide cache of static frontend bundles, keyed by everything the
//! Vite build reads: the frontend sources as they are on disk (tracked,
//! modified, and untracked files alike), the gitignored wasm packages, and the
//! build's environment. A stack whose frontend hasn't changed since any
//! checkout on the machine last built it stages that bundle instead of
//! spending a minute or more in `vite build`.

use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::process::Command;

use anyhow::{Context, Result};
use sha2::{Digest, Sha256};

use crate::local::content_key;

/// Bump when the key's inputs or the entry layout change.
/// 2: `vendor/ironcalc/pkg` joined the inputs.
const FORMAT: u32 = 2;

/// The repository paths the bundle is built from, relative to the repo root.
const INPUTS: &[&str] = &[
    "apps/web",
    "packages",
    // The `@ironcalc/wasm` workspace package the spreadsheet imports.
    "vendor/ironcalc/pkg",
    "static_assets",
    "package.json",
    "bun.lock",
    "bunfig.toml",
];

/// Environment variables the Vite config reads, besides every `VITE_*` one
/// (Vite inlines those into the bundle).
const BUILD_ENV: &[&str] = &[
    "MODE",
    "NODE_ENV",
    "NO_MINIFY",
    "LOCAL_DOCKER",
    "LOCAL_JWT",
    "LOCAL_BACKEND",
];

/// Entries unused for this long are removed when a new one is stored.
const UNUSED_DAYS: u64 = 3;

/// At most this many entries are kept (each is about 240MB).
const MAX_ENTRIES: usize = 8;

/// Where cached bundles live, one directory per key.
pub fn root_dir() -> Result<PathBuf> {
    let home = macro_env_var::maybe_read_env("HOME").context("HOME is not set")?;
    Ok(PathBuf::from(home).join(".cache/macro-local/frontend-bundles"))
}

/// The key for a bundle built in `repo` by `build`: the command's own env
/// overrides plus the matching process env, and the inputs' content.
pub fn key(repo: &Path, build: &Command) -> Result<String> {
    // `vars_os`: `vars` panics on any variable that isn't valid Unicode.
    let relevant = |name: &std::ffi::OsStr| {
        let name = name.to_string_lossy();
        name.starts_with("VITE_") || BUILD_ENV.contains(&name.as_ref())
    };
    let mut env: BTreeMap<std::ffi::OsString, std::ffi::OsString> = std::env::vars_os()
        .filter(|(name, _)| relevant(name))
        .collect();
    for (name, value) in build.get_envs() {
        match value {
            Some(value) => env.insert(name.to_owned(), value.to_owned()),
            None => env.remove(name),
        };
    }

    let mut h = Sha256::new();
    h.update(FORMAT.to_le_bytes());
    h.update(build.get_program().as_encoded_bytes());
    for arg in build.get_args() {
        h.update([0]);
        h.update(arg.as_encoded_bytes());
    }
    for (name, value) in &env {
        h.update(b"\0");
        h.update(name.as_encoded_bytes());
        h.update(b"=");
        h.update(value.as_encoded_bytes());
    }
    h.update(content_key::tracked(repo, INPUTS)?);
    for path in ignored_inputs(repo)? {
        let bytes = std::fs::read(repo.join(&path)).with_context(|| format!("reading {path}"))?;
        h.update(format!("\0{path}\0{}\0", bytes.len()).as_bytes());
        h.update(&bytes);
    }
    Ok(content_key::hex(&h.finalize()))
}

/// Gitignored files the build reads: the generated wasm packages and local
/// `.env` files. `node_modules` (pinned by `bun.lock`) and the build's own
/// output are left out.
fn ignored_inputs(repo: &Path) -> Result<Vec<String>> {
    let mut args = vec![
        "ls-files",
        "-z",
        "-o",
        "-i",
        "--exclude-standard",
        "--directory",
        "--",
    ];
    args.extend(INPUTS);
    let listed = content_key::git(repo, &args, None)?;
    let mut files = Vec::new();
    for entry in listed
        .split(|byte| *byte == 0)
        .filter(|entry| !entry.is_empty())
    {
        let entry = String::from_utf8_lossy(entry)
            .trim_end_matches('/')
            .to_string();
        let skipped = entry.split('/').any(|part| part == "node_modules")
            || entry == "apps/web/dist"
            || entry.starts_with("apps/web/dist/");
        if !skipped {
            collect_files(repo, &entry, &mut files)?;
        }
    }
    files.sort();
    files.dedup();
    Ok(files)
}

fn collect_files(repo: &Path, rel: &str, out: &mut Vec<String>) -> Result<()> {
    let path = repo.join(rel);
    if !path.is_dir() {
        out.push(rel.to_string());
        return Ok(());
    }
    for entry in std::fs::read_dir(&path).with_context(|| format!("reading {}", path.display()))? {
        let name = entry?.file_name().to_string_lossy().into_owned();
        collect_files(repo, &format!("{rel}/{name}"), out)?;
    }
    Ok(())
}

/// The cached bundle for `key`, if one is stored, with the read lock that
/// keeps it from being pruned until the caller has staged it.
pub fn lookup(key: &str) -> Result<Option<(PathBuf, std::fs::File)>> {
    let entry = root_dir()?.join(key);
    if !entry.join("index.html").exists() {
        return Ok(None);
    }
    let reading =
        content_key::read_lock(&entry).with_context(|| format!("locking {}", entry.display()))?;
    if !entry.join("index.html").exists() {
        return Ok(None);
    }
    let _ = std::fs::File::options()
        .append(true)
        .open(entry.join("index.html"))
        .and_then(|file| file.set_modified(std::time::SystemTime::now()));
    Ok(Some((entry, reading)))
}

/// Store a finished build under `key`, then drop old entries. Another checkout
/// may store the same key at the same time; the first complete one is kept.
pub fn store(key: &str, dist: &Path) -> Result<PathBuf> {
    let root = root_dir()?;
    let entry = root.join(key);
    let tmp = root.join(format!(".tmp-{key}-{}", std::process::id()));
    if tmp.exists() {
        std::fs::remove_dir_all(&tmp)?;
    }
    std::fs::create_dir_all(&root).with_context(|| format!("creating {}", root.display()))?;
    // A real copy: `dist/` is a build directory something may write into again,
    // and an entry must never change under a stack that serves it.
    let status = Command::new("cp")
        .arg("-a")
        .arg(dist)
        .arg(&tmp)
        .status()
        .context("running cp -a")?;
    anyhow::ensure!(status.success(), "cp -a exited with {status}");
    content_key::install_entry(&tmp, &entry, |entry| entry.join("index.html").exists())
        .context("moving the bundle into the cache")?;
    prune(&root, key);
    Ok(entry)
}

/// Stage a cached bundle, hard-linking its files where the filesystem allows.
/// Neither the entry nor the staged copy is ever written, so links are safe
/// and make staging a 240MB bundle nearly free.
pub fn copy_tree(from: &Path, to: &Path) -> Result<()> {
    let linked = Command::new("cp")
        .arg("-al")
        .arg(from)
        .arg(to)
        .output()
        .context("running cp -al")?;
    if linked.status.success() {
        return Ok(());
    }
    let _ = std::fs::remove_dir_all(to);
    let status = Command::new("cp")
        .arg("-a")
        .arg(from)
        .arg(to)
        .status()
        .context("running cp -a")?;
    anyhow::ensure!(status.success(), "cp -a exited with {status}");
    Ok(())
}

/// When an entry was last used: its `index.html`'s mtime, or the directory's
/// own for one without it (the temp dir of a store that crashed).
fn last_used(entry: &Path) -> Option<std::time::SystemTime> {
    std::fs::metadata(entry.join("index.html"))
        .or_else(|_| std::fs::metadata(entry))
        .and_then(|meta| meta.modified())
        .ok()
}

/// Remove entries unused for [`UNUSED_DAYS`], then the least recently used
/// beyond [`MAX_ENTRIES`]. Best effort: a failure only leaves disk in use.
fn prune(root: &Path, keep: &str) {
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    let mut used: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .filter(|entry| entry.file_name() != keep)
        // Entries are directories; their install locks sit beside them.
        .filter(|entry| entry.file_type().is_ok_and(|kind| kind.is_dir()))
        .filter_map(|entry| {
            let path = entry.path();
            Some((last_used(&path)?, path))
        })
        .collect();
    used.sort_by(|a, b| b.0.cmp(&a.0));
    let max_age = std::time::Duration::from_secs(UNUSED_DAYS * 24 * 60 * 60);
    for (index, (modified, path)) in used.iter().enumerate() {
        let old = modified.elapsed().is_ok_and(|age| age > max_age);
        if old || index + 1 >= MAX_ENTRIES {
            // Unless someone used it since it was listed.
            content_key::prune_entry(path, |path| {
                last_used(path).is_some_and(|now| now == *modified)
            });
        }
    }
}

#[cfg(test)]
mod test;
