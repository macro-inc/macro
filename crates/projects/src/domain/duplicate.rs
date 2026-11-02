//! Folder duplication: copy a project's live subtree for the requesting user.
//!
//! The copy is a new project owned by the user, named after the source (or
//! the requested name) and placed beside the source when the user may add to
//! its parent, otherwise at the top level. Subfolders are recreated, and
//! documents and chats are duplicated by their own domains through
//! [`ProjectContentCopier`]. Entries the user cannot view are skipped, with
//! everything inside a skipped folder. Email threads are only linked into a
//! folder, not owned by it, so they are left out. A failure part way discards
//! the whole copy, so no partial copy survives.

#[cfg(test)]
mod test;

use std::collections::HashMap;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use entity_access::domain::models::{EntityAccessReceipt, ViewAccessLevel};
use entity_mutation::{DuplicateEntity, EntityMutationEffect, EntityMutationErrorCode};
use futures::stream::{self, StreamExt};
use macro_user_id::user_id::MacroUserIdStr;
use model::project::request::CreateProjectRequest;
use model_entity::{Entity, EntityType};
use model_owner::{CreationPrincipal, Owner};
use shared_entity_registry::{OwnedPurgeOutcome, PurgeOwnedEntity};
use tracing::Instrument;
use uuid::Uuid;

use super::models::{ProjectItemKind, ProjectTreeFolder, ProjectTreeItem};
use super::ports::{ProjectContentCopier, ProjectService};

/// Most subfolders, documents, and chats one duplication copies. The copy
/// runs inside one entity-mutation request, so it gets the budget of the most
/// entities such a request may name.
pub const MAX_PROJECT_DUPLICATE_ENTRIES: usize = 100;

/// Documents and chats one duplication copies at once. Low because the
/// mutation router already runs several requested entities concurrently.
const MAX_CONCURRENT_ITEM_COPIES: usize = 4;

/// Duplicates projects: the project service paired with what it borrows from
/// other domains to copy a folder's documents and chats.
pub struct ProjectDuplicator<P, C> {
    projects: Arc<P>,
    contents: C,
}

impl<P, C> ProjectDuplicator<P, C> {
    /// Pair the project service with the user's content copier.
    pub fn new(projects: Arc<P>, contents: C) -> Self {
        Self { projects, contents }
    }
}

/// Counts of what one duplication copied and skipped.
#[derive(Default)]
struct CopiedEntries {
    folders: usize,
    documents: usize,
    chats: usize,
    skipped: usize,
}

/// What became of one document or chat.
enum ItemOutcome {
    Copied(ProjectItemKind),
    Skipped,
    /// Not started because another copy had already failed.
    NotAttempted,
}

fn invalid_id(error: uuid::Error) -> EntityMutationErrorCode {
    EntityMutationErrorCode::internal(rootcause::report!(error))
}

impl<P, C> ProjectDuplicator<P, C>
where
    P: ProjectService + PurgeOwnedEntity,
    C: ProjectContentCopier,
{
    /// Create one folder of the copy, returning its id.
    async fn create_folder(
        &self,
        principal: &CreationPrincipal,
        name: String,
        parent_id: Option<&str>,
    ) -> Result<String, EntityMutationErrorCode> {
        let project_parent_id = parent_id
            .map(Uuid::parse_str)
            .transpose()
            .map_err(invalid_id)?;
        let project = self
            .projects
            .create_project(
                principal,
                CreateProjectRequest {
                    name,
                    project_parent_id,
                },
            )
            .await?;
        Ok(project.id)
    }

    /// Recreate the subfolders, parents first, recording each copy's id
    /// under its source's id.
    #[tracing::instrument(
        name = "project.duplicate.copy_folders",
        skip_all,
        fields(project.folder_count = folders.len()),
        err(Debug)
    )]
    async fn copy_folders(
        &self,
        principal: &CreationPrincipal,
        folders: Vec<ProjectTreeFolder>,
        copies: &mut HashMap<String, String>,
        copied: &mut CopiedEntries,
    ) -> Result<(), EntityMutationErrorCode> {
        for folder in folders {
            let Some(parent_id) = copies.get(&folder.parent_id).cloned() else {
                copied.skipped += 1;
                continue;
            };
            let entity = EntityType::Project.with_entity_string(folder.id.clone());
            if self.contents.view_receipt(&entity).await?.is_none() {
                copied.skipped += 1;
                continue;
            }
            let copy_id = self
                .create_folder(principal, folder.name, Some(&parent_id))
                .await?;
            copies.insert(folder.id, copy_id);
            copied.folders += 1;
        }
        Ok(())
    }

    /// Copy one document or chat into the copy of its folder.
    async fn copy_item(
        &self,
        item: ProjectTreeItem,
        copies: &HashMap<String, String>,
    ) -> Result<ItemOutcome, EntityMutationErrorCode> {
        let Some(project_id) = copies.get(&item.project_id) else {
            return Ok(ItemOutcome::Skipped);
        };
        let Some(receipt) = self.contents.view_receipt(&item.entity()).await? else {
            return Ok(ItemOutcome::Skipped);
        };
        self.contents
            .copy_into_project(receipt, item.name, project_id)
            .await?;
        Ok(ItemOutcome::Copied(item.kind))
    }

    /// Copy the documents and chats a few at a time. After a failure no new
    /// copy starts, but every started copy settles before this returns, so
    /// discarding the folder tree afterwards catches all of them.
    #[tracing::instrument(
        name = "project.duplicate.copy_items",
        skip_all,
        fields(project.item_count = items.len()),
        err(Debug)
    )]
    async fn copy_items(
        &self,
        items: Vec<ProjectTreeItem>,
        copies: &HashMap<String, String>,
        copied: &mut CopiedEntries,
    ) -> Result<(), EntityMutationErrorCode> {
        let failed = AtomicBool::new(false);
        let outcomes: Vec<_> = stream::iter(items)
            .map(|item| {
                let failed = &failed;
                async move {
                    if failed.load(Ordering::Acquire) {
                        return Ok(ItemOutcome::NotAttempted);
                    }
                    let outcome = self.copy_item(item, copies).await;
                    if outcome.is_err() {
                        failed.store(true, Ordering::Release);
                    }
                    outcome
                }
            })
            .buffer_unordered(MAX_CONCURRENT_ITEM_COPIES)
            .collect()
            .await;
        for outcome in outcomes {
            match outcome? {
                ItemOutcome::Copied(ProjectItemKind::Document) => copied.documents += 1,
                ItemOutcome::Copied(ProjectItemKind::Chat) => copied.chats += 1,
                ItemOutcome::Skipped => copied.skipped += 1,
                ItemOutcome::NotAttempted => {}
            }
        }
        Ok(())
    }

    /// Permanently delete a partial copy and everything filed in it.
    #[tracing::instrument(name = "project.duplicate.discard", skip(self, owner))]
    async fn discard(&self, copy_id: &str, owner: MacroUserIdStr<'static>) {
        let copy = match Uuid::parse_str(copy_id) {
            Ok(copy) => copy,
            Err(error) => {
                tracing::error!(error = ?error, "unable to discard partial project copy");
                return;
            }
        };
        match self.projects.purge_owned(copy, &Owner::User(owner)).await {
            Ok(OwnedPurgeOutcome::Purged) => {}
            Ok(OwnedPurgeOutcome::OwnedElsewhere) => {
                tracing::error!("partial project copy has another owner; left in place");
            }
            Err(error) => {
                tracing::error!(error = ?error, "unable to discard partial project copy");
            }
        }
    }
}

impl<P, C> DuplicateEntity for ProjectDuplicator<P, C>
where
    P: ProjectService + PurgeOwnedEntity,
    C: ProjectContentCopier,
{
    type Receipt = ViewAccessLevel;

    #[tracing::instrument(
        name = "project.duplicate",
        skip_all,
        fields(
            project.source_id = %entity.entity_id,
            project.copy_id = tracing::field::Empty,
            project.folders_copied = tracing::field::Empty,
            project.documents_copied = tracing::field::Empty,
            project.chats_copied = tracing::field::Empty,
            project.entries_skipped = tracing::field::Empty,
        ),
        err(Debug)
    )]
    async fn duplicate_entity(
        &self,
        entity: Entity<'static>,
        receipt: EntityAccessReceipt<Self::Receipt>,
        user_id: MacroUserIdStr<'static>,
        display_name: Option<String>,
    ) -> Result<Vec<EntityMutationEffect>, EntityMutationErrorCode> {
        let source = self
            .projects
            .internal_get_basic_project(&entity.entity_id)
            .await?;
        if source.deleted_at.is_some() {
            return Err(EntityMutationErrorCode::invalid(rootcause::report!(
                "cannot duplicate a deleted project".to_string()
            )));
        }
        let tree = self
            .projects
            .get_project_tree(receipt, MAX_PROJECT_DUPLICATE_ENTRIES + 1)
            .instrument(tracing::info_span!("project.duplicate.load_tree"))
            .await?;
        if tree.folders.len() + tree.items.len() > MAX_PROJECT_DUPLICATE_ENTRIES {
            return Err(EntityMutationErrorCode::invalid(rootcause::report!(
                format!(
                    "projects with more than {MAX_PROJECT_DUPLICATE_ENTRIES} folders, documents, and chats cannot be duplicated"
                )
            )));
        }

        let parent_id = match source.parent_id {
            Some(parent_id) if self.contents.can_add_to_project(&parent_id).await? => {
                Some(parent_id)
            }
            Some(_) | None => None,
        };
        let principal = CreationPrincipal::User(user_id.clone());
        let name = display_name.unwrap_or_else(|| format!("{} copy", source.name));
        let copy_id = self
            .create_folder(&principal, name, parent_id.as_deref())
            .await?;
        let span = tracing::Span::current();
        span.record("project.copy_id", copy_id.as_str());

        let mut copied = CopiedEntries::default();
        let mut copies = HashMap::from([(source.id, copy_id.clone())]);
        let result = async {
            self.copy_folders(&principal, tree.folders, &mut copies, &mut copied)
                .await?;
            self.copy_items(tree.items, &copies, &mut copied).await
        }
        .await;
        span.record("project.folders_copied", copied.folders);
        span.record("project.documents_copied", copied.documents);
        span.record("project.chats_copied", copied.chats);
        span.record("project.entries_skipped", copied.skipped);
        if let Err(error) = result {
            self.discard(&copy_id, user_id).await;
            return Err(error);
        }

        Ok(vec![EntityMutationEffect::updated(
            EntityType::Project.with_entity_string(copy_id),
        )])
    }
}
