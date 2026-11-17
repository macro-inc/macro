//! Checks that a vendored crate with its local feature off compiles from the
//! same Rust tokens and manifest as the upstream release it was copied from.
//!
//! Every upstream `.rs` file must exist in the vendor copy and, after the
//! vendor copy drops what the disabled feature compiles out (`strip`), parse
//! to the identical token stream. Comments and formatting are not compiled and
//! are not compared. Vendor-only files compile only if a surviving `mod`
//! declares them, which the token comparison would report. The manifest must
//! match upstream except for the declared local differences.
//!
//! Usage: `xtask_loro_vendor <upstream-dir> <vendor-dir> --feature <name>`;
//! `tooling/scripts/check-loro-editor-vendor.sh` downloads and verifies the
//! upstream release.

mod strip;
#[cfg(test)]
mod test;

use clap::Parser;
use quote::ToTokens;
use rootcause::prelude::ResultExt;
use rootcause::{Report, bail};
use std::path::{Path, PathBuf};

#[derive(Parser)]
struct Args {
    /// The unpacked upstream crate.
    upstream: PathBuf,
    /// The vendored copy.
    vendor: PathBuf,
    /// The vendor-only feature, compared disabled.
    #[arg(long)]
    feature: String,
}

/// Manifest keys the vendor copy may add (with the feature or for its own
/// tests) or drop (optional author metadata); see vendor/loro-editor/README.md.
const VENDOR_ONLY_KEYS: &[&[&str]] = &[&["dev-dependencies", "dev-utils"]];
const UPSTREAM_ONLY_KEYS: &[&[&str]] = &[&["package", "authors"]];

fn main() -> Result<(), Report> {
    let args = Args::parse();
    let mut drift = Vec::new();
    let mut files = 0usize;
    for path in rust_files(&args.upstream)? {
        let relative = path.strip_prefix(&args.upstream).context("upstream path")?;
        files += 1;
        if let Some(difference) = compare_rust(&path, &args.vendor.join(relative), &args.feature)? {
            drift.push(format!("{}: {difference}", relative.display()));
        }
    }
    if let Some(difference) = compare_manifest(&args.upstream, &args.vendor, &args.feature)? {
        drift.push(format!("Cargo.toml: {difference}"));
    }
    if !drift.is_empty() {
        for line in &drift {
            eprintln!("{line}");
        }
        bail!(
            "{} differs from {} with `{}` off",
            args.vendor.display(),
            args.upstream.display(),
            args.feature
        );
    }
    println!(
        "{} upstream Rust files and Cargo.toml match {} with `{}` off",
        files,
        args.vendor.display(),
        args.feature
    );
    Ok(())
}

fn rust_files(root: &Path) -> Result<Vec<PathBuf>, Report> {
    let mut files = Vec::new();
    let mut directories = vec![root.to_path_buf()];
    while let Some(directory) = directories.pop() {
        for entry in
            std::fs::read_dir(&directory).attach_with(|| format!("read {}", directory.display()))?
        {
            let path = entry.context("directory entry")?.path();
            if path.is_dir() {
                directories.push(path);
            } else if path.extension().is_some_and(|extension| extension == "rs") {
                files.push(path);
            }
        }
    }
    files.sort();
    Ok(files)
}

fn parse(path: &Path) -> Result<syn::File, Report> {
    let source =
        std::fs::read_to_string(path).attach_with(|| format!("read {}", path.display()))?;
    Ok(syn::parse_file(&source).attach_with(|| format!("parse {}", path.display()))?)
}

/// The first token difference, or None when the stripped vendor file matches.
fn compare_rust(upstream: &Path, vendor: &Path, feature: &str) -> Result<Option<String>, Report> {
    if !vendor.exists() {
        return Ok(Some("missing from the vendor copy".into()));
    }
    let expected = parse(upstream)?.into_token_stream().to_string();
    let mut stripped = parse(vendor)?;
    strip::strip_disabled(&mut stripped, feature)
        .attach_with(|| format!("evaluate cfg in {}", vendor.display()))?;
    let actual = stripped.into_token_stream().to_string();
    if actual.contains(&format!("\"{feature}\"")) {
        return Ok(Some(format!(
            "`{feature}` survives stripping; gate whole items, statements, fields or arms"
        )));
    }
    Ok(token_difference(&expected, &actual))
}

/// None only when both token streams print identically, literals included;
/// otherwise where they differ, located by whitespace-separated tokens.
fn token_difference(expected: &str, actual: &str) -> Option<String> {
    if expected == actual {
        return None;
    }
    Some(
        first_difference(expected, actual).unwrap_or_else(|| {
            "differs only inside a token, such as whitespace in a literal".into()
        }),
    )
}

fn first_difference(expected: &str, actual: &str) -> Option<String> {
    let expected: Vec<&str> = expected.split_whitespace().collect();
    let actual: Vec<&str> = actual.split_whitespace().collect();
    let at = expected
        .iter()
        .zip(&actual)
        .position(|(left, right)| left != right)
        .or_else(|| (expected.len() != actual.len()).then(|| expected.len().min(actual.len())))?;
    let window = |tokens: &[&str]| {
        let start = at.saturating_sub(12);
        tokens[start..tokens.len().min(at + 12)].join(" ")
    };
    Some(format!(
        "token {at} differs\n  upstream: {}\n  vendor:   {}",
        window(&expected),
        window(&actual)
    ))
}

fn compare_manifest(
    upstream: &Path,
    vendor: &Path,
    feature: &str,
) -> Result<Option<String>, Report> {
    let read = |root: &Path| -> Result<toml::Table, Report> {
        let path = root.join("Cargo.toml");
        let text =
            std::fs::read_to_string(&path).attach_with(|| format!("read {}", path.display()))?;
        Ok(text
            .parse::<toml::Table>()
            .attach_with(|| format!("parse {}", path.display()))?)
    };
    let mut expected = read(upstream)?;
    let mut actual = read(vendor)?;
    for key in UPSTREAM_ONLY_KEYS {
        remove(&mut expected, key);
    }
    for key in VENDOR_ONLY_KEYS {
        remove(&mut actual, key);
    }
    if !remove(&mut actual, &["features", feature]) {
        return Ok(Some(format!("declares no `{feature}` feature")));
    }
    Ok((expected != actual).then(|| {
        format!(
            "differs beyond the declared local keys\n--- upstream\n{expected}\n--- vendor\n{actual}"
        )
    }))
}

/// Removes a nested key; true when it was present. Drops a table it empties.
fn remove(table: &mut toml::Table, key: &[&str]) -> bool {
    match key {
        [] => false,
        [last] => table.remove(*last).is_some(),
        [first, rest @ ..] => {
            let Some(toml::Value::Table(inner)) = table.get_mut(*first) else {
                return false;
            };
            let removed = remove(inner, rest);
            if inner.is_empty() {
                table.remove(*first);
            }
            removed
        }
    }
}
