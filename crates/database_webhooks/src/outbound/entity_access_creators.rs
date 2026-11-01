//! A webhook creator's current grant, asked of entity access on every call.

use std::sync::Arc;

use entity_access::domain::models::{
    AccessError, EditAccessLevel, EntityAccessReceipt, EntityType,
};
use entity_access::domain::ports::EntityAccessService;
use macro_user_id::user_id::MacroUserIdStr;
use models_databases::DatabaseId;

use crate::domain::ports::CreatorAccess;

/// [`CreatorAccess`] through entity access.
#[derive(Debug)]
pub struct EntityAccessCreators<EntityAccess> {
    entity_access: Arc<EntityAccess>,
}

impl<EntityAccess> Clone for EntityAccessCreators<EntityAccess> {
    fn clone(&self) -> Self {
        Self {
            entity_access: self.entity_access.clone(),
        }
    }
}

impl<EntityAccess> EntityAccessCreators<EntityAccess> {
    /// Creators' grants as `entity_access` reads them.
    pub fn new(entity_access: Arc<EntityAccess>) -> Self {
        Self { entity_access }
    }
}

impl<EntityAccess: EntityAccessService> CreatorAccess for EntityAccessCreators<EntityAccess> {
    async fn edit_receipt(
        &self,
        user_id: &MacroUserIdStr<'static>,
        database_id: DatabaseId,
    ) -> Result<Option<EntityAccessReceipt<EditAccessLevel>>, rootcause::Report> {
        match self
            .entity_access
            .generate_entity_access_receipt::<EditAccessLevel>(
                user_id,
                None,
                &database_id.to_string(),
                EntityType::Database,
            )
            .await
        {
            Ok(receipt) => Ok(Some(receipt)),
            Err(
                AccessError::Unauthorized
                | AccessError::UnauthorizedWithMessage(_)
                | AccessError::NotFound(_),
            ) => Ok(None),
            Err(error) => Err(rootcause::report!(
                "checking the webhook creator's access: {error}"
            )),
        }
    }
}
