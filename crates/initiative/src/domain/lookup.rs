//! Read-only initiative identity boundary for other domains.

use std::{future::Future, pin::Pin};

use super::{
    models::{InitiativeBasic, InitiativeError, InitiativeId},
    ports::InitiativeRepo,
};

/// Internal identity reads without granting access to an initiative.
/// Callers must separately verify capabilities before exposing returned facts.
pub trait InitiativeReader: Send + Sync + 'static {
    /// Return a live initiative, or `None` after its deletion.
    fn read_basic(
        &self,
        id: InitiativeId,
    ) -> Pin<Box<dyn Future<Output = Result<Option<InitiativeBasic>, InitiativeError>> + Send + '_>>;
}

/// Lightweight owning service for compositions that only read initiative identity.
#[derive(Clone)]
pub struct InitiativeLookup<R>(R);

impl<R: InitiativeRepo> InitiativeLookup<R> {
    /// Compose the lookup from the initiative persistence port.
    pub fn new(repo: R) -> Self {
        Self(repo)
    }
}

impl<R: InitiativeRepo> InitiativeReader for InitiativeLookup<R> {
    fn read_basic(
        &self,
        id: InitiativeId,
    ) -> Pin<Box<dyn Future<Output = Result<Option<InitiativeBasic>, InitiativeError>> + Send + '_>>
    {
        Box::pin(async move { self.0.get_basic(id).await.map_err(Into::into) })
    }
}
