//! A machine-wide cache of the registry-dependency layer of `target/debug`.
//!
//! A new worktree's first build compiles about 1,500 registry units (C build
//! scripts such as openssl-sys, ring and libwebp-sys among them) that every
//! other worktree on the machine already compiled the same way. After a build,
//! the registry units are copied into a cache entry keyed by everything that
//! decides their bytes (see [`Key`]). Before cargo runs, a target that holds
//! none of an entry's units yet gets all of them. Workspace crates are never
//! cached: their paths differ per worktree and they change on every edit.
//!
//! A seed is all or nothing because two builds of the same unit in different
//! worktrees aren't interchangeable: serde's build-script output, for one, is
//! included from the target dir, so its path is part of the crate hash. A
//! seeded crate next to a dependency built here fails with E0460 ("found
//! possibly newer version of crate"), while a graph seeded whole is consistent.
//!
//! Correctness rests on cargo, not on the key. A seeded unit carries its own
//! fingerprint, which cargo checks as it would in the worktree that built it.
//! Registry fingerprints don't depend on the workspace path, and build-script
//! outputs are rewritten to the new target dir by cargo. So a unit whose inputs
//! differ is rebuilt rather than reused. The key only decides which entry is
//! worth copying, and a changed `Cargo.lock` simply finds no entry.
//!
//! Entries are real copies (ext4 has no reflinks), so a build in a seeded
//! worktree can't write through to the cache or to another worktree.

use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command;
use std::time::SystemTime;

use anyhow::{Context, Result, bail};
use sha2::{Digest, Sha256};

#[cfg(test)]
mod test;

/// Bumped when the entry layout or the key's inputs change.
const FORMAT: u32 = 1;

/// Entries kept after a save; older ones are deleted.
const KEEP_ENTRIES: usize = 3;

/// Written last into a finished entry, so a reader never seeds from one that is
/// still being copied.
const COMPLETE_MARKER: &str = "complete";

/// Under `target/debug`: one file per cache entry seeded into or saved from it.
const SEED_MARKER_DIR: &str = ".macro-dep-cache";

/// The `target/debug` subdirectories a registry unit has files in.
const UNIT_DIRS: &[&str] = &["deps", "build", ".fingerprint"];

/// Environment that changes how registry units compile: rustc and profile
/// flags, and the C toolchain and libraries the Nix shell provides (the
/// `NIX_CC` and `PKG_CONFIG_PATH` store paths change when the shell does).
const KEY_ENV_EXACT: &[&str] = &[
    "RUSTFLAGS",
    "CARGO_ENCODED_RUSTFLAGS",
    "CARGO_BUILD_RUSTFLAGS",
    "CARGO_INCREMENTAL",
    "CC",
    "CXX",
    "CFLAGS",
    "CXXFLAGS",
    "NIX_CC",
    "PKG_CONFIG_PATH",
    "OPENSSL_NO_VENDOR",
    "AWS_LC_SYS_CMAKE_BUILDER",
];
const KEY_ENV_PREFIXES: &[&str] = &["CARGO_PROFILE_", "CARGO_TARGET_", "CFLAGS_", "CXXFLAGS_"];

/// Everything an entry is keyed by.
pub struct Key {
    pub lockfile: Vec<u8>,
    pub cargo_config: Vec<u8>,
    pub rustc_version: String,
    pub build_args: Vec<String>,
    /// `(name, value)`, sorted by name.
    pub env: Vec<(String, String)>,
}

impl Key {
    /// The key for building `build_args` in `workspace`, from the files and
    /// process environment this run sees.
    pub fn current(workspace: &Path, build_args: &[String]) -> Result<Key> {
        let lockfile = fs::read(workspace.join("Cargo.lock")).context("reading Cargo.lock")?;
        let cargo_config = fs::read(workspace.join(".cargo/config.toml")).unwrap_or_default();
        let rustc = Command::new("rustc")
            .arg("-vV")
            .output()
            .context("running `rustc -vV`")?;
        if !rustc.status.success() {
            bail!("`rustc -vV` failed");
        }
        Ok(Key {
            lockfile,
            cargo_config,
            rustc_version: String::from_utf8_lossy(&rustc.stdout).into_owned(),
            build_args: build_args.to_vec(),
            env: key_env(std::env::vars()),
        })
    }

    pub fn digest(&self) -> String {
        let mut h = Sha256::new();
        let mut field = |name: &str, bytes: &[u8]| {
            h.update(name.as_bytes());
            h.update((bytes.len() as u64).to_le_bytes());
            h.update(bytes);
        };
        field("format", &FORMAT.to_le_bytes());
        field("Cargo.lock", &self.lockfile);
        field(".cargo/config.toml", &self.cargo_config);
        field("rustc", self.rustc_version.as_bytes());
        for arg in &self.build_args {
            field("arg", arg.as_bytes());
        }
        for (name, value) in &self.env {
            field(name, value.as_bytes());
        }
        let digest = h.finalize();
        digest[..16].iter().map(|b| format!("{b:02x}")).collect()
    }
}

/// The key-relevant subset of `vars`, sorted by name.
fn key_env(vars: impl Iterator<Item = (String, String)>) -> Vec<(String, String)> {
    let mut env: Vec<(String, String)> = vars
        .filter(|(name, _)| {
            KEY_ENV_EXACT.contains(&name.as_str())
                || KEY_ENV_PREFIXES.iter().any(|p| name.starts_with(p))
        })
        .collect();
    env.sort();
    env
}

/// Where entries live: `MACRO_LOCAL_DEP_CACHE_DIR`, else the user cache dir.
/// `None` when neither it nor `HOME` is set.
pub fn root_dir() -> Option<PathBuf> {
    if let Some(dir) = std::env::var_os("MACRO_LOCAL_DEP_CACHE_DIR") {
        return Some(PathBuf::from(dir));
    }
    let cache = std::env::var_os("XDG_CACHE_HOME")
        .map(PathBuf::from)
        .or_else(|| std::env::var_os("HOME").map(|h| PathBuf::from(h).join(".cache")))?;
    Some(cache.join("macro/local-deps"))
}

/// Whether `entry` is a finished entry.
pub fn is_complete(entry: &Path) -> bool {
    entry.join(COMPLETE_MARKER).is_file()
}

/// Whether `entry` was already seeded into, or saved from, `target_debug`.
pub fn is_seeded(target_debug: &Path, entry: &Path) -> bool {
    seed_marker(target_debug, entry).is_some_and(|m| m.is_file())
}

/// Record that `target_debug` holds `entry`'s units, so later builds skip the
/// seed.
pub fn mark_seeded(target_debug: &Path, entry: &Path) -> Result<()> {
    let marker = seed_marker(target_debug, entry).context("cache entry has no name")?;
    if let Some(dir) = marker.parent() {
        fs::create_dir_all(dir).with_context(|| format!("creating {}", dir.display()))?;
    }
    fs::write(&marker, FORMAT.to_string()).with_context(|| format!("writing {}", marker.display()))
}

fn seed_marker(target_debug: &Path, entry: &Path) -> Option<PathBuf> {
    Some(target_debug.join(SEED_MARKER_DIR).join(entry.file_name()?))
}

/// What [`seed`] did.
#[derive(Debug, PartialEq, Eq)]
pub enum Seeded {
    /// Copied this many files.
    Copied(u64),
    /// Copied nothing: the target already has this many of the entry's units,
    /// built here, which seeded units can't be mixed with (see the module
    /// docs).
    Overlap(usize),
}

/// Copy every unit of a finished `entry` into `target_debug`, if the target
/// has none of them yet; otherwise copy nothing, so a worktree's own artifacts
/// are never overwritten or mixed with seeded ones.
///
/// Every copied file gets the same, current modification time, so no seeded
/// unit looks older than a file its build script watches, such as a registry
/// source unpacked after the entry was saved.
pub fn seed(entry: &Path, target_debug: &Path) -> Result<Seeded> {
    if !is_complete(entry) {
        bail!("{} is not a finished cache entry", entry.display());
    }
    let overlap = present_units(entry, target_debug)?;
    if overlap > 0 {
        return Ok(Seeded::Overlap(overlap));
    }
    let now = SystemTime::now();
    // Mark the entry used, for eviction.
    touch(&entry.join(COMPLETE_MARKER))?;
    let mut copied = 0;
    // Fingerprints last: a unit whose fingerprint is missing is rebuilt, so an
    // interrupted seed leaves units cargo rebuilds, never ones it trusts with
    // missing outputs.
    for dir in UNIT_DIRS {
        let from = entry.join(dir);
        let Ok(read) = fs::read_dir(&from) else {
            continue;
        };
        let to = target_debug.join(dir);
        fs::create_dir_all(&to).with_context(|| format!("creating {}", to.display()))?;
        for item in read {
            let item = item?;
            let dst = to.join(item.file_name());
            if item.file_type()?.is_dir() {
                copied += copy_tree(&item.path(), &dst, Mtime::Set(now))?;
            } else {
                copy_file(&item.path(), &dst, Mtime::Set(now))?;
                copied += 1;
            }
        }
    }
    Ok(Seeded::Copied(copied))
}

/// How many of `entry`'s fingerprint dirs `target_debug` already has.
fn present_units(entry: &Path, target_debug: &Path) -> Result<usize> {
    let Ok(read) = fs::read_dir(entry.join(".fingerprint")) else {
        return Ok(0);
    };
    let target = target_debug.join(".fingerprint");
    let mut present = 0;
    for item in read {
        if target.join(item?.file_name()).exists() {
            present += 1;
        }
    }
    Ok(present)
}

/// Copy the registry units of a finished build in `target_debug` into a new
/// entry at `entry`. `workspace_packages` are the package names to leave out.
/// A concurrent save of the same key keeps whichever finishes first.
pub fn save(entry: &Path, target_debug: &Path, workspace_packages: &HashSet<String>) -> Result<()> {
    let root = entry.parent().context("cache entry has no parent")?;
    fs::create_dir_all(root).with_context(|| format!("creating {}", root.display()))?;
    let name = entry
        .file_name()
        .context("cache entry has no name")?
        .to_string_lossy();
    let staging = root.join(format!(".tmp-{name}-{}", std::process::id()));
    let _ = fs::remove_dir_all(&staging);
    let result = (|| {
        for rel in registry_unit_paths(target_debug, workspace_packages)? {
            let from = target_debug.join(&rel);
            let to = staging.join(&rel);
            if from.is_dir() {
                copy_tree(&from, &to, Mtime::Keep)?;
            } else {
                if let Some(parent) = to.parent() {
                    fs::create_dir_all(parent)?;
                }
                copy_file(&from, &to, Mtime::Keep)?;
            }
        }
        fs::write(staging.join(COMPLETE_MARKER), FORMAT.to_string())?;
        Ok::<_, anyhow::Error>(())
    })();
    if let Err(err) = result {
        let _ = fs::remove_dir_all(&staging);
        return Err(err);
    }
    if fs::rename(&staging, entry).is_err() {
        // Another build saved this key first.
        let _ = fs::remove_dir_all(&staging);
        if !is_complete(entry) {
            bail!(
                "could not move {} to {}",
                staging.display(),
                entry.display()
            );
        }
    }
    Ok(())
}

/// Delete all but the `keep` most recently used entries under `root`, and
/// staging dirs a crashed save left behind more than a day ago.
pub fn evict(root: &Path, keep: usize) -> Result<()> {
    let Ok(read) = fs::read_dir(root) else {
        return Ok(());
    };
    let mut entries: Vec<(SystemTime, PathBuf)> = Vec::new();
    for item in read.flatten() {
        let path = item.path();
        let name = item.file_name().to_string_lossy().into_owned();
        if name.starts_with(".tmp-") {
            let stale = item
                .metadata()
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.elapsed().ok())
                .is_some_and(|age| age.as_secs() > 24 * 60 * 60);
            if stale {
                let _ = fs::remove_dir_all(&path);
            }
            continue;
        }
        if let Ok(used) = fs::metadata(path.join(COMPLETE_MARKER)).and_then(|m| m.modified()) {
            entries.push((used, path));
        }
    }
    entries.sort_by(|a, b| b.0.cmp(&a.0));
    for (_, path) in entries.into_iter().skip(keep) {
        fs::remove_dir_all(&path).with_context(|| format!("removing {}", path.display()))?;
    }
    Ok(())
}

/// The number of entries to keep after a save.
pub fn keep_entries() -> usize {
    KEEP_ENTRIES
}

/// Paths, relative to `target_debug`, of every file and directory belonging to
/// a unit whose package isn't in `workspace_packages`.
///
/// A unit's fingerprint and build directories are named `<package>-<hash>`.
/// Its `deps/` files are named by crate (`lib<crate>-<hash>.rlib`,
/// `<crate>-<hash>.d`) with the same hash, so they are matched by hash.
pub fn registry_unit_paths(
    target_debug: &Path,
    workspace_packages: &HashSet<String>,
) -> Result<Vec<PathBuf>> {
    let mut paths = Vec::new();
    let mut hashes = HashSet::new();
    for dir in [".fingerprint", "build"] {
        let Ok(read) = fs::read_dir(target_debug.join(dir)) else {
            continue;
        };
        for item in read.flatten() {
            let name = item.file_name().to_string_lossy().into_owned();
            let Some((package, hash)) = split_unit_dir(&name) else {
                continue;
            };
            if workspace_packages.contains(package) {
                continue;
            }
            hashes.insert(hash.to_owned());
            paths.push(Path::new(dir).join(&name));
        }
    }
    if let Ok(read) = fs::read_dir(target_debug.join("deps")) {
        for item in read.flatten() {
            let name = item.file_name().to_string_lossy().into_owned();
            if deps_file_hash(&name).is_some_and(|h| hashes.contains(h)) {
                paths.push(Path::new("deps").join(&name));
            }
        }
    }
    paths.sort();
    Ok(paths)
}

/// `("serde-json", "0123456789abcdef")` from `serde-json-0123456789abcdef`.
fn split_unit_dir(name: &str) -> Option<(&str, &str)> {
    let (package, hash) = name.rsplit_once('-')?;
    is_unit_hash(hash).then_some((package, hash))
}

/// The unit hash in a `deps/` file name such as `libserde_json-<hash>.rlib`.
fn deps_file_hash(name: &str) -> Option<&str> {
    let stem = name.split_once('.').map_or(name, |(stem, _)| stem);
    let (_, hash) = stem.rsplit_once('-')?;
    is_unit_hash(hash).then_some(hash)
}

fn is_unit_hash(s: &str) -> bool {
    s.len() == 16 && s.bytes().all(|b| b.is_ascii_hexdigit())
}

/// The modification time a copy gets.
#[derive(Clone, Copy)]
enum Mtime {
    /// The source's, so an entry records the build exactly.
    Keep,
    /// This one, for a seed (see [`seed`]).
    Set(SystemTime),
}

/// Recursively copy `from` into `to`. Returns the number of files copied.
fn copy_tree(from: &Path, to: &Path, mtime: Mtime) -> Result<u64> {
    fs::create_dir_all(to).with_context(|| format!("creating {}", to.display()))?;
    let mut copied = 0;
    for item in fs::read_dir(from).with_context(|| format!("reading {}", from.display()))? {
        let item = item?;
        let src = item.path();
        let dst = to.join(item.file_name());
        let kind = item.file_type()?;
        if kind.is_dir() {
            copied += copy_tree(&src, &dst, mtime)?;
        } else if kind.is_symlink() {
            let link = fs::read_link(&src)?;
            let _ = fs::remove_file(&dst);
            std::os::unix::fs::symlink(&link, &dst)
                .with_context(|| format!("linking {}", dst.display()))?;
        } else {
            copy_file(&src, &dst, mtime)?;
            copied += 1;
        }
    }
    Ok(copied)
}

/// Copy one file to a new inode at `to`.
fn copy_file(from: &Path, to: &Path, mtime: Mtime) -> Result<()> {
    let mtime = match mtime {
        Mtime::Set(time) => time,
        Mtime::Keep => fs::metadata(from)
            .and_then(|m| m.modified())
            .with_context(|| format!("reading {}", from.display()))?,
    };
    // Never write into an existing file: if `to` were a hard link, writing
    // would change every name for it.
    let _ = fs::remove_file(to);
    fs::copy(from, to)
        .with_context(|| format!("copying {} to {}", from.display(), to.display()))?;
    // A read-only handle: build outputs can be read-only, and the owner may set
    // a file's times without write permission.
    fs::File::open(to)
        .and_then(|f| f.set_modified(mtime))
        .with_context(|| format!("setting the mtime of {}", to.display()))
}

fn touch(path: &Path) -> Result<()> {
    fs::File::open(path)
        .and_then(|f| f.set_modified(SystemTime::now()))
        .with_context(|| format!("touching {}", path.display()))
}
