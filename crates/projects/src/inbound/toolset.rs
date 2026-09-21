//! Toolset inbound adapter for projects.

mod create_project;
mod move_to_project;
mod read_project;

#[cfg(test)]
mod test;

use std::sync::Arc;

use ai_toolset::AsyncToolCollection;
use bot_id::BotId;
use entity_access::domain::ports::EntityAccessService;
use entity_mutation::MoveEntity;

use crate::domain::ports::ProjectService;

pub use create_project::{CreateProject, CreateProjectResponse};
pub use move_to_project::{MoveToProject, MoveToProjectResponse, MoveableEntityType};
pub use read_project::{ProjectItem, ProjectItemType, ReadProject, ReadProjectResponse};

/// Service context for project AI tools.
///
/// The move services are the per-domain [`MoveEntity`] capability impls the
/// `MoveToProject` tool dispatches to, mirroring the DSS entity-mutation
/// router.
pub struct ProjectToolContext<PSvc, ESvc, DSvc, CSvc, EmSvc>
where
    PSvc: ProjectService + MoveEntity,
    ESvc: EntityAccessService,
    DSvc: MoveEntity + Send + Sync + 'static,
    CSvc: MoveEntity + Send + Sync + 'static,
    EmSvc: MoveEntity + Send + Sync + 'static,
{
    /// The project service instance.
    pub service: Arc<PSvc>,
    /// The entity access service — used to mint access receipts.
    pub entity_access_service: Arc<ESvc>,
    /// Move capability for documents.
    pub document_move_service: Arc<DSvc>,
    /// Move capability for AI chats.
    pub chat_move_service: Arc<CSvc>,
    /// Move capability for email threads.
    pub email_move_service: Arc<EmSvc>,
    /// The bot these tools act as, on behalf of the requesting user. Defaults
    /// to Macro AI; hosts running a specific agent set it with [`Self::with_actor`].
    pub actor: BotId,
}

impl<PSvc, ESvc, DSvc, CSvc, EmSvc> Clone for ProjectToolContext<PSvc, ESvc, DSvc, CSvc, EmSvc>
where
    PSvc: ProjectService + MoveEntity,
    ESvc: EntityAccessService,
    DSvc: MoveEntity + Send + Sync + 'static,
    CSvc: MoveEntity + Send + Sync + 'static,
    EmSvc: MoveEntity + Send + Sync + 'static,
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            document_move_service: self.document_move_service.clone(),
            chat_move_service: self.chat_move_service.clone(),
            email_move_service: self.email_move_service.clone(),
            actor: self.actor,
        }
    }
}

impl<PSvc, ESvc, DSvc, CSvc, EmSvc> ProjectToolContext<PSvc, ESvc, DSvc, CSvc, EmSvc>
where
    PSvc: ProjectService + MoveEntity,
    ESvc: EntityAccessService,
    DSvc: MoveEntity + Send + Sync + 'static,
    CSvc: MoveEntity + Send + Sync + 'static,
    EmSvc: MoveEntity + Send + Sync + 'static,
{
    /// Create a new project tool context.
    pub fn new(
        service: Arc<PSvc>,
        entity_access_service: Arc<ESvc>,
        document_move_service: Arc<DSvc>,
        chat_move_service: Arc<CSvc>,
        email_move_service: Arc<EmSvc>,
    ) -> Self {
        Self {
            service,
            entity_access_service,
            document_move_service,
            chat_move_service,
            email_move_service,
            actor: bot_id::MACRO_AI_BOT_ID,
        }
    }

    /// Set the bot these tools act as.
    pub fn with_actor(mut self, actor: BotId) -> Self {
        self.actor = actor;
        self
    }
}

/// Create a project toolset.
pub fn project_toolset<PSvc, ESvc, DSvc, CSvc, EmSvc>()
-> AsyncToolCollection<ProjectToolContext<PSvc, ESvc, DSvc, CSvc, EmSvc>>
where
    PSvc: ProjectService + MoveEntity,
    ESvc: EntityAccessService,
    DSvc: MoveEntity + Send + Sync + 'static,
    CSvc: MoveEntity + Send + Sync + 'static,
    EmSvc: MoveEntity + Send + Sync + 'static,
{
    AsyncToolCollection::new()
        .add_tool::<CreateProject, ProjectToolContext<PSvc, ESvc, DSvc, CSvc, EmSvc>>()
        .add_tool::<ReadProject, ProjectToolContext<PSvc, ESvc, DSvc, CSvc, EmSvc>>()
        .add_tool::<MoveToProject, ProjectToolContext<PSvc, ESvc, DSvc, CSvc, EmSvc>>()
}
