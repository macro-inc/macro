#![deny(missing_docs)]
//! Review changes from the GitHub pull request linked to an agent session.
//!
//! The domain service reads the PR through a port, derives per-file facts,
//! stores the patch in S3 and the summary in Postgres, and notifies viewers.
//! Capture runs after each turn and on demand, regardless of the runtime.
//! HTTP handlers pass session access receipts to the domain service. GitHub
//! repository access is checked by the owning GitHub token service.

/// Domain models, the patch reader, ports, and the changes service.
pub mod domain;
/// Inbound HTTP adapter.
#[cfg(feature = "inbound")]
pub mod inbound;
/// Adapters implementing the domain ports for external systems.
#[cfg(feature = "outbound")]
pub mod outbound;
/// In-memory port implementations for tests.
#[cfg(any(test, feature = "test-utils"))]
pub mod testing;
