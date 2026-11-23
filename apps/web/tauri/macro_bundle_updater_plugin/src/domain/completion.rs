use std::path::{Path, PathBuf};

use rootcause::{Report, report};

/// A file an extracted bundle contains, relative to the bundle root.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleFile {
    /// Path relative to the bundle root.
    pub path: PathBuf,
    /// Size in bytes when the bundle was extracted.
    pub size: u64,
}

/// The record written beside a bundle directory once its archive is fully
/// extracted and validated.
///
/// It names the bundle build and lists every file the extraction produced, so
/// startup can tell a bundle that lost files since (to storage cleanup, for
/// example) from an intact one. The format is the build on the first line,
/// `files <count>` on the second, then one `<size> <path>` line per file.
/// Records from releases before the file list hold only the build, with no
/// newline; they still mark a completed extraction, without a list to check.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct CompletionRecord {
    pub(crate) bundle_build: u64,
    pub(crate) files: Option<Vec<BundleFile>>,
}

const FILES_PREFIX: &str = "files ";

impl CompletionRecord {
    /// Build a record listing `files`, which must be representable one per line.
    pub(crate) fn new(bundle_build: u64, files: Vec<BundleFile>) -> Result<Self, Report> {
        for file in &files {
            let Some(path) = file.path.to_str() else {
                return Err(report!("bundle file {:?} is not valid UTF-8", file.path));
            };
            if path.is_empty() || path.contains(['\n', '\r']) {
                return Err(report!("bundle file {path:?} cannot be recorded"));
            }
        }
        Ok(Self {
            bundle_build,
            files: Some(files),
        })
    }

    /// Render the record in its on-disk format.
    pub(crate) fn render(&self) -> String {
        let mut out = format!("{}\n", self.bundle_build);
        if let Some(files) = &self.files {
            out.push_str(&format!("{FILES_PREFIX}{}\n", files.len()));
            for file in files {
                out.push_str(&format!("{} {}\n", file.size, file.path.display()));
            }
        }
        out
    }

    /// Parse a record, returning `None` when it is malformed or truncated.
    pub(crate) fn parse(contents: &str) -> Option<Self> {
        // Older releases wrote the build alone, without a newline. A record
        // that ends after its build line is one cut short while it was written.
        let Some(listed) = contents.strip_suffix('\n') else {
            return Some(Self {
                bundle_build: contents.parse().ok()?,
                files: None,
            });
        };
        let mut lines = listed.split('\n');
        let bundle_build = lines.next()?.parse().ok()?;

        // The count guards against a record cut short while it was written:
        // a shorter list would leave the missing files unchecked.
        let count: usize = lines.next()?.strip_prefix(FILES_PREFIX)?.parse().ok()?;
        let mut files = Vec::new();
        for line in lines {
            let (size, path) = line.split_once(' ')?;
            if path.is_empty() {
                return None;
            }
            files.push(BundleFile {
                path: Path::new(path).to_path_buf(),
                size: size.parse().ok()?,
            });
        }
        if files.len() != count {
            return None;
        }

        Some(Self {
            bundle_build,
            files: Some(files),
        })
    }
}

#[cfg(test)]
mod test;
