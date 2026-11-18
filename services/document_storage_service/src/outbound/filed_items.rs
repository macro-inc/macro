//! Unfiling a trashed folder's databases and forms through their owning crates.

use databases::outbound::pg_databases_repo::PgDatabaseFolders;
use forms::outbound::pg_forms_repo::PgFormsRepo;
use projects_hex::domain::ports::FiledItemsUnfiler;
use sqlx::PgPool;

/// Returns the databases and forms filed in trashed folders to the root.
pub struct FiledItemsUnfilerAdapter {
    databases: PgDatabaseFolders,
    forms: PgFormsRepo,
}

impl FiledItemsUnfilerAdapter {
    /// Unfile through the databases and forms repositories over `pool`.
    pub fn new(pool: PgPool) -> Self {
        Self {
            databases: PgDatabaseFolders::new(pool.clone()),
            forms: PgFormsRepo::new(pool),
        }
    }
}

impl FiledItemsUnfiler for FiledItemsUnfilerAdapter {
    async fn unfile_from_projects(&self, project_ids: Vec<String>) -> anyhow::Result<()> {
        self.databases.unfile_from_projects(&project_ids).await?;
        self.forms.unfile_from_projects(&project_ids).await?;
        Ok(())
    }
}
