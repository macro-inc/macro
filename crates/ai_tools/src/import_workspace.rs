//! Writes a workspace import (folders, documents, tasks, databases) through
//! the same services the AI tools run on, as Macro AI for the user.

use crate::ToolEntityCreator;
use crate::tool_context::ImportedContent;
use databases::domain::models::{
    CreateDatabase, DatabaseDetail, DatabaseError, DatabaseId, OpBatch, Viewer,
};
use databases::domain::ports::{DatabasesProjectService as _, DatabasesService as _};
use databases::domain::receipt::database_receipt;
use databases::domain::sharing::DatabaseSharingService as _;
use documents::domain::models::DocumentError;
use documents::domain::notion_markdown::{NotionMarkdown, NotionPageLink, NotionUserLink};
use documents::domain::ports::DocumentService as _;
use entity_access::domain::models::{EditAccessLevel, OwnerAccessLevel, ViewAccessLevel};
use entity_access::domain::ports::EntityAccessService as _;
use import::domain::ports::{
    CreatedImportDocument, DatabaseWriteFailure, ImportedDocumentProperties, ImportedLinkBody,
    ImportedTarget, ImportedTaskProperties, NewDatabase, NotionLinkDestination,
    NotionLinkReference, NotionLinks, SharedEntity, SourceDates, TeamMember,
};
use macro_user_id::user_id::MacroUserIdStr;
use model::project::request::{CreateProjectRequest, PatchProjectRequestV2};
use models_permissions::share_permission::UpdateSharePermissionRequestV2;
use models_permissions::share_permission::access_level::AccessLevel;
use projects::domain::ports::ProjectService as _;
use uuid::Uuid;

mod lifecycle;

/// Host services for reading and committing an import-owned hyperlink revision.
#[derive(Clone)]
pub struct NotionLinkEditor {
    lexical: std::sync::Arc<lexical_client::LexicalClient>,
    sync: sync_service_client::SyncServiceClient,
    jwt_secret: String,
}

fn revision_receipt(revision: &[u8]) -> Uuid {
    Uuid::new_v5(&Uuid::NAMESPACE_OID, revision)
}

impl NotionLinkEditor {
    /// Use the same lexical and sync services as normal document creation.
    pub fn new(
        lexical: std::sync::Arc<lexical_client::LexicalClient>,
        sync: sync_service_client::SyncServiceClient,
        jwt_secret: String,
    ) -> Self {
        Self {
            lexical,
            sync,
            jwt_secret,
        }
    }

    pub(crate) async fn initial_revision(&self, snapshot: &[u8]) -> Option<Uuid> {
        if snapshot.len() > sync_service_client::document_state::MAX_DOCUMENT_BINARY_BYTES {
            return None;
        }
        let result = self.lexical.notion_link_delta(snapshot, &[]).await;
        match result {
            Ok(delta) if !delta.references.is_empty() => {
                delta.revision_bytes().ok().as_deref().map(revision_receipt)
            }
            Ok(_) => None,
            Err(_) => {
                tracing::warn!("could not inspect the initial Notion document revision");
                None
            }
        }
    }

    async fn owner_token(
        &self,
        creator: &ToolEntityCreator,
        user: &MacroUserIdStr<'static>,
        document: Uuid,
    ) -> anyhow::Result<sync_service_client::document_state::DocumentPermissionToken> {
        let receipt = creator
            .entity_access_service
            .generate_entity_access_receipt::<OwnerAccessLevel>(
                user,
                None,
                &document.to_string(),
                model_entity::EntityType::Document,
            )
            .await?;
        Ok(
            documents::domain::permission_token::encode_receipt_permission_token(
                &receipt,
                AccessLevel::Owner,
                &self.jwt_secret,
            )?,
        )
    }
}

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
        databases: links
            .databases
            .iter()
            .map(|occurrence| {
                use documents::domain::notion_markdown::{
                    NotionDatabaseFallback as Fallback, NotionDatabaseOccurrence,
                    NotionDatabaseTarget as Target,
                };
                use import::domain::ports::{
                    NotionDatabaseFallback as Reason, NotionDatabaseTarget as Source,
                };
                let target = match &occurrence.target {
                    Source::Resolved {
                        database_id,
                        table_id,
                        view_id,
                    } => Target::Resolved {
                        database_id: *database_id,
                        table_id: table_id.into_uuid(),
                        view_id: view_id.map(|id| id.into_uuid()),
                    },
                    Source::Fallback(reason) => Target::Fallback {
                        reason: match reason {
                            Reason::NoAccess => Fallback::NoAccess,
                            Reason::NotFound => Fallback::NotFound,
                            Reason::NotImported => Fallback::NotImported,
                            Reason::Unresolved => Fallback::Unresolved,
                        },
                    },
                };
                NotionDatabaseOccurrence {
                    container_id: occurrence.container_id.to_string(),
                    ordinal: occurrence.ordinal,
                    target,
                }
            })
            .collect(),
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
    let ids = databases::domain::models::FirstTableIds::for_database(detail.database.id);
    let Some(table) = detail
        .tables
        .iter()
        .find(|entry| entry.table.id == ids.table)
    else {
        return Err(DatabaseWriteFailure::MissingStarterTable.into());
    };
    let Some(title_column) = table
        .columns
        .iter()
        .find(|entry| entry.column.id == ids.title_column)
    else {
        return Err(DatabaseWriteFailure::MissingTitleColumn.into());
    };
    Ok(NewDatabase {
        database_id,
        table: table.table.id,
        title_column: title_column.column.id,
    })
}

impl import::domain::ports::ImportedTargetReader for ToolEntityCreator {
    #[tracing::instrument(skip(self), err)]
    async fn target_exists(&self, target: ImportedTarget) -> anyhow::Result<bool> {
        lifecycle::exists(
            self.document_service.as_ref(),
            self.project_service.as_ref(),
            self.databases_service.as_ref(),
            self.initiative_service.as_ref(),
            target,
        )
        .await
    }
}

impl import::domain::ports::WorkspaceWriter for ToolEntityCreator {
    async fn create_tracker_project(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        name: &str,
        markdown: &str,
        visibility: import::domain::ports::ImportVisibility,
    ) -> anyhow::Result<Uuid> {
        self.create_tracker_project_impl(user, id, name, markdown, visibility)
            .await
    }
    async fn create_tracker_task(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        name: &str,
        markdown: &str,
        properties: &ImportedTaskProperties,
        visibility: import::domain::ports::ImportVisibility,
    ) -> anyhow::Result<import::domain::ports::CreatedImportTask> {
        self.create_tracker_task_impl(user, id, name, markdown, properties, visibility)
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
        visibility: import::domain::ports::ImportVisibility,
    ) -> anyhow::Result<Uuid> {
        // Mirrors the CreateProject tool: creating inside a parent requires
        // edit access to it.
        if let Some(parent) = parent {
            self.authorize_folder(user, parent)
                .await
                .map_err(|_| DatabaseWriteFailure::FolderUnavailable)?;
        }
        let project = self
            .project_service
            .create_project_dated_by_contents(
                &Self::creation_principal(user),
                CreateProjectRequest {
                    name: name.to_string(),
                    project_parent_id: parent,
                },
                crate::tool_context::imported_link_share(visibility),
            )
            .await
            .map_err(|_| DatabaseWriteFailure::FolderUnavailable)?;
        Ok(project
            .id
            .parse()
            .map_err(|_| DatabaseWriteFailure::FolderUnavailable)?)
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
        dates: Option<SourceDates>,
        visibility: import::domain::ports::ImportVisibility,
    ) -> anyhow::Result<CreatedImportDocument> {
        let created = self
            .create_imported_document(
                user,
                Some(id),
                name,
                self::notion_markdown(notion_markdown, links),
                properties,
                folder,
                dates,
                visibility,
            )
            .await;
        match created {
            Ok(document) => Ok(document),
            Err(error) => Ok(CreatedImportDocument {
                id: already_created(Err(error), id)?,
                link_revision: None,
            }),
        }
    }

    async fn owns_notion_link_target(
        &self,
        user: &MacroUserIdStr<'static>,
        target: ImportedTarget,
    ) -> anyhow::Result<bool> {
        use model_entity::EntityType;
        let (id, kind) = match target {
            ImportedTarget::Document(id) => (id, EntityType::Document),
            ImportedTarget::Database(id) => (id, EntityType::Database),
            _ => return Ok(false),
        };
        match self
            .entity_access_service
            .generate_entity_access_receipt::<OwnerAccessLevel>(user, None, &id.to_string(), kind)
            .await
        {
            Ok(_) => Ok(true),
            Err(error) if crate::tool_context::refuses_view(&error) => Ok(false),
            Err(error) => Err(error.into()),
        }
    }

    #[tracing::instrument(skip_all, fields(document), err)]
    async fn inspect_import_links(
        &self,
        user: &MacroUserIdStr<'static>,
        document: Uuid,
        receipt: Uuid,
    ) -> anyhow::Result<Option<ImportedLinkBody>> {
        let Some(editor) = &self.notion_link_editor else {
            return Ok(None);
        };
        let token = editor.owner_token(self, user, document).await?;
        let state = editor
            .sync
            .document_state(&document.to_string(), &token)
            .await?;
        if revision_receipt(&state.revision) != receipt {
            return Ok(None);
        }
        let parsed = editor
            .lexical
            .notion_link_delta(&state.snapshot, &[])
            .await?;
        Ok(Some(ImportedLinkBody {
            snapshot: state.snapshot,
            revision: state.revision,
            references: parsed
                .references
                .into_iter()
                .filter_map(|source| {
                    Some(NotionLinkReference {
                        id: source.id.try_into().ok()?,
                        view_id: match source.view_id {
                            Some(id) => Some(id.try_into().ok()?),
                            None => None,
                        },
                    })
                })
                .collect(),
        }))
    }

    #[tracing::instrument(skip_all, fields(document, references = links.len()), err)]
    async fn rewrite_import_links(
        &self,
        user: &MacroUserIdStr<'static>,
        document: Uuid,
        body: ImportedLinkBody,
        links: &[(NotionLinkReference, NotionLinkDestination)],
    ) -> anyhow::Result<usize> {
        use lexical_client::notion::{
            NotionLinkDestination as Destination, NotionLinkReference as Source,
            NotionLinkReplacement,
        };
        let Some(editor) = &self.notion_link_editor else {
            return Ok(0);
        };
        let replacements: Vec<_> = links
            .iter()
            .map(|(source, destination)| NotionLinkReplacement {
                source: Source {
                    id: source.id.as_str().to_owned(),
                    view_id: source.view_id.as_ref().map(|id| id.as_str().to_owned()),
                },
                destination: match destination {
                    NotionLinkDestination::Page(id) => Destination::Page {
                        document_id: id.to_string(),
                    },
                    NotionLinkDestination::Database {
                        database,
                        table,
                        view,
                    } => Destination::Database {
                        database_id: database.to_string(),
                        table_id: table.to_string(),
                        view_id: view.map(|id| id.to_string()),
                    },
                },
            })
            .collect();
        let prepared = editor
            .lexical
            .notion_link_delta(&body.snapshot, &replacements)
            .await?;
        let Some(delta) = prepared.update_bytes()? else {
            return Ok(0);
        };
        let token = editor.owner_token(self, user, document).await?;
        let result = editor
            .sync
            .update_import_links(&document.to_string(), &token, &body.revision, &delta)
            .await?;
        Ok(match result {
            sync_service_client::document_state::DocumentUpdate::Applied { .. } => {
                prepared.rewritten
            }
            sync_service_client::document_state::DocumentUpdate::Conflict => 0,
        })
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
        dates: Option<SourceDates>,
        visibility: import::domain::ports::ImportVisibility,
    ) -> anyhow::Result<import::domain::ports::CreatedImportTask> {
        let created = self
            .create_imported_task(
                user,
                Some(id),
                name,
                ImportedContent::Notion(self::notion_markdown(notion_markdown, links)),
                properties,
                folder,
                dates,
                // A shared task list shares its folder, which reaches its tasks.
                false,
                visibility,
            )
            .await;
        match created {
            Ok(created) => Ok(created),
            Err(error) => {
                let task = already_created(Err(error), id)?;
                let (_, roster) = self.team_roster(user).await;
                let notice = self
                    .apply_task_properties(user, &task, properties, &roster, visibility)
                    .await;
                Ok(import::domain::ports::CreatedImportTask { id: task, notice })
            }
        }
    }

    #[tracing::instrument(skip_all, fields(task_id = %id, visibility = ?visibility), err)]
    async fn reapply_task_assignee(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        email: &str,
        visibility: import::domain::ports::ImportVisibility,
    ) -> anyhow::Result<Option<import::domain::ports::TaskImportNoticeReason>> {
        let access = self
            .entity_access_service
            .generate_entity_access_receipt::<EditAccessLevel>(
                user,
                None,
                &id.to_string(),
                model_entity::EntityType::Document,
            )
            .await
            .map_err(anyhow::Error::new)?;
        use teams::domain::team_repo::TeamRepository as _;
        // Replay must not clear an omission notice after a failed roster lookup.
        let roster = match self.entity_access_service.get_user_team(user).await? {
            Some(team) => self
                .team_repository
                .get_team_members(&team.team_id)
                .await?
                .into_iter()
                .map(|member| macro_user_id::cowlike::CowLike::into_owned(member.user_id))
                .collect(),
            None => Vec::new(),
        };
        self.apply_task_assignee(
            user,
            access.entity().entity_id.as_ref(),
            Some(email),
            &roster,
            visibility,
        )
        .await
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn folder_has_explicit_grant(
        &self,
        user: &MacroUserIdStr<'static>,
        folder: Uuid,
    ) -> anyhow::Result<bool> {
        let receipt = self
            .entity_access_service
            .generate_entity_access_receipt::<EditAccessLevel>(
                user,
                None,
                &folder.to_string(),
                model_entity::EntityType::Project,
            )
            .await
            .map_err(database_folder_access_failure)?;
        Ok(self
            .project_service
            .folder_has_explicit_grant(receipt)
            .await
            .map_err(|_| DatabaseWriteFailure::FolderUnavailable)?)
    }

    #[tracing::instrument(skip(self, user), err)]
    async fn folder_has_team_edit_grant(
        &self,
        user: &MacroUserIdStr<'static>,
        folder: Uuid,
    ) -> anyhow::Result<bool> {
        let receipt = self
            .entity_access_service
            .generate_entity_access_receipt::<EditAccessLevel>(
                user,
                None,
                &folder.to_string(),
                model_entity::EntityType::Project,
            )
            .await
            .map_err(database_folder_access_failure)?;
        Ok(self
            .project_service
            .folder_has_team_edit_grant(receipt)
            .await
            .map_err(|_| DatabaseWriteFailure::FolderUnavailable)?)
    }

    async fn folder_exists(
        &self,
        user: &MacroUserIdStr<'static>,
        folder: Uuid,
    ) -> anyhow::Result<bool> {
        match self
            .entity_access_service
            .generate_entity_access_receipt::<ViewAccessLevel>(
                user,
                None,
                &folder.to_string(),
                model_entity::EntityType::Project,
            )
            .await
        {
            Ok(_) => import::domain::ports::ImportedTargetReader::target_exists(
                self,
                ImportedTarget::Folder(folder),
            )
            .await
            .map_err(|_| DatabaseWriteFailure::FolderUnavailable.into()),
            Err(error) if crate::tool_context::refuses_view(&error) => Ok(false),
            Err(error) => Err(database_folder_access_failure(error).into()),
        }
    }

    #[tracing::instrument(skip_all, fields(database_id = %id), err)]
    async fn database_access(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> anyhow::Result<bool> {
        use entity_access::domain::models::AccessError;
        match database_receipt::<ViewAccessLevel, _>(
            self.entity_access_service.as_ref(),
            &viewer(user),
            DatabaseId::from_uuid(id),
        )
        .await
        {
            Ok(_) => Ok(true),
            Err(
                AccessError::Unauthorized
                | AccessError::UnauthorizedWithMessage(_)
                | AccessError::NotFound(_),
            ) => Ok(false),
            Err(error) => Err(database_access_failure(error).into()),
        }
    }

    #[tracing::instrument(skip_all, fields(database_id = %id, table_id = %table), err)]
    async fn database(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        table: models_databases::TableId,
    ) -> anyhow::Result<import::domain::ports::ImportedDatabase> {
        imported_database(&self.import_database_detail(user, id).await?, table)
    }

    #[tracing::instrument(name = "notion.persist_database_view", skip_all, fields(database_id = %database, view_id = %id), err)]
    async fn ensure_database_view(
        &self,
        user: &MacroUserIdStr<'static>,
        database: Uuid,
        table: models_databases::TableId,
        id: models_databases::views::ViewId,
        view: models_databases::views::NewView,
    ) -> anyhow::Result<()> {
        let exists = |detail: &DatabaseDetail| {
            detail.tables.iter().any(|entry| {
                entry.table.id == table && entry.views.iter().any(|view| view.id == id)
            })
        };
        let result = import::domain::ports::WorkspaceWriter::apply_database_ops(
            self,
            user,
            database,
            vec![models_databases::DatabaseOp::View {
                table,
                view: id,
                change: models_databases::ViewChange::Create { view },
            }],
        )
        .await;
        if let Err(error) = result {
            // A committed create whose response/marker was lost is already complete.
            if !exists(&self.import_database_detail(user, database).await?) {
                return Err(error);
            }
        }
        Ok(())
    }

    #[tracing::instrument(skip(self, user, name), err)]
    async fn create_database(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        name: &str,
        folder: Option<Uuid>,
    ) -> anyhow::Result<NewDatabase> {
        let viewer = viewer(user);
        let command = CreateDatabase {
            name: name.to_string(),
            owner_id: user.clone(),
            acting_bot: viewer.acting_bot,
            first_table: None,
        };
        let database = if let Some(folder) = folder {
            let project = self
                .entity_access_service
                .generate_entity_access_receipt::<OwnerAccessLevel>(
                    user,
                    None,
                    &folder.to_string(),
                    model_entity::EntityType::Project,
                )
                .await
                .map_err(database_folder_access_failure)?;
            self.databases_service
                .create_database_in_project(DatabaseId::from_uuid(id), command, project)
                .await
                .map_err(database_write_failure)?
        } else {
            self.databases_service
                .create_database_with_id(DatabaseId::from_uuid(id), command)
                .await
                .map_err(database_write_failure)?
        };
        let receipt = database_receipt::<ViewAccessLevel, _>(
            self.entity_access_service.as_ref(),
            &viewer,
            database.id,
        )
        .await
        .map_err(database_access_failure)?;
        let detail = self
            .databases_service
            .get_database(receipt)
            .await
            .map_err(database_write_failure)?;
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
        .map_err(database_access_failure)?;
        Ok(self
            .databases_service
            .apply_ops(receipt, viewer, OpBatch::from(ops))
            .await
            .map_err(database_write_failure)?)
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

impl ToolEntityCreator {
    async fn import_database_detail(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> anyhow::Result<DatabaseDetail> {
        let receipt = database_receipt::<ViewAccessLevel, _>(
            self.entity_access_service.as_ref(),
            &viewer(user),
            DatabaseId::from_uuid(id),
        )
        .await
        .map_err(database_access_failure)?;
        Ok(self
            .databases_service
            .get_database(receipt)
            .await
            .map_err(database_write_failure)?)
    }
}

/// A service refusal is source-specific; repository failures affect the run.
fn database_write_failure(error: DatabaseError) -> DatabaseWriteFailure {
    match error {
        DatabaseError::NotFound => DatabaseWriteFailure::NotFound,
        DatabaseError::Unauthorized => DatabaseWriteFailure::PermissionDenied,
        DatabaseError::VersionConflict => DatabaseWriteFailure::Conflict,
        DatabaseError::Repo(_) => DatabaseWriteFailure::Unavailable,
        DatabaseError::RowInUse
        | DatabaseError::OptionInUse
        | DatabaseError::InvalidAppearance(_)
        | DatabaseError::InvalidSchemaOperation(_)
        | DatabaseError::InvalidSharing(_)
        | DatabaseError::InvalidOp(_) => DatabaseWriteFailure::InvalidSchema,
    }
}

/// A filing failure may affect every source in that folder; always re-check it.
fn database_folder_access_failure(
    _: entity_access::domain::models::AccessError,
) -> DatabaseWriteFailure {
    DatabaseWriteFailure::FolderUnavailable
}

fn database_access_failure(
    error: entity_access::domain::models::AccessError,
) -> DatabaseWriteFailure {
    use entity_access::domain::models::AccessError;
    match error {
        AccessError::Unauthorized | AccessError::UnauthorizedWithMessage(_) => {
            DatabaseWriteFailure::PermissionDenied
        }
        AccessError::NotFound(_) => DatabaseWriteFailure::NotFound,
        AccessError::BadRequest(_) => DatabaseWriteFailure::InvalidSchema,
        AccessError::Unavailable(_) | AccessError::Internal(_) => DatabaseWriteFailure::Unavailable,
    }
}

/// Reused copies follow their holder's marker, independent of UI tab order.
fn imported_database(
    detail: &DatabaseDetail,
    table: models_databases::TableId,
) -> anyhow::Result<import::domain::ports::ImportedDatabase> {
    let table = detail
        .tables
        .iter()
        .find(|entry| entry.table.id == table)
        .ok_or(import::domain::models::SourceStopReason::RecordedTableMissing)?;
    Ok(import::domain::ports::ImportedDatabase {
        database_id: detail.database.id.into_uuid(),
        table: table.table.id,
        views: table.views.iter().map(|view| view.id).collect(),
    })
}
