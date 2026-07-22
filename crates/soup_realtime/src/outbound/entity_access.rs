//! Adapter from entity access to current realtime Soup recipients.

#[cfg(test)]
mod test;

use std::future::Future;

use entity_access::domain::{models::AccessError, ports::EntityAccessService};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::{Entity, EntityType};
use rootcause::prelude::{Report, ResultExt as _};

use crate::domain::ports::UserAccessExpander;

/// Narrow seam over the external entity-access service used by this adapter.
///
/// Every [`EntityAccessService`] implements this trait automatically. Keeping
/// the seam narrow also allows adapter tests to avoid constructing unrelated
/// authorization capabilities.
pub trait EntityAccessUserLookup: Send + Sync + 'static {
    /// Returns all users with current access to the entity ID and type.
    fn get_users_by_entity(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, AccessError>> + Send;
}

impl<S> EntityAccessUserLookup for S
where
    S: EntityAccessService,
{
    async fn get_users_by_entity(
        &self,
        entity_id: &str,
        entity_type: EntityType,
    ) -> Result<Vec<MacroUserIdStr<'static>>, AccessError> {
        EntityAccessService::get_users_by_entity(self, entity_id, entity_type).await
    }
}

/// Current-access expander backed by an entity-access service.
pub struct EntityAccessExpander<S> {
    service: S,
}

impl<S> EntityAccessExpander<S> {
    /// Creates an expander around an entity-access service.
    pub fn new(service: S) -> Self {
        Self { service }
    }
}

impl<S> UserAccessExpander for EntityAccessExpander<S>
where
    S: EntityAccessUserLookup,
{
    #[tracing::instrument(
        skip(self),
        fields(entity_type = %entity.entity_type, entity_id = %entity.entity_id),
        err
    )]
    async fn expand_user_access(
        &self,
        entity: &Entity<'static>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        self.service
            .get_users_by_entity(entity.entity_id.as_ref(), entity.entity_type)
            .await
            .context("failed to query current entity accessors")
            .map_err(Into::into)
    }
}
