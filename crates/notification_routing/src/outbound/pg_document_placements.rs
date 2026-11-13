//! PostgreSQL implementation of the [`DocumentPlacements`] port.

#[cfg(test)]
mod tests;

use rootcause::Report;
use sqlx::PgPool;
use system_properties::SystemPropertiesService;

use crate::domain::evaluate::DocumentPlacement;
use crate::domain::ports::DocumentPlacements;

/// How many folders above a document are read. Folders nest far less deeply;
/// the bound keeps a cycle in stored parents from running away.
const MAX_FOLDER_DEPTH: i32 = 64;

/// Reads where a document is filed: its folders from the folder tree, and a
/// task's project from the system properties service.
#[derive(Debug, Clone)]
pub struct PgDocumentPlacements<P> {
    pool: PgPool,
    properties: P,
}

impl<P: SystemPropertiesService> PgDocumentPlacements<P> {
    /// Create a reader over the provided pool and system properties service.
    pub fn new(pool: PgPool, properties: P) -> Self {
        Self { pool, properties }
    }
}

impl<P: SystemPropertiesService> DocumentPlacements for PgDocumentPlacements<P> {
    #[tracing::instrument(name = "notification_stack.placement", skip_all, err)]
    async fn placement(
        &self,
        document_id: &str,
        is_task: bool,
    ) -> Result<DocumentPlacement, Report> {
        // A read-only walk up the folder tree. It runs once per routed
        // document notification, and only when a recipient's stack names a
        // folder or a task project.
        let folders = sqlx::query_scalar!(
            r#"
            WITH RECURSIVE folders AS (
                SELECT folder.id, folder."parentId", 1 AS depth
                FROM "Document" document
                JOIN "Project" folder ON folder.id = document."projectId"
                WHERE document.id = $1
              UNION ALL
                SELECT parent.id, parent."parentId", folders.depth + 1
                FROM folders
                JOIN "Project" parent ON parent.id = folders."parentId"
                WHERE folders.depth < $2
            )
            SELECT id AS "id!" FROM folders
            "#,
            document_id,
            MAX_FOLDER_DEPTH,
        )
        .fetch_all(&self.pool)
        .await?;

        let project = if is_task {
            self.properties
                .task_projects(vec![document_id.to_string()])
                .await
                .map_err(|error| Report::new(error).into_dynamic())?
                .remove(document_id)
                .map(|project| project.to_string())
        } else {
            None
        };

        Ok(DocumentPlacement { folders, project })
    }
}
