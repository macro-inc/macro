//! Embed the starter agent recursively, including files added later, minus
//! what only exists in the monorepo checkout (installs, scratch scripts, the
//! workspace Biome config).

use std::env;
use std::fs;
use std::io;
use std::os::unix::fs::PermissionsExt;
use std::path::{Path, PathBuf};

fn main() -> io::Result<()> {
    let manifest = PathBuf::from(
        env::var_os("CARGO_MANIFEST_DIR")
            .ok_or_else(|| io::Error::other("Cargo did not set CARGO_MANIFEST_DIR"))?,
    );
    let output = PathBuf::from(
        env::var_os("OUT_DIR").ok_or_else(|| io::Error::other("Cargo did not set OUT_DIR"))?,
    );
    let root = manifest.join("../../packages/starter-agent");
    let mut files = Vec::new();
    collect(&root, &root, &mut files)?;
    files.sort();

    let mut source = String::from("&[\n");
    for (relative, absolute, executable) in files {
        source.push_str(&format!(
            "TemplateFile {{ path: {relative:?}, contents: include_str!({absolute:?}), executable: {executable} }},\n"
        ));
    }
    source.push_str("]\n");
    fs::write(output.join("workspace_template.rs"), source)?;
    Ok(())
}

fn collect(
    root: &Path,
    directory: &Path,
    files: &mut Vec<(String, String, bool)>,
) -> io::Result<()> {
    // Watching directories as well as files detects additions and removals.
    println!("cargo:rerun-if-changed={}", directory.display());
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        if skipped(&entry.file_name().to_string_lossy()) {
            continue;
        }
        // `CLAUDE.md` is a symlink to `AGENTS.md`; the repo gets its contents.
        let metadata = fs::metadata(&path)?;
        let kind = metadata.file_type();
        if kind.is_dir() {
            collect(root, &path, files)?;
        } else if kind.is_file() {
            let relative = path
                .strip_prefix(root)
                .map_err(io::Error::other)?
                .to_str()
                .ok_or_else(|| io::Error::other("non-UTF-8 template path"))?;
            let absolute = path
                .to_str()
                .ok_or_else(|| io::Error::other("non-UTF-8 template path"))?;
            files.push((
                relative.replace('\\', "/"),
                absolute.to_owned(),
                metadata.permissions().mode() & 0o111 != 0,
            ));
        } else {
            return Err(io::Error::other(format!(
                "template entry must be a regular file: {}",
                path.display()
            )));
        }
    }
    Ok(())
}

/// Entries of the monorepo checkout that are not part of an agent's repo.
fn skipped(name: &str) -> bool {
    matches!(name, "node_modules" | ".worktrees" | ".direnv" | "biome.jsonc")
        || name.starts_with(".scripts")
        || name.ends_with(".tsbuildinfo")
}
