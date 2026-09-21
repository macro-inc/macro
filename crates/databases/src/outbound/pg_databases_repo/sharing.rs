use super::{PgDatabasesRepo, PgDatabasesRepoError};
use crate::domain::{models::DatabaseId, sharing::DatabaseSharingRepo};
use model_entity::EntityType;
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission,
};

impl DatabaseSharingRepo for PgDatabasesRepo {
    type Err = PgDatabasesRepoError;

    async fn channel_grants(
        &self,
        database_id: DatabaseId,
    ) -> Result<Vec<ChannelSharePermission>, Self::Err> {
        Ok(entity_access_db_utils::get_direct_channel_grants(
            &self.pool,
            &database_id,
            EntityType::Database,
        )
        .await?)
    }

    async fn update_channel_grants(
        &self,
        database_id: DatabaseId,
        grants: &[UpdateChannelSharePermission],
    ) -> Result<bool, Self::Err> {
        let mut transaction = self.pool.begin().await?;
        let live = sqlx::query_scalar!(
            "SELECT id FROM databases WHERE id = $1 AND trashed_at IS NULL FOR SHARE",
            database_id,
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if live.is_none() {
            transaction.rollback().await?;
            return Ok(false);
        }
        entity_access_db_utils::update_entity_access_channel_share_permissions(
            &mut transaction,
            &database_id,
            EntityType::Database,
            grants,
        )
        .await?;
        transaction.commit().await?;
        Ok(true)
    }
}
