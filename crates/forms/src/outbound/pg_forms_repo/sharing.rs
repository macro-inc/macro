//! A form's direct channel grants, through the owning access crate.

use entity_access_db_utils::EntityType;
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission,
};

use super::{PgFormsRepo, PgFormsRepoError};
use crate::domain::models::FormId;
use crate::domain::sharing::FormSharingRepo;

impl FormSharingRepo for PgFormsRepo {
    type Error = PgFormsRepoError;

    #[tracing::instrument(err, skip(self))]
    async fn channel_grants(
        &self,
        form_id: FormId,
    ) -> Result<Vec<ChannelSharePermission>, Self::Error> {
        Ok(entity_access_db_utils::get_direct_channel_grants(
            &self.pool,
            form_id.as_uuid(),
            EntityType::Form,
        )
        .await?)
    }

    #[tracing::instrument(err, skip(self, grants))]
    async fn update_channel_grants(
        &self,
        form_id: FormId,
        grants: &[UpdateChannelSharePermission],
    ) -> Result<bool, Self::Error> {
        let mut transaction = self.pool.begin().await?;
        let live = sqlx::query_scalar!(
            "SELECT id FROM forms WHERE id = $1 AND trashed_at IS NULL FOR SHARE",
            form_id.into_uuid(),
        )
        .fetch_optional(&mut *transaction)
        .await?;
        if live.is_none() {
            transaction.rollback().await?;
            return Ok(false);
        }
        entity_access_db_utils::update_entity_access_channel_share_permissions(
            &mut transaction,
            form_id.as_uuid(),
            EntityType::Form,
            grants,
        )
        .await?;
        transaction.commit().await?;
        Ok(true)
    }
}
