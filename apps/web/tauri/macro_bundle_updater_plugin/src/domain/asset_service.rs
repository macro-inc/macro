use std::path::{Component, Path, PathBuf};

use thiserror::Error;

use crate::domain::{
    bundle_routes::{BundleRoutes, BundleSource},
    ports::BundleAssetRepo,
};

/// A validated path relative to a frontend bundle root.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct BundleAssetPath(PathBuf);

impl BundleAssetPath {
    /// Validate and normalize a relative bundle asset path.
    ///
    /// Empty paths resolve to the application entrypoint. Absolute paths and
    /// parent-directory components are rejected.
    pub fn new(path: impl AsRef<Path>) -> Result<Self, InvalidBundleAssetPath> {
        let mut normalized = PathBuf::new();
        for component in path.as_ref().components() {
            match component {
                Component::Normal(value) => normalized.push(value),
                Component::CurDir => {}
                Component::ParentDir | Component::RootDir | Component::Prefix(_) => {
                    return Err(InvalidBundleAssetPath);
                }
            }
        }
        if normalized.as_os_str().is_empty() {
            normalized.push("index.html");
        }
        Ok(Self(normalized))
    }

    /// Return the normalized relative path.
    pub fn as_path(&self) -> &Path {
        &self.0
    }

    fn entrypoint() -> Self {
        Self(PathBuf::from("index.html"))
    }

    fn has_extension(&self) -> bool {
        self.0.extension().is_some()
    }
}

/// Error returned when an asset path is not safe to resolve.
#[derive(Debug, Clone, Copy, Error, PartialEq, Eq)]
#[error("bundle asset path must remain relative to its bundle root")]
pub struct InvalidBundleAssetPath;

/// Error returned by the bundle asset repository.
#[derive(Debug, Error)]
pub enum BundleAssetReadError {
    /// The resolved path escaped the configured bundle root.
    #[error("resolved asset path escaped its bundle root")]
    OutsideBundleRoot,
    /// A filesystem operation failed.
    #[error(transparent)]
    Io(#[from] std::io::Error),
}

/// Result of resolving one custom-protocol asset request.
#[derive(Debug, PartialEq, Eq)]
pub enum BundleAssetResolution {
    /// Asset bytes loaded from an OTA bundle.
    Ota {
        /// Loaded asset bytes.
        bytes: Vec<u8>,
        /// Actual file path used for MIME type inference.
        content_path: BundleAssetPath,
    },
    /// Delegate this request to Tauri's embedded asset handler.
    Embedded,
    /// No eligible bundle generation contained the requested asset.
    NotFound,
}

/// Domain service that selects the correct bundle generation for asset reads.
#[derive(Clone)]
pub struct BundleAssetResolver<Assets> {
    routes: BundleRoutes,
    assets: Assets,
}

impl<Assets> BundleAssetResolver<Assets>
where
    Assets: BundleAssetRepo,
{
    /// Create an asset resolver backed by shared bundle routes and an asset repository.
    pub fn new(routes: BundleRoutes, assets: Assets) -> Self {
        Self { routes, assets }
    }

    /// Resolve an asset against the active bundle and any transition fallback.
    pub async fn resolve(
        &self,
        path: &BundleAssetPath,
    ) -> Result<BundleAssetResolution, BundleAssetReadError> {
        // Keep this lease through every OTA read. Removing a transition fallback
        // acquires the write side before deleting its directory.
        let routes = self.routes.read().await;
        match &routes.active {
            BundleSource::Embedded { .. } => {
                if path.has_extension()
                    && let Some(BundleSource::Ota { root, .. }) = &routes.fallback
                    && let Some(bytes) = self.assets.read_asset(root, path).await?
                {
                    return Ok(BundleAssetResolution::Ota {
                        bytes,
                        content_path: path.clone(),
                    });
                }
                Ok(BundleAssetResolution::Embedded)
            }
            BundleSource::Ota { root, .. } => {
                if let Some(bytes) = self.assets.read_asset(root, path).await? {
                    return Ok(BundleAssetResolution::Ota {
                        bytes,
                        content_path: path.clone(),
                    });
                }

                if !path.has_extension() {
                    let entrypoint = BundleAssetPath::entrypoint();
                    return Ok(match self.assets.read_asset(root, &entrypoint).await? {
                        Some(bytes) => BundleAssetResolution::Ota {
                            bytes,
                            content_path: entrypoint,
                        },
                        None => BundleAssetResolution::NotFound,
                    });
                }

                match &routes.fallback {
                    Some(BundleSource::Ota { root, .. }) => {
                        Ok(match self.assets.read_asset(root, path).await? {
                            Some(bytes) => BundleAssetResolution::Ota {
                                bytes,
                                content_path: path.clone(),
                            },
                            None => BundleAssetResolution::NotFound,
                        })
                    }
                    Some(BundleSource::Embedded { .. }) => Ok(BundleAssetResolution::Embedded),
                    None => Ok(BundleAssetResolution::NotFound),
                }
            }
        }
    }
}

#[cfg(test)]
mod test;
