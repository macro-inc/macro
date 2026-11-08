//! Helpers shared by this module's tests.

use std::fs;
use std::path::{Path, PathBuf};

/// A fresh, empty directory under the system temp dir, removed on drop, so a
/// failed assertion leaves nothing behind for a later run to find.
pub struct TempDir(PathBuf);

impl TempDir {
    /// `name` keeps directories of different tests apart; the pid and thread
    /// keep concurrent runs apart. Anything already at the path is removed.
    pub fn new(name: &str) -> TempDir {
        let dir = std::env::temp_dir().join(format!(
            "xtask-local-build-{name}-{}-{:?}",
            std::process::id(),
            std::thread::current().id()
        ));
        let _ = fs::remove_dir_all(&dir);
        fs::create_dir_all(&dir).unwrap();
        TempDir(dir)
    }

    pub fn path(&self) -> &Path {
        &self.0
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.0);
    }
}
