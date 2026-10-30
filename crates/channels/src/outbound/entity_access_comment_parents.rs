//! Authorizes comment references through the commented entity's permissions.

use std::sync::Arc;

use entity_access::domain::{
    models::{AccessError, AccessLevel, EntityType},
    ports::EntityAccessService,
};
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::ports::CommentParentAccess;

/// Comment-parent access backed by the entity access service.
#[derive(Clone)]
pub struct EntityAccessCommentParents<E> {
    entity_access_service: Arc<E>,
}

impl<E> EntityAccessCommentParents<E> {
    /// Authorize comment parents through `entity_access_service`.
    pub fn new(entity_access_service: Arc<E>) -> Self {
        Self {
            entity_access_service,
        }
    }
}

/// Stored message parent types that carry comments, and the entity whose
/// permissions govern them.
fn parent_entity_type(stored: &str) -> Option<EntityType> {
    Some(match stored {
        "document" => EntityType::Document,
        "initiative" => EntityType::Initiative,
        "crm_company" => EntityType::CrmCompany,
        "crm_contact" => EntityType::CrmContact,
        "call" => EntityType::Call,
        _ => return None,
    })
}

#[async_trait::async_trait]
impl<E: EntityAccessService> CommentParentAccess for EntityAccessCommentParents<E> {
    #[tracing::instrument(err, skip(self, viewer))]
    async fn can_view_parent(
        &self,
        viewer: &str,
        parent_entity_type: &str,
        parent_entity_id: &str,
    ) -> anyhow::Result<bool> {
        let Some(entity_type) = self::parent_entity_type(parent_entity_type) else {
            return Ok(false);
        };
        let Ok(viewer) = MacroUserIdStr::try_from(viewer.to_string()) else {
            return Ok(false);
        };
        match self
            .entity_access_service
            .check_access(
                Some(&viewer.0),
                parent_entity_id,
                entity_type,
                AccessLevel::View,
            )
            .await
        {
            Ok(_) => Ok(true),
            Err(
                AccessError::Unauthorized
                | AccessError::UnauthorizedWithMessage(_)
                | AccessError::BadRequest(_)
                | AccessError::NotFound(_),
            ) => Ok(false),
            Err(AccessError::Unavailable(report) | AccessError::Internal(report)) => {
                Err(anyhow::Error::from(report))
            }
        }
    }
}
