//! Project discussions for AI/MCP, using shared message capabilities and policies.

mod read;
mod write;
pub use read::ReadInitiativeDiscussions;
pub use write::{
    DeleteInitiativeComment, PostInitiativeComment, ReactToInitiativeComment,
    SetInitiativeDiscussionResolved, UpdateInitiativeComment,
};

use crate::domain::{api::MessageServiceApi, ports::MessageError};
use ai_toolset::{AsyncToolCollection, RequestContext, ToolCallError, ToolResult};
use bot_id::BotId;
use entity_access::domain::{
    models::{BotAccessScope, EntityAccessReceipt, EntityType, RequiredPermission},
    ports::EntityAccessService,
};
use std::sync::Arc;

/// Shared, production-wired message service plus the caller's capability issuer.
pub struct InitiativeDiscussionToolContext<A> {
    /// Canonical discussion reads and mutations including delivery effects.
    pub service: Arc<dyn MessageServiceApi>,
    /// Entity access service.
    pub access: Arc<A>,
    /// Bot author for delegated comment mutations.
    pub actor: BotId,
}

impl<A> Clone for InitiativeDiscussionToolContext<A> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access: self.access.clone(),
            actor: self.actor,
        }
    }
}

impl<A> InitiativeDiscussionToolContext<A> {
    /// Select the agent acting on the requesting user's behalf.
    pub fn with_actor(mut self, actor: BotId) -> Self {
        self.actor = actor;
        self
    }
}

impl<A: EntityAccessService> InitiativeDiscussionToolContext<A> {
    async fn receipt<T: RequiredPermission>(
        &self,
        request: &RequestContext,
        id: uuid::Uuid,
    ) -> ToolResult<EntityAccessReceipt<T>> {
        self.access
            .generate_bot_entity_access_receipt::<T>(
                self.actor,
                BotAccessScope::user(request.user_id.clone()),
                &id.to_string(),
                EntityType::Initiative,
            )
            .await
            .map_err(|error| ToolCallError {
                description:
                    "The project is unavailable or you lack the required discussion permission"
                        .into(),
                internal_error: error.into(),
            })
    }
}

fn failure(error: MessageError) -> ToolCallError {
    ToolCallError {
        description: match &error {
            MessageError::Repository(_) => "The discussion operation could not be completed".into(),
            _ => error.to_string(),
        },
        internal_error: error.into(),
    }
}

/// Complete project comment and discussion lifecycle tools.
pub fn initiative_discussion_toolset<A: EntityAccessService>()
-> AsyncToolCollection<InitiativeDiscussionToolContext<A>> {
    AsyncToolCollection::new()
        .add_tool::<ReadInitiativeDiscussions, InitiativeDiscussionToolContext<A>>()
        .add_tool::<PostInitiativeComment, InitiativeDiscussionToolContext<A>>()
        .add_tool::<UpdateInitiativeComment, InitiativeDiscussionToolContext<A>>()
        .add_tool::<DeleteInitiativeComment, InitiativeDiscussionToolContext<A>>()
        .add_tool::<ReactToInitiativeComment, InitiativeDiscussionToolContext<A>>()
        .add_tool::<SetInitiativeDiscussionResolved, InitiativeDiscussionToolContext<A>>()
}
