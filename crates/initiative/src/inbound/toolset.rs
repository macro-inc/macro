//! Workflow tools for projects (the initiative domain), separate from folder tools.

mod lifecycle;
mod reads;
mod sharing;
mod tasks;
mod types;

pub use lifecycle::{CreateInitiative, DeleteInitiative, UpdateInitiative};
pub use reads::{ListInitiatives, ReadInitiative, ReadInitiativeActivity, ReadTaskInitiatives};
pub use sharing::UpdateInitiativeSharing;
pub use tasks::SetTaskInitiative;
pub use types::*;

use std::sync::Arc;

use crate::domain::{
    history::InitiativeHistory, models::InitiativeError, ports::InitiativeService,
    resources::InitiativeResources,
};
use activity::domain::ports::EntityActivityReads;
use ai_toolset::{AsyncToolCollection, RequestContext, ToolCallError, ToolResult};
use bot_id::BotId;
use entity_access::domain::{
    models::{BotAccessScope, EntityAccessReceipt, EntityType, RequiredPermission},
    ports::EntityAccessService,
};

/// Domain services shared by every project tool.
pub struct InitiativeToolContext<S, A, R> {
    /// Project lifecycle and read application service.
    pub service: Arc<S>,
    /// Capability issuer; task capabilities retain the same bot and user scope.
    pub access: Arc<A>,
    /// Authorized project activity history.
    pub history: Arc<InitiativeHistory<R, A>>,
    /// Canonical properties, under the same verified project capability.
    pub resources: Arc<dyn InitiativeResources>,
    /// Bot responsible for tool mutations.
    pub actor: BotId,
}

impl<S, A, R> Clone for InitiativeToolContext<S, A, R> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            access: self.access.clone(),
            history: self.history.clone(),
            resources: self.resources.clone(),
            actor: self.actor,
        }
    }
}

impl<S, A, R> InitiativeToolContext<S, A, R> {
    /// Select the agent performing delegated changes.
    pub fn with_actor(mut self, actor: BotId) -> Self {
        self.actor = actor;
        self
    }
}

impl<S, A: EntityAccessService, R> InitiativeToolContext<S, A, R> {
    async fn receipt<T: RequiredPermission>(
        &self,
        request: &RequestContext,
        id: &str,
        entity_type: EntityType,
    ) -> ToolResult<EntityAccessReceipt<T>> {
        self.access
            .generate_bot_entity_access_receipt::<T>(
                self.actor,
                BotAccessScope::user(request.user_id.clone()),
                id,
                entity_type,
            )
            .await
            .map_err(|error| ToolCallError {
                description: "The item is unavailable or you do not have the required permission"
                    .into(),
                internal_error: error.into(),
            })
    }
}

fn failure(error: InitiativeError) -> ToolCallError {
    ToolCallError {
        description: match &error {
            InitiativeError::BadRequest(message) | InitiativeError::Conflict(message) => {
                message.clone()
            }
            InitiativeError::Unauthorized => {
                "You do not have permission to perform this project operation".into()
            }
            InitiativeError::NotFound => "The project is unavailable".into(),
            _ => "The project operation failed".into(),
        },
        internal_error: error.into(),
    }
}

/// Complete project lifecycle, sharing, membership and history toolset.
pub fn initiative_toolset<S: InitiativeService, A: EntityAccessService, R: EntityActivityReads>()
-> AsyncToolCollection<InitiativeToolContext<S, A, R>> {
    AsyncToolCollection::new()
        .add_tool::<ListInitiatives, InitiativeToolContext<S, A, R>>()
        .add_tool::<ReadInitiative, InitiativeToolContext<S, A, R>>()
        .add_tool::<CreateInitiative, InitiativeToolContext<S, A, R>>()
        .add_tool::<UpdateInitiative, InitiativeToolContext<S, A, R>>()
        .add_tool::<DeleteInitiative, InitiativeToolContext<S, A, R>>()
        .add_tool::<UpdateInitiativeSharing, InitiativeToolContext<S, A, R>>()
        .add_tool::<SetTaskInitiative, InitiativeToolContext<S, A, R>>()
        .add_tool::<ReadTaskInitiatives, InitiativeToolContext<S, A, R>>()
        .add_tool::<ReadInitiativeActivity, InitiativeToolContext<S, A, R>>()
}
