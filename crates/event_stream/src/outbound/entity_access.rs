//! [`AccessDirectory`] over the entity access service, reading current
//! access with no process cache (the domain caches and evicts).

use crate::domain::ports::{AccessDirectory, AccessLookupError};
use entity_access::domain::models::AccessError;
use entity_access::domain::models::AccessLevel;
use entity_access::domain::ports::EntityAccessService;
use event_exposure::{EntityType, MinAccessLevel};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Explicit accessors from `entity_access`, uncached.
pub struct EntityAccessDirectory<A> {
    service: Arc<A>,
}

impl<A> EntityAccessDirectory<A> {
    /// Wrap the shared entity access service.
    pub fn new(service: Arc<A>) -> Self {
        Self { service }
    }
}

fn lookup_error(error: AccessError) -> AccessLookupError {
    match error {
        AccessError::BadRequest(message) => AccessLookupError::Unsupported(message.to_owned()),
        other => AccessLookupError::Failed(rootcause::report!(other).into_dynamic()),
    }
}

impl<A: EntityAccessService> AccessDirectory for EntityAccessDirectory<A> {
    async fn accessors(
        &self,
        entity_type: EntityType,
        entity_id: &str,
    ) -> Result<Vec<String>, AccessLookupError> {
        let accessors = self
            .service
            .get_users_by_entity_uncached(entity_id, entity_type)
            .await
            .map_err(lookup_error)?;
        Ok(accessors
            .into_iter()
            .map(|user| user.as_ref().to_owned())
            .collect())
    }

    async fn is_accessor(
        &self,
        principal_id: &str,
        entity_type: EntityType,
        entity_id: &str,
    ) -> Result<bool, AccessLookupError> {
        self.service
            .is_accessor(principal_id, entity_id, entity_type)
            .await
            .map_err(lookup_error)
    }

    async fn is_accessor_at_least(
        &self,
        principal_id: &str,
        entity_type: EntityType,
        entity_id: &str,
        min_level: MinAccessLevel,
    ) -> Result<bool, AccessLookupError> {
        if !self
            .is_accessor(principal_id, entity_type, entity_id)
            .await?
        {
            return Ok(false);
        }
        let Ok(user) = MacroUserIdStr::parse_from_str(principal_id) else {
            return Ok(false);
        };
        // Grants only, the same set webhooks resolve: a link share's level
        // never lifts an explicit accessor over the floor.
        let admitted = self
            .service
            .get_users_by_entity_at_least(entity_id, entity_type, min_access_level(min_level))
            .await
            .map_err(lookup_error)?;
        Ok(admitted
            .iter()
            .any(|admitted| admitted.as_ref().eq_ignore_ascii_case(user.as_ref())))
    }
}

/// The access level an [`MinAccessLevel`] floor names.
pub fn min_access_level(min_level: MinAccessLevel) -> AccessLevel {
    match min_level {
        MinAccessLevel::Comment => AccessLevel::Comment,
        MinAccessLevel::Edit => AccessLevel::Edit,
        MinAccessLevel::Owner => AccessLevel::Owner,
    }
}
