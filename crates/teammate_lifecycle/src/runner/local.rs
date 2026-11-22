//! The real file system and runtime.

use std::io::{self, Read as _, Write as _};
use std::os::unix::process::CommandExt as _;
use std::path::{Path, PathBuf};

use super::{Fs, MAX_FILE, Runtime};

/// The local file system.
#[derive(Debug, Clone, Copy, Default)]
pub struct LocalFs;

impl Fs for LocalFs {
    fn read(&self, path: &Path) -> io::Result<Option<Vec<u8>>> {
        let file = match std::fs::File::open(path) {
            Ok(file) => file,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
            Err(error) => return Err(error),
        };
        let mut contents = Vec::new();
        file.take(MAX_FILE.saturating_add(1))
            .read_to_end(&mut contents)?;
        if u64::try_from(contents.len()).unwrap_or(u64::MAX) > MAX_FILE {
            return Err(io::Error::other(format!("longer than {MAX_FILE} bytes")));
        }
        Ok(Some(contents))
    }

    fn write(&self, path: &Path, contents: &[u8]) -> io::Result<()> {
        let partial = path.with_extension("partial");
        let mut file = std::fs::File::create(&partial)?;
        file.write_all(contents)?;
        file.sync_all()?;
        std::fs::rename(&partial, path)
    }

    fn exists(&self, path: &Path) -> io::Result<bool> {
        match std::fs::symlink_metadata(path) {
            Ok(_) => Ok(true),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(false),
            Err(error) => Err(error),
        }
    }

    fn read_link(&self, path: &Path) -> io::Result<Option<PathBuf>> {
        match std::fs::read_link(path) {
            Ok(target) => Ok(Some(target)),
            Err(error)
                if matches!(
                    error.kind(),
                    io::ErrorKind::NotFound | io::ErrorKind::InvalidInput
                ) =>
            {
                Ok(None)
            }
            Err(error) => Err(error),
        }
    }

    fn remove(&self, path: &Path) -> io::Result<()> {
        let metadata = match std::fs::symlink_metadata(path) {
            Ok(metadata) => metadata,
            Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
            Err(error) => return Err(error),
        };
        if metadata.is_dir() {
            std::fs::remove_dir_all(path)
        } else {
            std::fs::remove_file(path)
        }
    }

    fn symlink(&self, target: &Path, link: &Path) -> io::Result<()> {
        std::os::unix::fs::symlink(target, link)
    }

    fn create_directories(&self, path: &Path) -> io::Result<()> {
        std::fs::create_dir_all(path)
    }

    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        std::fs::rename(from, to)
    }
}

/// `bun` from `PATH`.
#[derive(Debug, Clone, Copy, Default)]
pub struct BunRuntime;

impl Runtime for BunRuntime {
    fn exec(&self, workspace: &Path) -> io::Error {
        std::process::Command::new("bun")
            .arg(workspace.join("cli.ts"))
            .arg("run")
            .current_dir(workspace)
            .exec()
    }
}
