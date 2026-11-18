//! Stateful writer fixture for the workspace orchestration tests.

use super::*;

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
    ) -> anyhow::Result<String> {
        self.visibilities.lock().unwrap().push((id, visibility));
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
        _: &MacroUserIdStr<'static>,
        name: &str,
        parent: Option<Uuid>,
        visibility: crate::domain::ports::ImportVisibility,
    ) -> anyhow::Result<Uuid> {
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
        Ok(id)
    }

    async fn folder_has_explicit_grant(
        &self,
        _: &MacroUserIdStr<'static>,
        folder: Uuid,
    ) -> anyhow::Result<bool> {
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

    async fn folder_exists(&self, _: &MacroUserIdStr<'static>, _: Uuid) -> anyhow::Result<bool> {
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
        if let Some((entered, shutdown)) = &self.hold {
            entered.notify_one();
            shutdown.cancelled().await;
            anyhow::bail!("the process stopped");
        }
        self.documents
            .lock()
            .unwrap()
            .push((id, name.to_string(), links.clone()));
        Ok(id.to_string())
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
    ) -> anyhow::Result<String> {
        self.visibilities.lock().unwrap().push((id, visibility));
        self.task_folders.lock().unwrap().push(folder);
        Ok(id.to_string())
    }

    async fn create_database(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
    ) -> anyhow::Result<NewDatabase> {
        Ok(NewDatabase {
            database_id: Uuid::now_v7(),
            table: models_databases::TableId::new(),
            title_column: models_databases::ColumnId::new(),
        })
    }

    async fn apply_database_ops(
        &self,
        _: &MacroUserIdStr<'static>,
        _: Uuid,
        ops: Vec<models_databases::DatabaseOp>,
    ) -> anyhow::Result<Vec<models_databases::OpResult>> {
        use models_databases::{DatabaseOp, OpResult, RowId, RowsChange, RowsResult, TableVersion};
        Ok(ops
            .into_iter()
            .filter_map(|op| match op {
                DatabaseOp::Rows {
                    table,
                    change: RowsChange::Insert { rows, .. },
                } => Some(OpResult::Rows {
                    table,
                    table_version: TableVersion(1),
                    change: RowsResult::Inserted {
                        rows: rows.iter().map(|_| RowId::new()).collect(),
                    },
                }),
                _ => None,
            })
            .collect())
    }

    async fn team_members(&self, _: &MacroUserIdStr<'static>) -> anyhow::Result<Vec<TeamMember>> {
        Ok(Vec::new())
    }
}
