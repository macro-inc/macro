use std::path::PathBuf;
use std::sync::RwLock;

pub mod domain;
pub mod inbound;
pub mod outbound;

/// Swappable root directory for serving frontend assets.
/// `None` = use built-in asset resolver (initial bundle from `frontendDist`).
/// `Some(path)` = serve files from this directory (after OTA update).
pub struct BundleRoot(pub RwLock<Option<PathBuf>>);
