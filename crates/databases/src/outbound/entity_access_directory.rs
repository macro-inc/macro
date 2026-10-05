//! Which databases a viewer can reach, asked of the owning `entity_access`
//! domain, whose source-id and highest-grant rules are not copied here.

#[cfg(all(test, feature = "postgres"))]
mod test;

use std::sync::Arc;

use entity_access::domain::models::{AccessError, AccessLevel, EntityType};
use entity_access::domain::ports::{AccessibleDatabases, EntityAccessService};

use crate::domain::models::{DatabaseId, Viewer};
use crate::domain::ports::AccessDirectory;

/// The directory's error: whatever `entity_access` reports.
#[derive(Debug, thiserror::Error)]
#[error("entity access: {0}")]
pub struct EntityAccessDirectoryError(#[from] AccessError);

/// [`AccessDirectory`] over the entity access service.
#[derive(Debug, Clone)]
pub struct EntityAccessDirectory<Access> {
    access: Arc<Access>,
}

impl<Access> EntityAccessDirectory<Access> {
    /// Wrap the host's entity access service.
    pub fn new(access: Arc<Access>) -> Self {
        Self { access }
    }
}

impl<Access> AccessDirectory for EntityAccessDirectory<Access>
where
    Access: EntityAccessService + AccessibleDatabases,
{
    type Error = EntityAccessDirectoryError;

    #[tracing::instrument(err, skip(self, viewer))]
    async fn accessible_databases(
        &self,
        viewer: &Viewer,
    ) -> Result<Vec<(DatabaseId, AccessLevel)>, Self::Error> {
        Ok(self
            .access
            .accessible_databases(&viewer.user_id)
            .await?
            .into_iter()
            .map(|(database, grant)| (DatabaseId::from_uuid(database), grant))
            .collect())
    }

    #[tracing::instrument(err, skip(self, viewer))]
    async fn database_access(
        &self,
        viewer: &Viewer,
        database_id: DatabaseId,
    ) -> Result<Option<AccessLevel>, Self::Error> {
        Ok(self
            .access
            .get_access_level(
                Some(&viewer.user_id),
                &database_id.to_string(),
                EntityType::Database,
            )
            .await?)
    }
}
