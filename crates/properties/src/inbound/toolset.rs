//! Toolset inbound adapter for the Properties service.

mod bulk_set_entity_property_options;
mod create_tag;
mod delete_tag;
mod edit_tag;
mod get_entity_properties;
mod list_tags;
mod set_entity_property;
mod tag_color;

#[cfg(test)]
mod test;

use crate::domain::service::{PropertiesService, TeamReceipt};
use ai_toolset::{AsyncToolCollection, RequestContext, ServiceContext, ToolCallError};
use bot_id::BotId;
use entity_access::domain::models::{
    AccessError, Entity, EntityAccessReceipt, EntityPermission, EntityType,
};
use entity_access::domain::ports::EntityAccessService;
use std::sync::Arc;

pub use bulk_set_entity_property_options::{
    BulkSetEntityPropertyOptions, BulkSetEntityPropertyOptionsResponse,
};
pub use create_tag::{CreateTag, CreateTagResponse};
pub use delete_tag::{DeleteTag, DeleteTagResponse};
pub use edit_tag::{EditTag, EditTagResponse};
pub use get_entity_properties::{GetEntityProperties, GetEntityPropertiesResponse};
pub use list_tags::{ListTags, ListTagsResponse};
pub use set_entity_property::{SetEntityProperty, SetEntityPropertyResponse};

/// Service context for properties AI tools.
pub struct PropertiesToolContext<T: PropertiesService, A: EntityAccessService> {
    /// The properties service instance.
    pub service: Arc<T>,
    /// The canonical service used to mint entity access receipts.
    pub entity_access_service: Arc<A>,
    /// The bot these tools act as, on behalf of the requesting user. Defaults
    /// to Macro AI; hosts running a specific agent set it with [`Self::with_actor`].
    pub actor: BotId,
}

impl<T: PropertiesService, A: EntityAccessService> Clone for PropertiesToolContext<T, A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            actor: self.actor,
        }
    }
}

impl<T: PropertiesService, A: EntityAccessService> PropertiesToolContext<T, A> {
    /// Create a new properties tool context.
    pub fn new(service: T, entity_access_service: A) -> Self {
        Self {
            service: Arc::new(service),
            entity_access_service: Arc::new(entity_access_service),
            actor: bot_id::MACRO_AI_BOT_ID,
        }
    }

    /// Set the bot these tools act as.
    pub fn with_actor(mut self, actor: BotId) -> Self {
        self.actor = actor;
        self
    }
}

/// Mint the caller's team-membership receipt, or `None` when they are not on a
/// team. Owner-scoped tag operations forward this to the domain, which enforces
/// ownership; passing it also lets team-owned tags satisfy the ownership check.
pub(crate) async fn caller_team_receipt_opt<T, A>(
    service_context: &ServiceContext<PropertiesToolContext<T, A>>,
    request_context: &RequestContext,
) -> Result<Option<TeamReceipt>, ToolCallError>
where
    T: PropertiesService,
    A: EntityAccessService,
{
    let Some(team_info) = service_context
        .entity_access_service
        .get_user_team(&request_context.user_id)
        .await
        .map_err(team_access_error)?
    else {
        return Ok(None);
    };

    let receipt: TeamReceipt = EntityAccessReceipt::try_new_authenticated_user(
        request_context.user_id.clone(),
        Entity {
            entity_id: team_info.team_id.to_string(),
            entity_type: EntityType::Team,
        },
        EntityPermission::TeamRole {
            role: team_info.role,
        },
    )
    .map_err(team_access_error)?;

    Ok(Some(receipt))
}

fn team_access_error(err: AccessError) -> ToolCallError {
    ToolCallError {
        description: "Failed to verify your team membership.".to_string(),
        internal_error: err.into(),
    }
}

/// Create a properties toolset.
pub fn properties_toolset<T, A>() -> AsyncToolCollection<PropertiesToolContext<T, A>>
where
    T: PropertiesService,
    A: EntityAccessService,
{
    AsyncToolCollection::new()
        .add_tool::<GetEntityProperties, PropertiesToolContext<T, A>>()
        .add_tool::<SetEntityProperty, PropertiesToolContext<T, A>>()
        .add_tool::<BulkSetEntityPropertyOptions, PropertiesToolContext<T, A>>()
        .add_tool::<ListTags, PropertiesToolContext<T, A>>()
        .add_tool::<CreateTag, PropertiesToolContext<T, A>>()
        .add_tool::<EditTag, PropertiesToolContext<T, A>>()
        .add_tool::<DeleteTag, PropertiesToolContext<T, A>>()
}
