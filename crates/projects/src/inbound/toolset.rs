//! Toolset inbound adapter for projects.

mod create_project;
mod duplicate_item;
mod entity_receipts;
mod move_to_project;
mod move_to_trash;
mod read_project;
mod rename_item;
mod update_sharing;

#[cfg(test)]
mod test;

use std::sync::Arc;

use ai_toolset::AsyncToolCollection;
use bot_id::BotId;
use entity_access::domain::ports::EntityAccessService;
use entity_mutation::{
    DuplicateEntity, MoveEntity, RenameEntity, TrashEntity, UpdateEntitySharePolicy,
};

use crate::domain::ports::ProjectService;

pub use create_project::{CreateProject, CreateProjectResponse};
pub use duplicate_item::{DuplicableEntityType, DuplicateItem, DuplicateItemResponse};
pub use move_to_project::{MoveToProject, MoveToProjectResponse, MoveableEntityType};
pub use move_to_trash::{MoveToTrash, MoveToTrashResponse, TrashableEntityType};
pub use read_project::{ProjectItem, ProjectItemType, ReadProject, ReadProjectResponse};
pub use rename_item::{RenameItem, RenameItemResponse, RenameableEntityType};
pub use update_sharing::{
    ShareAccess, ShareLinkScope, SharingChannel, SharingEntityType, UpdateSharing,
    UpdateSharingResponse,
};

/// The entity capabilities project tools dispatch projects to.
pub trait ProjectCapabilities:
    ProjectService + MoveEntity + RenameEntity + TrashEntity + UpdateEntitySharePolicy
{
}

impl<T> ProjectCapabilities for T where
    T: ProjectService + MoveEntity + RenameEntity + TrashEntity + UpdateEntitySharePolicy
{
}

/// The entity capabilities project tools dispatch documents to.
pub trait DocumentCapabilities:
    MoveEntity + TrashEntity + DuplicateEntity + UpdateEntitySharePolicy + Send + Sync + 'static
{
}

impl<T> DocumentCapabilities for T where
    T: MoveEntity + TrashEntity + DuplicateEntity + UpdateEntitySharePolicy + Send + Sync + 'static
{
}

/// Service context for project AI tools.
///
/// The document and email services are the per-domain entity-mutation
/// capability impls the move, trash, duplicate, rename, and sharing tools
/// dispatch to, mirroring the DSS entity-mutation router.
pub struct ProjectToolContext<PSvc, ESvc, DSvc, EmSvc>
where
    PSvc: ProjectCapabilities,
    ESvc: EntityAccessService,
    DSvc: DocumentCapabilities,
    EmSvc: MoveEntity + Send + Sync + 'static,
{
    /// The project service instance.
    pub service: Arc<PSvc>,
    /// The entity access service — used to mint access receipts.
    pub entity_access_service: Arc<ESvc>,
    /// Move, trash, duplicate, and sharing capabilities for documents.
    pub document_move_service: Arc<DSvc>,
    /// Move capability for email threads.
    pub email_move_service: Arc<EmSvc>,
    /// The bot these tools act as, on behalf of the requesting user. Defaults
    /// to Macro AI; hosts running a specific agent set it with [`Self::with_actor`].
    pub actor: BotId,
}

impl<PSvc, ESvc, DSvc, EmSvc> Clone for ProjectToolContext<PSvc, ESvc, DSvc, EmSvc>
where
    PSvc: ProjectCapabilities,
    ESvc: EntityAccessService,
    DSvc: DocumentCapabilities,
    EmSvc: MoveEntity + Send + Sync + 'static,
{
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            entity_access_service: self.entity_access_service.clone(),
            document_move_service: self.document_move_service.clone(),
            email_move_service: self.email_move_service.clone(),
            actor: self.actor,
        }
    }
}

impl<PSvc, ESvc, DSvc, EmSvc> ProjectToolContext<PSvc, ESvc, DSvc, EmSvc>
where
    PSvc: ProjectCapabilities,
    ESvc: EntityAccessService,
    DSvc: DocumentCapabilities,
    EmSvc: MoveEntity + Send + Sync + 'static,
{
    /// Create a new project tool context.
    pub fn new(
        service: Arc<PSvc>,
        entity_access_service: Arc<ESvc>,
        document_move_service: Arc<DSvc>,
        email_move_service: Arc<EmSvc>,
    ) -> Self {
        Self {
            service,
            entity_access_service,
            document_move_service,
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
pub fn project_toolset<PSvc, ESvc, DSvc, EmSvc>()
-> AsyncToolCollection<ProjectToolContext<PSvc, ESvc, DSvc, EmSvc>>
where
    PSvc: ProjectCapabilities,
    ESvc: EntityAccessService,
    DSvc: DocumentCapabilities,
    EmSvc: MoveEntity + Send + Sync + 'static,
{
    AsyncToolCollection::new()
        .add_tool::<CreateProject, ProjectToolContext<PSvc, ESvc, DSvc, EmSvc>>()
        .add_tool::<ReadProject, ProjectToolContext<PSvc, ESvc, DSvc, EmSvc>>()
        .add_tool::<MoveToProject, ProjectToolContext<PSvc, ESvc, DSvc, EmSvc>>()
        .add_tool::<MoveToTrash, ProjectToolContext<PSvc, ESvc, DSvc, EmSvc>>()
        .add_tool::<DuplicateItem, ProjectToolContext<PSvc, ESvc, DSvc, EmSvc>>()
        .add_tool::<RenameItem, ProjectToolContext<PSvc, ESvc, DSvc, EmSvc>>()
        .add_tool::<UpdateSharing, ProjectToolContext<PSvc, ESvc, DSvc, EmSvc>>()
}
