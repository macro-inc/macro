//! Writes a workspace import (folders, documents, tasks, databases) through
//! the same services the AI tools run on, as Macro AI for the user.

use crate::ToolEntityCreator;
use crate::tool_context::ImportedContent;
use databases::domain::models::{CreateDatabase, DatabaseDetail, DatabaseId, OpBatch, Viewer};
use databases::domain::ports::DatabasesService as _;
use databases::domain::receipt::database_receipt;
use databases::domain::sharing::DatabaseSharingService as _;
use documents::domain::models::DocumentError;
use documents::domain::notion_markdown::{NotionMarkdown, NotionPageLink, NotionUserLink};
use documents::domain::ports::DocumentService as _;
use entity_access::domain::models::{EditAccessLevel, OwnerAccessLevel, ViewAccessLevel};
use entity_access::domain::ports::EntityAccessService as _;
use import::domain::ports::{
    ImportedDocumentProperties, ImportedTaskProperties, NewDatabase, NotionLinks, SharedEntity,
    TeamMember,
};
use macro_user_id::user_id::MacroUserIdStr;
use model::project::request::{CreateProjectRequest, PatchProjectRequestV2};
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::access_level::AccessLevel;
use projects::domain::ports::ProjectService as _;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The import acts as Macro AI on the user's behalf, like the agent's tools.
fn viewer(user: &MacroUserIdStr<'static>) -> Viewer {
    Viewer {
        user_id: user.clone(),
        acting_bot: Some(bot_id::MACRO_AI_BOT_ID),
    }
}

/// Edit access for the owner's team, and nothing else changed.
fn team_share() -> UpdateSharePermissionRequestV2 {
    UpdateSharePermissionRequestV2 {
        link_share: None,
        link_share_access_level: None,
        team_share_access_level: Some(Some(AccessLevel::Edit)),
        channel_share_permissions: None,
    }
}

/// A Notion page body with the import's links, in the documents vocabulary.
pub(crate) fn notion_markdown(markdown: &str, links: &NotionLinks) -> NotionMarkdown {
    NotionMarkdown {
        markdown: markdown.to_string(),
        pages: links
            .pages
            .iter()
            .map(|(id, page)| {
                let page = NotionPageLink {
                    document_id: page.document_id,
                    name: page.name.clone(),
                };
                (id.as_str().to_string(), page)
            })
            .collect(),
        users: links
            .users
            .iter()
            .map(|(id, user)| {
                let user = NotionUserLink {
                    user_id: user.user_id.as_ref().to_string(),
                    email: user.email.clone(),
                };
                (id.as_str().to_string(), user)
            })
            .collect(),
    }
}

/// A document or task the import names by id that exists already was made
/// by an interrupted earlier attempt: it stands, as the starter documents'
/// retries treat it.
pub(crate) fn already_created(created: anyhow::Result<String>, id: Uuid) -> anyhow::Result<String> {
    match created {
        Err(error)
            if matches!(
                error.downcast_ref::<DocumentError>(),
                Some(DocumentError::Conflict(_))
            ) =>
        {
            tracing::info!(document_id = %id, "imported document already exists");
            Ok(id.to_string())
        }
        other => other,
    }
}

/// The starter table a new database comes with and its title column, the
/// only column that table starts with.
fn new_database(detail: &DatabaseDetail) -> anyhow::Result<NewDatabase> {
    let database_id = *detail.database.id.as_uuid();
    let Some(table) = detail.tables.first() else {
        anyhow::bail!("new database {database_id} has no table");
    };
    let Some(title_column) = table.columns.first() else {
        anyhow::bail!("new database {database_id}'s starter table has no column");
    };
    Ok(NewDatabase {
        database_id,
        table: table.table.id,
        title_column: title_column.column.id,
    })
}

impl import::domain::ports::WorkspaceWriter for ToolEntityCreator {
    async fn create_tracker_project(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        name: &str,
        markdown: &str,
        shared: bool,
    ) -> anyhow::Result<Uuid> {
        self.create_tracker_project_impl(user, id, name, markdown, shared)
            .await
    }
    async fn create_tracker_task(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        name: &str,
        markdown: &str,
        properties: &ImportedTaskProperties,
        shared: bool,
    ) -> anyhow::Result<String> {
        self.create_tracker_task_impl(user, id, name, markdown, properties, shared)
            .await
    }
    async fn link_tracker_task(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        relations: &import::domain::ports::TrackerTaskRelations,
    ) -> anyhow::Result<()> {
        self.link_tracker_task_impl(user, id, relations).await
    }

    #[tracing::instrument(skip(self, user, name), err)]
    async fn create_folder(
        &self,
        user: &MacroUserIdStr<'static>,
        name: &str,
        parent: Option<Uuid>,
    ) -> anyhow::Result<Uuid> {
        // Mirrors the CreateProject tool: creating inside a parent requires
        // edit access to it.
        if let Some(parent) = parent {
            self.authorize_folder(user, parent).await?;
        }
        let project = self
            .project_service
            .create_project(
                &Self::creation_principal(user),
                CreateProjectRequest {
                    name: name.to_string(),
                    project_parent_id: parent,
                },
            )
            .await
            .map_err(|error| anyhow::anyhow!("failed to create imported folder: {error:?}"))?;
        Ok(project.id.parse()?)
    }

    #[tracing::instrument(skip(self, user, name, notion_markdown, links, properties), err)]
    async fn create_document(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        name: &str,
        notion_markdown: &str,
        links: &NotionLinks,
        properties: &ImportedDocumentProperties,
        folder: Option<Uuid>,
    ) -> anyhow::Result<String> {
        let created = self
            .create_imported_document(
                user,
                Some(id),
                name,
                self::notion_markdown(notion_markdown, links),
                properties,
                folder,
            )
            .await;
        already_created(created, id)
    }

    #[tracing::instrument(skip(self, user, name, notion_markdown, links, properties), err)]
    async fn create_task(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        name: &str,
        notion_markdown: &str,
        links: &NotionLinks,
        properties: &ImportedTaskProperties,
        folder: Option<Uuid>,
    ) -> anyhow::Result<String> {
        let created = self
            .create_imported_task(
                user,
                Some(id),
                name,
                ImportedContent::Notion(self::notion_markdown(notion_markdown, links)),
                properties,
                folder,
                // A shared task list shares its folder, which reaches its tasks.
                false,
            )
            .await;
        already_created(created, id)
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn folder_exists(
        &self,
        user: &MacroUserIdStr<'static>,
        folder: Uuid,
    ) -> anyhow::Result<bool> {
        let Ok(receipt) = self
            .entity_access_service
            .generate_entity_access_receipt::<ViewAccessLevel>(
                user,
                None,
                &folder.to_string(),
                model_entity::EntityType::Project,
            )
            .await
        else {
            return Ok(false);
        };
        match self.project_service.get_project(receipt).await {
            Ok(project) => Ok(project.project_metadata.deleted_at.is_none()),
            Err(error) => {
                tracing::warn!(error = ?error, %folder, "imported root folder was not read");
                Ok(false)
            }
        }
    }

    #[tracing::instrument(skip(self, user, name), err)]
    async fn create_database(
        &self,
        user: &MacroUserIdStr<'static>,
        name: &str,
    ) -> anyhow::Result<NewDatabase> {
        let viewer = viewer(user);
        let database = self
            .databases_service
            .create_database(CreateDatabase {
                name: name.to_string(),
                owner_id: user.clone(),
                acting_bot: viewer.acting_bot,
            })
            .await?;
        let receipt = database_receipt::<ViewAccessLevel, _>(
            self.entity_access_service.as_ref(),
            &viewer,
            database.id,
        )
        .await
        .map_err(|error| {
            anyhow::anyhow!("no view access to new database {}: {error:?}", database.id)
        })?;
        let detail = self.databases_service.get_database(receipt).await?;
        new_database(&detail)
    }

    #[tracing::instrument(skip(self, user, ops), fields(op_count = ops.len()), err)]
    async fn apply_database_ops(
        &self,
        user: &MacroUserIdStr<'static>,
        database_id: Uuid,
        ops: Vec<models_databases::DatabaseOp>,
    ) -> anyhow::Result<Vec<models_databases::OpResult>> {
        let viewer = viewer(user);
        let receipt = database_receipt::<EditAccessLevel, _>(
            self.entity_access_service.as_ref(),
            &viewer,
            DatabaseId::from_uuid(database_id),
        )
        .await
        .map_err(|error| anyhow::anyhow!("no edit access to database {database_id}: {error:?}"))?;
        Ok(self
            .databases_service
            .apply_ops(receipt, viewer, OpBatch::from(ops))
            .await?)
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn share_with_team(
        &self,
        user: &MacroUserIdStr<'static>,
        entity: SharedEntity,
    ) -> anyhow::Result<()> {
        match entity {
            SharedEntity::Folder(folder) => {
                let receipt = self
                    .entity_access_service
                    .generate_entity_access_receipt::<EditAccessLevel>(
                        user,
                        None,
                        &folder.to_string(),
                        model_entity::EntityType::Project,
                    )
                    .await
                    .map_err(|error| {
                        anyhow::anyhow!("no edit access to folder {folder}: {error:?}")
                    })?;
                let project = self
                    .project_service
                    .internal_get_basic_project(&folder.to_string())
                    .await
                    .map_err(|error| {
                        anyhow::anyhow!("imported folder {folder} was not read: {error:?}")
                    })?;
                self.project_service
                    .edit_project(
                        receipt,
                        project,
                        PatchProjectRequestV2 {
                            name: None,
                            project_parent_id: None,
                            share_permission: Some(team_share()),
                        },
                    )
                    .await
                    .map_err(|error| {
                        anyhow::anyhow!("imported folder {folder} was not shared: {error:?}")
                    })
            }
            SharedEntity::Document(document) => {
                let receipt = self
                    .entity_access_service
                    .generate_entity_access_receipt::<EditAccessLevel>(
                        user,
                        None,
                        &document.to_string(),
                        model_entity::EntityType::Document,
                    )
                    .await
                    .map_err(|error| {
                        anyhow::anyhow!("no edit access to document {document}: {error:?}")
                    })?;
                self.document_service
                    .set_team_share(receipt, true)
                    .await
                    .map_err(|error| {
                        anyhow::anyhow!("imported document {document} was not shared: {error:?}")
                    })?;
                Ok(())
            }
            SharedEntity::Database(database) => {
                let receipt = self
                    .entity_access_service
                    .generate_entity_access_receipt::<OwnerAccessLevel>(
                        user,
                        None,
                        &database.to_string(),
                        model_entity::EntityType::Database,
                    )
                    .await
                    .map_err(|error| {
                        anyhow::anyhow!("no owner access to database {database}: {error:?}")
                    })?;
                self.databases_service
                    .update_share_permissions(receipt, team_share())
                    .await
                    .map_err(|error| {
                        anyhow::anyhow!("imported database {database} was not shared: {error:?}")
                    })?;
                Ok(())
            }
        }
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn team_members(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> anyhow::Result<Vec<TeamMember>> {
        let (_, roster) = self.team_roster(user).await;
        Ok(roster
            .into_iter()
            .map(|user_id| TeamMember {
                // User ids are lowercased when parsed, so their email is too.
                email: user_id.email_str().to_string(),
                user_id,
            })
            .collect())
    }
}
