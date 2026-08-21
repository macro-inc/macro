use std::{path::PathBuf, sync::Arc};
use tokio::sync::{OwnedRwLockReadGuard, RwLock};

/// Identifies where a frontend bundle is served from.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BundleSourceKind {
    /// Assets compiled into the native application.
    Embedded,
    /// Assets loaded from an OTA bundle directory.
    Ota,
}

/// Identifies one frontend bundle generation.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BundleIdentity {
    /// Monotonically increasing bundle build number.
    pub bundle_build: u64,
    /// Storage source for this bundle generation.
    pub source: BundleSourceKind,
}

/// A source from which frontend assets can be served.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum BundleSource {
    /// Assets compiled into the native application.
    Embedded {
        /// Build number compiled into the native application.
        bundle_build: u64,
    },
    /// Assets stored in an applied OTA bundle directory.
    Ota {
        /// Build number read from the OTA bundle manifest.
        bundle_build: u64,
        /// Root directory containing the OTA bundle assets.
        root: PathBuf,
    },
}

impl BundleSource {
    /// Construct an embedded bundle source.
    pub fn embedded(bundle_build: u64) -> Self {
        Self::Embedded { bundle_build }
    }

    /// Construct an OTA bundle source.
    pub fn ota(bundle_build: u64, root: PathBuf) -> Self {
        Self::Ota { bundle_build, root }
    }

    /// Return this source's identity.
    pub fn identity(&self) -> BundleIdentity {
        match self {
            Self::Embedded { bundle_build } => BundleIdentity {
                bundle_build: *bundle_build,
                source: BundleSourceKind::Embedded,
            },
            Self::Ota { bundle_build, .. } => BundleIdentity {
                bundle_build: *bundle_build,
                source: BundleSourceKind::Ota,
            },
        }
    }

    /// Return the OTA root directory, if this is an OTA source.
    pub fn ota_root(&self) -> Option<&std::path::Path> {
        match self {
            Self::Embedded { .. } => None,
            Self::Ota { root, .. } => Some(root),
        }
    }
}

/// Atomically published routing state for frontend bundle assets.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BundleRouteSnapshot {
    /// Source used for the currently active frontend document.
    pub active: BundleSource,
    /// Previous source retained while a document reload is in progress.
    pub fallback: Option<BundleSource>,
}

/// Shared domain state used to coordinate updater transitions and asset reads.
///
/// Asset readers hold a read lease until their file read completes. Route
/// transitions use a short-lived write lease, so they wait for existing reads
/// without sharing the updater service's coarse-grained mutex.
#[derive(Clone)]
pub struct BundleRoutes {
    state: Arc<RwLock<BundleRouteSnapshot>>,
}

impl BundleRoutes {
    /// Create routing state that initially serves the embedded bundle.
    pub fn new(embedded_bundle_build: u64) -> Self {
        Self {
            state: Arc::new(RwLock::new(BundleRouteSnapshot {
                active: BundleSource::embedded(embedded_bundle_build),
                fallback: None,
            })),
        }
    }

    /// Acquire a read lease for resolving an asset request.
    pub async fn read(&self) -> OwnedRwLockReadGuard<BundleRouteSnapshot> {
        self.state.clone().read_owned().await
    }

    /// Return the identity of the active bundle generation.
    pub async fn active_identity(&self) -> BundleIdentity {
        self.state.read().await.active.identity()
    }

    /// Replace the active source without retaining a transition fallback.
    ///
    /// This is used while restoring startup state before a webview is serving
    /// requests.
    pub async fn restore(&self, source: BundleSource) {
        let mut state = self.state.write().await;
        state.active = source;
        state.fallback = None;
    }

    /// Begin a live transition to a new source, retaining the prior source.
    pub async fn transition_to(&self, source: BundleSource) {
        let mut state = self.state.write().await;
        if state.active == source {
            return;
        }
        state.fallback = Some(state.active.clone());
        state.active = source;
    }

    /// Finish a live transition and return the retired fallback source.
    ///
    /// Acquiring the write lease waits for readers of the prior snapshot to
    /// finish, so a returned OTA directory can be safely cleaned up.
    pub async fn finish_transition(&self) -> Option<BundleSource> {
        self.state.write().await.fallback.take()
    }
}

#[cfg(test)]
mod test;
