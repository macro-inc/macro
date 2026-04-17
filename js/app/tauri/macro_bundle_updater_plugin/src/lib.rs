use std::path::{Path, PathBuf};
use std::sync::RwLock;

pub mod domain;
pub mod inbound;
pub mod outbound;

/// Name of the file used to persist the bundle root path across restarts.
const BUNDLE_ROOT_FILE: &str = "bundle_root";

/// Swappable root directory for serving frontend assets.
/// `None` = use built-in asset resolver (initial bundle from `frontendDist`).
/// `Some(path)` = serve files from this directory (after OTA update).
pub struct BundleRoot(pub RwLock<Option<PathBuf>>);

impl BundleRoot {
    /// Load persisted bundle root from the given cache directory.
    /// Returns `BundleRoot(None)` if no persisted path exists or if the directory is gone.
    pub fn load(cache_dir: &Path) -> Self {
        let persist_path = cache_dir.join(BUNDLE_ROOT_FILE);
        tracing::info!("Loading bundle root from {persist_path:?}");
        match std::fs::read_to_string(&persist_path) {
            Ok(contents) => {
                let path = PathBuf::from(contents.trim());
                let index = path.join("index.html");
                if index.exists() {
                    tracing::info!("Restored bundle root: {path:?}");
                    BundleRoot(RwLock::new(Some(path)))
                } else {
                    tracing::warn!(
                        "Persisted bundle root {path:?} missing index.html at {index:?}"
                    );
                    BundleRoot(RwLock::new(None))
                }
            }
            Err(e) => {
                tracing::info!("No persisted bundle root: {e}");
                BundleRoot(RwLock::new(None))
            }
        }
    }

    /// Persist the bundle root path so it survives app restarts.
    pub fn persist(&self, cache_dir: &Path) -> Result<(), std::io::Error> {
        let persist_path = cache_dir.join(BUNDLE_ROOT_FILE);
        let guard = self
            .0
            .read()
            .map_err(|e| std::io::Error::other(e.to_string()))?;
        match guard.as_ref() {
            Some(root) => {
                tracing::info!("Persisting bundle root {root:?} to {persist_path:?}");
                std::fs::write(&persist_path, root.to_string_lossy().as_bytes())
            }
            None => {
                // Remove the file if bundle root is cleared
                match std::fs::remove_file(&persist_path) {
                    Ok(()) => Ok(()),
                    Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(()),
                    Err(e) => Err(e),
                }
            }
        }
    }
}
