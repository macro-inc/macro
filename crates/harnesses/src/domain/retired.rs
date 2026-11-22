//! Telling other domains that a machine was just unpaired.
//!
//! An agent teammate hosted on its owner's own machine may run there only
//! while the machine is paired. Unpairing takes that away; the agent side
//! follows at once through [`HarnessRetired`] instead of at its next sweep.

use std::{future::Future, pin::Pin, sync::Arc};

pub use harness_id::HarnessId;

/// A boxed future, so the port can be shared as a trait object.
pub type RetiredFuture<'a> = Pin<Box<dyn Future<Output = Result<(), anyhow::Error>> + Send + 'a>>;

/// Told after a harness was unpaired (deleted by its owner or by itself).
pub trait HarnessRetired: std::fmt::Debug + Send + Sync + 'static {
    /// `harness_id` was unpaired. Failures are logged by the caller and never
    /// undo the unpair; whatever depends on it must also catch up on its own.
    fn harness_retired(&self, harness_id: HarnessId) -> RetiredFuture<'_>;
}

/// Tells nobody. The default until a composition root wires a listener in.
#[derive(Debug)]
pub struct NoOpHarnessRetired;

impl HarnessRetired for NoOpHarnessRetired {
    fn harness_retired(&self, _harness_id: HarnessId) -> RetiredFuture<'_> {
        Box::pin(async { Ok(()) })
    }
}

/// The default listener, shared.
pub(crate) fn no_op() -> Arc<dyn HarnessRetired> {
    Arc::new(NoOpHarnessRetired)
}
