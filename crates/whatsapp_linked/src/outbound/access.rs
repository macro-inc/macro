//! Native authorization through the entity access service.

use crate::domain::{
    models::LinkedError,
    ports::{Authorizer, LinkedResult},
};
use async_trait::async_trait;
use entity_access::domain::{
    models::{AccessError, EntityType, MemberTeamRole, OwnerAccessLevel, RequiredPermission},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use uuid::Uuid;

/// Mints the receipts the linked use cases require.
pub struct EntityAccessAuthorizer<E> {
    access: Arc<E>,
}

impl<E> EntityAccessAuthorizer<E> {
    /// Wrap the hosting service's entity access service.
    pub fn new(access: Arc<E>) -> Self {
        Self { access }
    }
}

impl<E: EntityAccessService> EntityAccessAuthorizer<E> {
    async fn require<T: RequiredPermission>(
        &self,
        user: &str,
        entity: Uuid,
        entity_type: EntityType,
    ) -> LinkedResult<()> {
        let user = MacroUserIdStr::try_from(user.to_owned()).map_err(|_| LinkedError::Forbidden)?;
        self.access
            .generate_entity_access_receipt::<T>(&user.0, None, &entity.to_string(), entity_type)
            .await
            .map(|_| ())
            .map_err(|error| match error {
                AccessError::Unavailable(_) | AccessError::Internal(_) => {
                    rootcause::Report::new(error).context(LinkedError::Unavailable)
                }
                AccessError::Unauthorized
                | AccessError::UnauthorizedWithMessage(_)
                | AccessError::BadRequest(_)
                | AccessError::NotFound(_) => LinkedError::Forbidden.into(),
            })
    }
}

#[async_trait]
impl<E: EntityAccessService> Authorizer for EntityAccessAuthorizer<E> {
    async fn require_team_member(&self, team: Uuid, user: &str) -> LinkedResult<()> {
        self.require::<MemberTeamRole>(user, team, EntityType::Team)
            .await
    }

    async fn require_group_owner(&self, group_id: Uuid, user: &str) -> LinkedResult<()> {
        self.require::<OwnerAccessLevel>(user, group_id, EntityType::WhatsAppGroup)
            .await
    }
}
