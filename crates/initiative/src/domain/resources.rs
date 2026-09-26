//! Owning-domain capabilities used to enrich and clean up initiatives.

use std::{collections::HashMap, future::Future, pin::Pin};

use entity_access::domain::models::{
    EditAccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, ViewAccessLevel,
};

use super::{
    models::{InitiativeError, InitiativeId},
    reads::InitiativePropertySnapshot,
};

/// Boxed asynchronous operation on an initiative dependency.
pub type ResourceFuture<'a, T> =
    Pin<Box<dyn Future<Output = Result<T, InitiativeError>> + Send + 'a>>;

/// Access and property operations supplied by the composition root.
/// Implementations delegate to the owning services, never their persistence adapters.
pub trait InitiativeResources: std::fmt::Debug + Send + Sync + 'static {
    /// Initialize the four canonical task-style properties without clearing existing values.
    fn initialize(&self, id: InitiativeId) -> ResourceFuture<'_, ()>;
    /// Clean up properties after the initiative is deleted using its already-verified capability.
    fn purge(&self, receipt: EntityAccessReceipt<EditAccessLevel>) -> ResourceFuture<'_, ()>;
    /// Return a view capability for a related entity under the same user/bot scope.
    /// Missing and inaccessible entities return `None`; infrastructure failures remain errors.
    fn view(
        &self,
        auth: EntityAccessAuth,
        entity: Entity,
    ) -> ResourceFuture<'_, Option<EntityAccessReceipt<ViewAccessLevel>>>;
    /// Read canonical property snapshots in a batch for verified entities.
    fn properties(
        &self,
        receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> ResourceFuture<'_, HashMap<String, InitiativePropertySnapshot>>;
}
