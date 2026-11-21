//! Test host writer: records writes and can exercise real target lifecycle reads.

use super::*;
use std::collections::HashMap;

/// Records the documents and folders a write makes. With `hold` set, a
/// document write waits until the process is shutting down and then fails,
/// as a write cut off by a deploy does.
#[derive(Default)]
pub(super) struct Writer {
    pub(super) task_notice: Option<crate::domain::ports::TaskImportNoticeReason>,
    pub(super) folders: Mutex<Vec<String>>,
    pub(super) folder_delay: Option<std::time::Duration>,
    pub(super) folder_visibilities: Mutex<Vec<(String, crate::domain::ports::ImportVisibility)>>,
    pub(super) databases: Mutex<Vec<(Uuid, Option<Uuid>)>>,
    pub(super) reservation_gate: Option<(Arc<tokio::sync::Semaphore>, Arc<tokio::sync::Semaphore>)>,
    pub(super) saved_views: Mutex<
        Vec<(
            Uuid,
            models_databases::views::ViewId,
            models_databases::views::NewView,
        )>,
    >,
    pub(super) steps: Mutex<Vec<&'static str>>,
    pub(super) database_reads: Mutex<Vec<(Uuid, models_databases::TableId)>>,
    pub(super) deny_database_access: bool,
    pub(super) grant_on_database: bool,
    pub(super) database_insert_rows: std::sync::atomic::AtomicUsize,
    pub(super) database_error_once: std::sync::atomic::AtomicBool,
    pub(super) mirror_service_error: Option<&'static str>,
    pub(super) unknown_database: Option<&'static str>,
    pub(super) folder_access_error: std::sync::atomic::AtomicBool,
    pub(super) database_failures: HashMap<String, crate::domain::ports::DatabaseWriteFailure>,

    pub(super) tasks: Mutex<Vec<Uuid>>,
    pub(super) documents: Mutex<Vec<(Uuid, String, NotionLinks)>>,
    pub(super) shares: Mutex<Vec<SharedEntity>>,
    pub(super) hold: Option<(Arc<Notify>, tokio_util::sync::CancellationToken)>,
    pub(super) tracker_tasks: Mutex<Vec<Uuid>>,
    pub(super) visibilities: Mutex<Vec<(Uuid, crate::domain::ports::ImportVisibility)>>,
    pub(super) tracker_projects: Mutex<Vec<Uuid>>,
    pub(super) tracker_links: Mutex<Vec<Uuid>>,
    pub(super) tracker_events: Mutex<Vec<(Uuid, &'static str)>>,
    pub(super) reject_tracker_links: std::sync::atomic::AtomicBool,
    pub(super) reject_tracker_projects: std::sync::atomic::AtomicBool,
    /// Each document written with the source dates it was given.
    pub(super) document_dates: Mutex<Vec<(Uuid, Option<SourceDates>)>>,
    pub(super) folder_records: Mutex<Vec<(Uuid, String, Option<Uuid>)>>,
    pub(super) document_folders: Mutex<Vec<(Uuid, Option<Uuid>)>>,
    pub(super) task_folders: Mutex<Vec<Option<Uuid>>>,
    pub(super) grants: Mutex<std::collections::HashSet<Uuid>>,
    pub(super) target_pool: Option<PgPool>,
    pub(super) delete_on_first_read: std::sync::atomic::AtomicBool,
    pub(super) delete_target: Option<Uuid>,
    pub(super) notify_on_document: Option<(Uuid, Arc<Notify>)>,
    pub(super) folder_pool: Option<PgPool>,
    pub(super) tracker_task_sharing: Mutex<Vec<bool>>,
}

impl crate::domain::ports::ImportedTargetReader for Writer {
    async fn target_exists(
        &self,
        target: crate::domain::ports::ImportedTarget,
    ) -> anyhow::Result<bool> {
        if let Some(pool) = &self.target_pool {
            let live = match target {
                crate::domain::ports::ImportedTarget::Document(id) => sqlx::query_scalar!(
                    r#"SELECT EXISTS(SELECT 1 FROM "Document" WHERE id = $1 AND "deletedAt" IS NULL) AS "live!""#,
                    id.to_string(),
                ).fetch_one(pool).await?,
                crate::domain::ports::ImportedTarget::Folder(id) => sqlx::query_scalar!(
                    r#"SELECT EXISTS(SELECT 1 FROM "Project" WHERE id = $1 AND "deletedAt" IS NULL) AS "live!""#,
                    id.to_string(),
                ).fetch_one(pool).await?,
                crate::domain::ports::ImportedTarget::Database(id) => sqlx::query_scalar!(
                    r#"SELECT EXISTS(SELECT 1 FROM database_entities WHERE database_id = $1 AND trashed_at IS NULL) AS "live!""#,
                    id,
                ).fetch_one(pool).await?,
                crate::domain::ports::ImportedTarget::Initiative(id) => sqlx::query_scalar!("SELECT EXISTS(SELECT 1 FROM initiative WHERE id = $1)", id).fetch_one(pool).await?.unwrap_or(false),
            };
            if let crate::domain::ports::ImportedTarget::Document(id) = target
                && self.delete_target.is_none_or(|target| target == id)
                && self
                    .delete_on_first_read
                    .swap(false, std::sync::atomic::Ordering::SeqCst)
            {
                sqlx::query!(
                    r#"UPDATE "Document" SET "deletedAt" = NOW() WHERE id = $1"#,
                    id.to_string()
                )
                .execute(pool)
                .await?;
            }
            return Ok(live);
        }
        Ok(true)
    }
}

impl WorkspaceWriter for Writer {
    async fn create_tracker_project(
        &self,
        _: &MacroUserIdStr<'static>,
        id: Uuid,
        _: &str,
        _: &str,
        visibility: crate::domain::ports::ImportVisibility,
    ) -> anyhow::Result<Uuid> {
        self.visibilities.lock().unwrap().push((id, visibility));
        if self
            .reject_tracker_projects
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            anyhow::bail!("temporary project failure");
        }
        let mut projects = self.tracker_projects.lock().unwrap();
        if !projects.contains(&id) {
            projects.push(id);
        }
        Ok(id)
    }
    async fn create_tracker_task(
        &self,
        _: &MacroUserIdStr<'static>,
        id: Uuid,
        _: &str,
        _: &str,
        _: &ImportedTaskProperties,
        visibility: crate::domain::ports::ImportVisibility,
    ) -> anyhow::Result<crate::domain::ports::CreatedImportTask> {
        self.tracker_task_sharing
            .lock()
            .unwrap()
            .push(visibility == crate::domain::ports::ImportVisibility::Shared);
        self.visibilities.lock().unwrap().push((id, visibility));
        let mut tasks = self.tracker_tasks.lock().unwrap();
        if !tasks.contains(&id) {
            tasks.push(id);
        }
        Ok(crate::domain::ports::CreatedImportTask {
            id: id.to_string(),
            notice: self
                .task_notice
                .filter(|_| visibility == crate::domain::ports::ImportVisibility::Personal),
        })
    }
    async fn link_tracker_task(
        &self,
        _: &MacroUserIdStr<'static>,
        id: Uuid,
        _: &crate::domain::ports::TrackerTaskRelations,
    ) -> anyhow::Result<()> {
        self.tracker_events.lock().unwrap().push((id, "enrich"));
        if self
            .reject_tracker_links
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            anyhow::bail!("temporary property failure");
        }
        self.tracker_links.lock().unwrap().push(id);
        Ok(())
    }

    async fn create_folder(
        &self,
        user: &MacroUserIdStr<'static>,
        name: &str,
        parent: Option<Uuid>,
        visibility: crate::domain::ports::ImportVisibility,
    ) -> anyhow::Result<Uuid> {
        if name == "Notion (personal)" && self.mirror_service_error == Some("create") {
            anyhow::bail!("projects service request failed");
        }
        if let Some(delay) = self.folder_delay {
            tokio::time::sleep(delay).await;
        }
        self.folder_visibilities
            .lock()
            .unwrap()
            .push((name.to_string(), visibility));
        self.folders.lock().unwrap().push(name.to_string());
        let id = Uuid::now_v7();
        self.folder_records
            .lock()
            .unwrap()
            .push((id, name.to_string(), parent));
        if let Some(pool) = &self.folder_pool {
            sqlx::query!(
                r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, $2, $3)"#,
                id.to_string(),
                name,
                user.as_ref()
            )
            .execute(pool)
            .await?;
        }
        Ok(id)
    }

    async fn folder_has_explicit_grant(
        &self,
        _: &MacroUserIdStr<'static>,
        folder: Uuid,
    ) -> anyhow::Result<bool> {
        if self
            .folder_access_error
            .load(std::sync::atomic::Ordering::SeqCst)
        {
            return Err(crate::domain::ports::DatabaseWriteFailure::FolderUnavailable.into());
        }
        if self.mirror_service_error.is_some() {
            return Ok(true);
        }
        let grants = self.grants.lock().unwrap();
        let records = self.folder_records.lock().unwrap();
        let mut current = Some(folder);
        while let Some(id) = current {
            if grants.contains(&id) {
                return Ok(true);
            }
            current = records
                .iter()
                .find(|(folder, _, _)| *folder == id)
                .and_then(|(_, _, parent)| *parent);
        }
        Ok(false)
    }

    async fn folder_has_team_edit_grant(
        &self,
        _: &MacroUserIdStr<'static>,
        folder: Uuid,
    ) -> anyhow::Result<bool> {
        Ok(self
            .shares
            .lock()
            .unwrap()
            .iter()
            .any(|share| matches!(share, SharedEntity::Folder(id) if *id == folder)))
    }

    async fn folder_exists(&self, _: &MacroUserIdStr<'static>, id: Uuid) -> anyhow::Result<bool> {
        if self.mirror_service_error == Some("exists") {
            anyhow::bail!("projects service request failed");
        }
        if let Some(pool) = &self.folder_pool {
            return Ok(sqlx::query_scalar!(r#"SELECT EXISTS(SELECT 1 FROM "Project" WHERE id = $1 AND "deletedAt" IS NULL) AS "live!""#,id.to_string()).fetch_one(pool).await?);
        }
        Ok(true)
    }

    async fn share_with_team(
        &self,
        _: &MacroUserIdStr<'static>,
        entity: SharedEntity,
    ) -> anyhow::Result<()> {
        if let SharedEntity::Document(id) = entity {
            self.tracker_events.lock().unwrap().push((id, "share"));
        }
        if let SharedEntity::Folder(id) = entity {
            self.grants.lock().unwrap().insert(id);
        }
        self.steps.lock().unwrap().push(match entity {
            SharedEntity::Folder(_) => "share_folder",
            SharedEntity::Database(_) => "share_database",
            SharedEntity::Document(_) => "share_document",
        });
        self.shares.lock().unwrap().push(entity);
        Ok(())
    }

    async fn create_document(
        &self,
        _: &MacroUserIdStr<'static>,
        id: Uuid,
        name: &str,
        _: &str,
        links: &NotionLinks,
        _: &ImportedDocumentProperties,
        folder: Option<Uuid>,
        dates: Option<SourceDates>,
        visibility: crate::domain::ports::ImportVisibility,
    ) -> anyhow::Result<String> {
        self.visibilities.lock().unwrap().push((id, visibility));
        self.document_dates.lock().unwrap().push((id, dates));
        self.document_folders.lock().unwrap().push((id, folder));
        self.steps.lock().unwrap().push("document");
        if let Some((entered, shutdown)) = &self.hold {
            entered.notify_one();
            shutdown.cancelled().await;
            anyhow::bail!("the process stopped");
        }
        self.documents
            .lock()
            .unwrap()
            .push((id, name.to_string(), links.clone()));
        if let Some((expected, ready)) = &self.notify_on_document
            && *expected == id
        {
            ready.notify_one();
        }
        Ok(id.to_string())
    }

    async fn reapply_task_assignee(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
        _: &str,
        _: crate::domain::ports::ImportVisibility,
    ) -> anyhow::Result<Option<crate::domain::ports::TaskImportNoticeReason>> {
        Ok(None)
    }

    async fn create_task(
        &self,
        _: &MacroUserIdStr<'static>,
        id: Uuid,
        _: &str,
        _: &str,
        _: &NotionLinks,
        _: &ImportedTaskProperties,
        folder: Option<Uuid>,
        _: Option<SourceDates>,
        visibility: crate::domain::ports::ImportVisibility,
    ) -> anyhow::Result<crate::domain::ports::CreatedImportTask> {
        self.visibilities.lock().unwrap().push((id, visibility));
        self.task_folders.lock().unwrap().push(folder);
        self.tasks.lock().unwrap().push(id);
        Ok(crate::domain::ports::CreatedImportTask {
            id: id.to_string(),
            notice: self
                .task_notice
                .filter(|_| visibility == crate::domain::ports::ImportVisibility::Personal),
        })
    }

    async fn database_access(&self, _: &MacroUserIdStr<'static>, _: Uuid) -> anyhow::Result<bool> {
        Ok(!self.deny_database_access)
    }
    async fn database(
        &self,
        _: &MacroUserIdStr<'static>,
        id: Uuid,
        table: models_databases::TableId,
    ) -> anyhow::Result<crate::domain::ports::ImportedDatabase> {
        self.database_reads.lock().unwrap().push((id, table));
        Ok(crate::domain::ports::ImportedDatabase {
            database_id: id,
            table,
            views: self
                .saved_views
                .lock()
                .unwrap()
                .iter()
                .filter(|(database, _, _)| *database == id)
                .map(|(_, view, _)| *view)
                .collect(),
        })
    }
    async fn ensure_database_view(
        &self,
        _: &MacroUserIdStr<'static>,
        database: Uuid,
        _: models_databases::TableId,
        id: models_databases::views::ViewId,
        view: models_databases::views::NewView,
    ) -> anyhow::Result<()> {
        let mut saved = self.saved_views.lock().unwrap();
        if !saved.iter().any(|(_, known, _)| *known == id) {
            saved.push((database, id, view));
            self.steps.lock().unwrap().push("view");
        }
        Ok(())
    }
    async fn create_database(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
        name: &str,
        folder: Option<Uuid>,
    ) -> anyhow::Result<NewDatabase> {
        if self.unknown_database == Some(name) {
            anyhow::bail!("private payload from source {name}");
        }
        if let Some(error) = self.database_failures.get(name) {
            return Err((*error).into());
        }
        if self
            .database_error_once
            .swap(false, std::sync::atomic::Ordering::SeqCst)
        {
            return Err(crate::domain::ports::DatabaseWriteFailure::Unavailable.into());
        }
        if let Some((started, gate)) = &self.reservation_gate {
            started.add_permits(1);
            gate.acquire().await?.forget();
        }
        {
            let mut databases = self.databases.lock().unwrap();
            if !databases.iter().any(|(known, _)| *known == id) {
                databases.push((id, folder));
                self.steps.lock().unwrap().push("database");
            }
        }
        if self.grant_on_database
            && let Some(folder) = folder
        {
            self.grants.lock().unwrap().insert(folder);
        }
        let _ = user;
        Ok(NewDatabase {
            database_id: id,
            table: models_databases::TableId::from_uuid(
                import_notion::domain::macro_cells::derived_id(id, "table"),
            ),
            title_column: models_databases::ColumnId::from_uuid(
                import_notion::domain::macro_cells::derived_id(id, "title"),
            ),
        })
    }
    async fn apply_database_ops(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
        ops: Vec<models_databases::DatabaseOp>,
    ) -> anyhow::Result<Vec<models_databases::OpResult>> {
        use models_databases::{DatabaseOp, OpResult, RowId, RowsChange, RowsResult, TableVersion};
        self.steps.lock().unwrap().push("ops");
        Ok(ops
            .into_iter()
            .filter_map(|op| match op {
                DatabaseOp::Rows {
                    table,
                    change: RowsChange::Insert { rows, ids },
                } => {
                    self.database_insert_rows
                        .fetch_add(rows.len(), std::sync::atomic::Ordering::SeqCst);
                    Some(OpResult::Rows {
                        table,
                        table_version: TableVersion(1),
                        change: RowsResult::Inserted {
                            rows: ids
                                .unwrap_or_else(|| rows.iter().map(|_| RowId::new()).collect()),
                        },
                    })
                }
                _ => None,
            })
            .collect())
    }

    async fn team_members(&self, _: &MacroUserIdStr<'static>) -> anyhow::Result<Vec<TeamMember>> {
        Ok(Vec::new())
    }
}

impl EntityCreator for Writer {
    async fn can_view(
        &self,
        _: &MacroUserIdStr<'static>,
        _: crate::domain::models::ImportSource,
        _: &str,
    ) -> anyhow::Result<bool> {
        Ok(true)
    }
    async fn create_task(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        _: &str,
        _: &ImportedTaskProperties,
    ) -> anyhow::Result<String> {
        unimplemented!("workspace imports write through WorkspaceWriter")
    }

    async fn create_notion_document(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        _: &str,
        _: &NotionLinks,
        _: &ImportedDocumentProperties,
    ) -> anyhow::Result<String> {
        unimplemented!("workspace imports write through WorkspaceWriter")
    }

    async fn create_channel(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        _: &ImportTargetReservation,
        _: &[String],
    ) -> anyhow::Result<Uuid> {
        unimplemented!("workspace imports write no channels")
    }
}
