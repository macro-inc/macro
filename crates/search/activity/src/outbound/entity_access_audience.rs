//! Current-access adapter for activity reads and realtime recipients.

/// Realtime activity audience: everyone with current access to the entity,
/// so entity timelines (side panels) update live for watchers, not only for
/// the acting subject.
pub struct EntityAccessActivityAudience<S> {
    service: std::sync::Arc<S>,
}

impl<S> EntityAccessActivityAudience<S> {
    /// Compose the audience adapter with primary-backed entity access.
    pub fn new(service: std::sync::Arc<S>) -> Self {
        Self { service }
    }
}

impl<S> crate::ActivityAudienceExpander for EntityAccessActivityAudience<S>
where
    S: entity_access::domain::ports::EntityAccessService,
{
    type Err = entity_access::domain::models::AccessError;

    async fn visible_entities(
        &self,
        viewer: &macro_user_id::user_id::MacroUserIdStr<'_>,
        entities: &[(crate::EntityType, String)],
    ) -> Result<std::collections::HashSet<(crate::EntityType, String)>, Self::Err> {
        let mut visible = self.service.visible_crm_entities(viewer, entities).await?;
        for (kind, id) in entities {
            if !matches!(
                kind,
                crate::EntityType::CrmCompany
                    | crate::EntityType::CrmContact
                    | crate::EntityType::CrmPipeline
            ) && self.viewer_can_see(*kind, id, viewer).await?
            {
                visible.insert((*kind, id.clone()));
            }
        }
        Ok(visible)
    }

    async fn viewer_can_see(
        &self,
        entity_type: crate::EntityType,
        entity_id: &str,
        viewer: &macro_user_id::user_id::MacroUserIdStr<'_>,
    ) -> Result<bool, Self::Err> {
        use entity_access::domain::models::{AccessError, ViewAccessLevel};
        match self
            .service
            .generate_entity_access_receipt::<ViewAccessLevel>(viewer, None, entity_id, entity_type)
            .await
        {
            Ok(_) => Ok(true),
            Err(
                AccessError::Unauthorized
                | AccessError::UnauthorizedWithMessage(_)
                | AccessError::NotFound(_)
                | AccessError::BadRequest(_),
            ) => Ok(false),
            Err(error) => Err(error),
        }
    }

    async fn entity_audience(
        &self,
        entity_type: crate::EntityType,
        entity_id: &str,
    ) -> Result<Vec<macro_user_id::user_id::MacroUserIdStr<'static>>, Self::Err> {
        match self
            .service
            .get_users_by_entity(entity_id, entity_type)
            .await
        {
            // Entity kinds without an expandable audience report BadRequest;
            // deliver those subject-only instead of surfacing an error.
            Err(entity_access::domain::models::AccessError::BadRequest(_)) => Ok(Vec::new()),
            result => result,
        }
    }
}
