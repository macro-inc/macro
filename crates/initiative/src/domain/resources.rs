//! Owning-domain capabilities used to enrich and clean up initiatives.

use std::{collections::HashMap, future::Future, pin::Pin};

use macro_user_id::user_id::MacroUserIdStr;

use entity_access::domain::models::{
    EditAccessLevel, Entity, EntityAccessAuth, EntityAccessReceipt, EntityType, ViewAccessLevel,
};

use super::{
    models::{InitialPropertyValue, InitiativeError, InitiativeId},
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
    /// Set a new initiative's first property values as its owner, validated by the
    /// properties service. All or nothing: if any value is rejected, none remain.
    fn set_initial_properties(
        &self,
        owner: MacroUserIdStr<'static>,
        id: InitiativeId,
        values: Vec<InitialPropertyValue>,
    ) -> ResourceFuture<'_, ()>;
    /// Clean up properties after the initiative is deleted using its already-verified capability:
    /// its own values, and the Project values that put tasks in it.
    fn purge(&self, receipt: EntityAccessReceipt<EditAccessLevel>) -> ResourceFuture<'_, ()>;
    /// Tasks whose Project property names the initiative, in id order. Callers authorize each
    /// task before showing it.
    fn project_tasks(&self, id: InitiativeId) -> ResourceFuture<'_, Vec<String>>;
    /// Return a view capability for a related entity under the same user/bot scope.
    /// Missing and inaccessible entities return `None`; infrastructure failures remain errors.
    fn view(
        &self,
        auth: EntityAccessAuth,
        entity: Entity,
    ) -> ResourceFuture<'_, Option<EntityAccessReceipt<ViewAccessLevel>>>;
    /// View capabilities for the documents among `ids` visible under the same scope, in
    /// input order, each decided as [`Self::view`] decides it. Implementations may check
    /// them together; the default checks one at a time.
    fn view_documents(
        &self,
        auth: EntityAccessAuth,
        ids: Vec<String>,
    ) -> ResourceFuture<'_, Vec<EntityAccessReceipt<ViewAccessLevel>>> {
        Box::pin(async move {
            let mut visible = Vec::new();
            for id in ids {
                if let Some(receipt) = self
                    .view(
                        auth.clone(),
                        Entity {
                            entity_id: id,
                            entity_type: EntityType::Document,
                        },
                    )
                    .await?
                {
                    visible.push(receipt);
                }
            }
            Ok(visible)
        })
    }
    /// Read canonical property snapshots in a batch for verified entities.
    fn properties(
        &self,
        receipts: Vec<EntityAccessReceipt<ViewAccessLevel>>,
    ) -> ResourceFuture<'_, HashMap<String, InitiativePropertySnapshot>>;
}
