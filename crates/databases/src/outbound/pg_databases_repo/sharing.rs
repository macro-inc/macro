use super::{PgDatabasesRepo, PgDatabasesRepoError};
use crate::domain::{models::DatabaseId, sharing::DatabaseSharingRepo};
use model_entity::EntityType;
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission,
};

impl<Properties: Send + Sync + 'static> DatabaseSharingRepo for PgDatabasesRepo<Properties> {
    type Error = PgDatabasesRepoError;

    #[tracing::instrument(err, skip(self))]
    async fn channel_grants(
        &self,
        database_id: DatabaseId,
    ) -> Result<Vec<ChannelSharePermission>, Self::Error> {
        Ok(entity_access_db_utils::get_direct_channel_grants(
            &self.pool,
            database_id.as_uuid(),
            EntityType::Database,
        )
        .await?)
    }

    #[tracing::instrument(err, skip(self, grants))]
    async fn update_channel_grants(
        &self,
        database_id: DatabaseId,
        grants: &[UpdateChannelSharePermission],
    ) -> Result<bool, Self::Error> {
        let mut transaction = self.pool.begin().await?;
        let live = sqlx::query_scalar!(
            "SELECT database_id FROM database_entities WHERE database_id = $1 AND trashed_at IS NULL FOR SHARE",
            database_id.into_uuid(),
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if live.is_none() {
            transaction.rollback().await?;
            return Ok(false);
        }
        entity_access_db_utils::update_entity_access_channel_share_permissions(
            &mut transaction,
            database_id.as_uuid(),
            EntityType::Database,
            grants,
        )
        .await?;
        transaction.commit().await?;
        Ok(true)
    }
}
