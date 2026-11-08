//! Test host writer: records writes and can exercise real target lifecycle reads.

use super::*;

/// Records the documents and folders a write makes. With `hold` set, a
/// document write waits until the process is shutting down and then fails,
/// as a write cut off by a deploy does.
#[derive(Default)]
pub(super) struct Writer {
    pub(super) target_pool: Option<PgPool>,
    pub(super) delete_on_first_read: std::sync::atomic::AtomicBool,
    pub(super) delete_target: Option<Uuid>,
    pub(super) notify_on_document: Option<(Uuid, Arc<Notify>)>,
    pub(super) folder_pool: Option<PgPool>,
    pub(super) folders: Mutex<Vec<String>>,
    pub(super) documents: Mutex<Vec<(Uuid, String, NotionLinks)>>,
    pub(super) shares: Mutex<Vec<SharedEntity>>,
    pub(super) hold: Option<(Arc<Notify>, tokio_util::sync::CancellationToken)>,
    pub(super) tracker_tasks: Mutex<Vec<Uuid>>,
    pub(super) tracker_task_sharing: Mutex<Vec<bool>>,
    pub(super) tracker_projects: Mutex<Vec<Uuid>>,
    pub(super) tracker_links: Mutex<Vec<Uuid>>,
    pub(super) reject_tracker_links: std::sync::atomic::AtomicBool,
    pub(super) reject_tracker_projects: std::sync::atomic::AtomicBool,
    /// Each document written with the source dates it was given.
    pub(super) document_dates: Mutex<Vec<(Uuid, Option<SourceDates>)>>,
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
        _: bool,
    ) -> anyhow::Result<Uuid> {
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
        shared: bool,
    ) -> anyhow::Result<String> {
        self.tracker_task_sharing.lock().unwrap().push(shared);
        let mut tasks = self.tracker_tasks.lock().unwrap();
        if !tasks.contains(&id) {
            tasks.push(id);
        }
        Ok(id.to_string())
    }
    async fn link_tracker_task(
        &self,
        _: &MacroUserIdStr<'static>,
        id: Uuid,
        _: &crate::domain::ports::TrackerTaskRelations,
    ) -> anyhow::Result<()> {
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
        _: Option<Uuid>,
    ) -> anyhow::Result<Uuid> {
        self.folders.lock().unwrap().push(name.to_string());
        let id = Uuid::now_v7();
        if let Some(pool) = &self.folder_pool {
            sqlx::query!(
                r#"INSERT INTO "Project" (id, name, "userId") VALUES ($1, $2, $3)"#,
                id.to_string(),
                name,
                user.as_ref(),
            )
            .execute(pool)
            .await?;
        }
        Ok(id)
    }

    async fn folder_exists(&self, _: &MacroUserIdStr<'static>, id: Uuid) -> anyhow::Result<bool> {
        if let Some(pool) = &self.folder_pool {
            return Ok(sqlx::query_scalar!(
                r#"SELECT EXISTS(SELECT 1 FROM "Project" WHERE id = $1 AND "deletedAt" IS NULL) AS "live!""#,
                id.to_string(),
            ).fetch_one(pool).await?);
        }
        Ok(true)
    }

    async fn share_with_team(
        &self,
        _: &MacroUserIdStr<'static>,
        entity: SharedEntity,
    ) -> anyhow::Result<()> {
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
        _: Option<Uuid>,
        dates: Option<SourceDates>,
    ) -> anyhow::Result<String> {
        self.document_dates.lock().unwrap().push((id, dates));
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

    async fn create_task(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
        _: &str,
        _: &str,
        _: &NotionLinks,
        _: &ImportedTaskProperties,
        _: Option<Uuid>,
        _: Option<SourceDates>,
    ) -> anyhow::Result<String> {
        unimplemented!("only pages here")
    }

    async fn create_database(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
    ) -> anyhow::Result<NewDatabase> {
        unimplemented!("only pages here")
    }

    async fn apply_database_ops(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
        _: Vec<databases_types::DatabaseOp>,
    ) -> anyhow::Result<Vec<databases_types::OpResult>> {
        unimplemented!("only pages here")
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
