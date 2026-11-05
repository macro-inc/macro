//! Embed the canonical workspace recursively, including files added later.

use std::env;
use std::fs;
use std::io;
use std::path::{Path, PathBuf};

fn main() -> io::Result<()> {
    let manifest = PathBuf::from(
        env::var_os("CARGO_MANIFEST_DIR")
            .ok_or_else(|| io::Error::other("Cargo did not set CARGO_MANIFEST_DIR"))?,
    );
    let output = PathBuf::from(
        env::var_os("OUT_DIR").ok_or_else(|| io::Error::other("Cargo did not set OUT_DIR"))?,
    );
    let root = manifest.join("../../packages/brain/template");
    let mut files = Vec::new();
    collect(&root, &root, &mut files)?;
    files.sort();

    let mut source = String::from("&[\n");
    for (relative, absolute) in files {
        source.push_str(&format!(
            "TemplateFile {{ path: {relative:?}, contents: include_str!({absolute:?}) }},\n"
        ));
    }
    source.push_str("]\n");
    fs::write(output.join("workspace_template.rs"), source)?;
    Ok(())
}

fn collect(root: &Path, directory: &Path, files: &mut Vec<(String, String)>) -> io::Result<()> {
    // Watching directories as well as files detects additions and removals.
    println!("cargo:rerun-if-changed={}", directory.display());
    for entry in fs::read_dir(directory)? {
        let entry = entry?;
        let path = entry.path();
        let kind = entry.file_type()?;
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
            files.push((relative.replace('\\', "/"), absolute.to_owned()));
        } else {
            return Err(io::Error::other(format!(
                "template entry must be a regular file: {}",
                path.display()
            )));
        }
    }
    Ok(())
}
