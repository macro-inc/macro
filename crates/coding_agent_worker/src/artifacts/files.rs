//! Reading an artifact's files out of the workspace.
//!
//! Every file must resolve, symlinks followed, to somewhere inside the
//! workspace root: the agent names paths, and a path or link pointing out of
//! the workspace would publish whatever it points at.

use std::path::{Component, Path, PathBuf};

use sha2::{Digest, Sha256};

#[cfg(test)]
mod test;

/// Macro's limits on one version, checked here so the agent hears which file
/// broke them before anything is sent.
pub(crate) const MAX_FILES: usize = 255;
pub(crate) const MAX_FILE_BYTES: u64 = 16 * 1024 * 1024;
pub(crate) const MAX_VERSION_BYTES: u64 = 64 * 1024 * 1024;
const MAX_PATH_CHARS: usize = 512;

/// The page every artifact opens on.
const INDEX: &str = "index.html";

/// One file of an artifact, read and hashed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct LocalFile {
    /// Its path inside the artifact: relative, `/`-separated.
    pub(crate) path: String,
    pub(crate) content_type: &'static str,
    /// Lowercase hex SHA-256 of `bytes`.
    pub(crate) sha256: String,
    pub(crate) bytes: Vec<u8>,
}

/// Why the files could not be gathered. Each names the offending path, which
/// is the agent's own input.
#[derive(Debug, thiserror::Error)]
pub(crate) enum FileError {
    #[error("{0} is outside the workspace")]
    OutsideWorkspace(String),
    #[error("{0} is not a relative path inside the artifact directory (no `..`, no leading `/`)")]
    InvalidPath(String),
    #[error("{path} could not be read: {source}")]
    Unreadable {
        path: String,
        #[source]
        source: std::io::Error,
    },
    #[error("{0} is not a regular file")]
    NotAFile(String),
    #[error("{0} is not a directory")]
    NotADirectory(String),
    #[error(
        "{0} has a type artifacts cannot serve; use html, css, js, json, txt, md, images, fonts, mp4/webm, mp3, pdf or wasm"
    )]
    UnsupportedType(String),
    #[error("{path} is {size} bytes; one file may be at most {MAX_FILE_BYTES}")]
    FileTooLarge { path: String, size: u64 },
    #[error("the files total {0} bytes; one version may be at most {MAX_VERSION_BYTES}")]
    VersionTooLarge(u64),
    #[error("{0} files; one version may have at most {MAX_FILES}")]
    TooManyFiles(usize),
    #[error("there is no {INDEX} at the top of the artifact directory")]
    NoIndex,
}

/// Gather the files of an artifact whose top is `dir` (relative to `root`,
/// or absolute inside it; the root itself when unset): the named `paths`
/// relative to `dir`, or every file under it except dot-files.
pub(crate) fn collect(
    root: &Path,
    dir: Option<&str>,
    paths: Option<&[String]>,
) -> Result<Vec<LocalFile>, FileError> {
    let root = root
        .canonicalize()
        .map_err(|source| FileError::Unreadable {
            path: root.display().to_string(),
            source,
        })?;
    let dir_name = dir.unwrap_or(".");
    let base = inside(&root, &root.join(dir_name), dir_name)?;
    if !base.is_dir() {
        return Err(FileError::NotADirectory(dir_name.to_owned()));
    }

    let named = match paths {
        Some(paths) => paths
            .iter()
            .map(|path| Ok((artifact_path(path)?, base.join(path))))
            .collect::<Result<Vec<_>, FileError>>()?,
        None => {
            let mut found = Vec::new();
            walk(&base, "", &mut found)?;
            found
        }
    };
    if named.len() > MAX_FILES {
        return Err(FileError::TooManyFiles(named.len()));
    }

    let mut files = Vec::with_capacity(named.len());
    let mut total = 0;
    for (path, source) in named {
        let source = inside(&root, &source, &path)?;
        let file = read(path, &source)?;
        total += file.bytes.len() as u64;
        if total > MAX_VERSION_BYTES {
            return Err(FileError::VersionTooLarge(total));
        }
        files.push(file);
    }
    if !files.iter().any(|file| file.path == INDEX) {
        return Err(FileError::NoIndex);
    }
    files.sort_by(|left, right| left.path.cmp(&right.path));
    Ok(files)
}

/// `path` resolved through every symlink, refused unless it stays in `root`.
fn inside(root: &Path, path: &Path, name: &str) -> Result<PathBuf, FileError> {
    let resolved = path
        .canonicalize()
        .map_err(|source| FileError::Unreadable {
            path: name.to_owned(),
            source,
        })?;
    if !resolved.starts_with(root) {
        return Err(FileError::OutsideWorkspace(name.to_owned()));
    }
    Ok(resolved)
}

/// A named path as the artifact path it becomes, refused unless it is plain
/// relative segments.
fn artifact_path(path: &str) -> Result<String, FileError> {
    let invalid = || FileError::InvalidPath(path.to_owned());
    if path.is_empty() || path.chars().count() > MAX_PATH_CHARS || path.contains('\\') {
        return Err(invalid());
    }
    let mut segments = Vec::new();
    for component in Path::new(path).components() {
        match component {
            Component::Normal(segment) => segments.push(segment.to_str().ok_or_else(invalid)?),
            Component::CurDir => {}
            Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                return Err(invalid());
            }
        }
    }
    if segments.is_empty() || path.split('/').any(str::is_empty) {
        return Err(invalid());
    }
    Ok(segments.join("/"))
}

/// Every file under `dir`, named by its path from the artifact's top.
/// Dot-files and dot-directories are skipped, and symlinked directories are
/// not descended into; a symlinked file is kept and checked like any other.
fn walk(dir: &Path, prefix: &str, found: &mut Vec<(String, PathBuf)>) -> Result<(), FileError> {
    let unreadable = |source| FileError::Unreadable {
        path: if prefix.is_empty() {
            ".".to_owned()
        } else {
            prefix.to_owned()
        },
        source,
    };
    let mut entries = std::fs::read_dir(dir)
        .map_err(unreadable)?
        .collect::<Result<Vec<_>, _>>()
        .map_err(unreadable)?;
    entries.sort_by_key(std::fs::DirEntry::file_name);
    for entry in entries {
        let name = entry.file_name();
        let Some(name) = name.to_str() else {
            continue;
        };
        if name.starts_with('.') {
            continue;
        }
        let path = if prefix.is_empty() {
            name.to_owned()
        } else {
            format!("{prefix}/{name}")
        };
        let kind = entry.file_type().map_err(unreadable)?;
        if kind.is_dir() {
            walk(&entry.path(), &path, found)?;
        } else if kind.is_file() || (kind.is_symlink() && entry.path().is_file()) {
            if found.len() == MAX_FILES {
                return Err(FileError::TooManyFiles(MAX_FILES + 1));
            }
            found.push((path, entry.path()));
        }
    }
    Ok(())
}

fn read(path: String, source: &Path) -> Result<LocalFile, FileError> {
    let metadata = std::fs::metadata(source).map_err(|source| FileError::Unreadable {
        path: path.clone(),
        source,
    })?;
    if !metadata.is_file() {
        return Err(FileError::NotAFile(path));
    }
    if metadata.len() > MAX_FILE_BYTES {
        return Err(FileError::FileTooLarge {
            path,
            size: metadata.len(),
        });
    }
    let content_type =
        content_type(&path).ok_or_else(|| FileError::UnsupportedType(path.clone()))?;
    let bytes = std::fs::read(source).map_err(|source| FileError::Unreadable {
        path: path.clone(),
        source,
    })?;
    let sha256 = hex::encode(Sha256::digest(&bytes));
    Ok(LocalFile {
        path,
        content_type,
        sha256,
        bytes,
    })
}

/// The served content type for a file, from Macro's allowlist by extension.
fn content_type(path: &str) -> Option<&'static str> {
    let extension = Path::new(path).extension()?.to_str()?.to_ascii_lowercase();
    Some(match extension.as_str() {
        "html" | "htm" => "text/html",
        "css" => "text/css",
        "js" | "mjs" => "text/javascript",
        "json" | "map" => "application/json",
        "txt" => "text/plain",
        "md" => "text/markdown",
        "png" => "image/png",
        "jpg" | "jpeg" => "image/jpeg",
        "gif" => "image/gif",
        "webp" => "image/webp",
        "svg" => "image/svg+xml",
        "avif" => "image/avif",
        "woff" => "font/woff",
        "woff2" => "font/woff2",
        "ttf" => "font/ttf",
        "otf" => "font/otf",
        "mp4" => "video/mp4",
        "webm" => "video/webm",
        "mp3" => "audio/mpeg",
        "pdf" => "application/pdf",
        "wasm" => "application/wasm",
        _ => return None,
    })
}
