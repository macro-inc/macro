use super::{PgDatabasesRepo, PgDatabasesRepoError};
use crate::domain::{
    models::DatabaseId,
    sharing::{DatabaseSharingRepo, SharingWrite},
};
use model_entity::EntityType;
use models_permissions::share_permission::access_level::AccessLevel;
use models_permissions::share_permission::channel_share_permission::{
    ChannelSharePermission, UpdateChannelSharePermission,
};
use models_permissions::share_permission::team_share::{
    AuthorizedTeamShareCommand, TeamShareFacts,
};
use share_permission_db_utils::team_share::{self, TeamShareError};

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

    #[tracing::instrument(err, skip(self))]
    async fn team_share_level(
        &self,
        database_id: DatabaseId,
    ) -> Result<Option<AccessLevel>, Self::Error> {
        Ok(sqlx::query_scalar!(
            r#"SELECT sp.team_share_access_level AS "level: AccessLevel"
            FROM database_entities d
            JOIN "SharePermission" sp ON sp.id = d.share_permission_id
            WHERE d.database_id = $1"#,
            database_id.into_uuid(),
        )
        .fetch_optional(&self.pool)
        .await?
        .flatten())
    }

    #[tracing::instrument(err, skip(self))]
    async fn team_share_facts(
        &self,
        database_id: DatabaseId,
    ) -> Result<TeamShareFacts, Self::Error> {
        let mut transaction = self.pool.begin().await?;
        let entity = EntityType::Database.with_entity_string(database_id.to_string());
        let facts = team_share::load_facts(&mut transaction, &entity)
            .await
            .map_err(PgDatabasesRepoError::TeamShare)?;
        transaction.commit().await?;
        Ok(facts)
    }

    #[tracing::instrument(err, skip(self, grants, team_share))]
    async fn update_sharing(
        &self,
        database_id: DatabaseId,
        grants: &[UpdateChannelSharePermission],
        team_share: Option<&AuthorizedTeamShareCommand>,
    ) -> Result<SharingWrite, Self::Error> {
        let mut transaction = self.pool.begin().await?;
        // The team-share guard comes before any row lock, as its writer requires.
        if team_share.is_some() {
            team_share::acquire_guard(&mut transaction).await?;
        }
        let Some(row) = sqlx::query!(
            "SELECT share_permission_id FROM database_entities WHERE database_id = $1 AND trashed_at IS NULL FOR UPDATE",
            database_id.into_uuid(),
        )
        .fetch_optional(&mut *transaction)
        .await?
        else {
            transaction.rollback().await?;
            return Ok(SharingWrite::Gone);
        };
        entity_access_db_utils::update_entity_access_channel_share_permissions(
            &mut transaction,
            database_id.as_uuid(),
            EntityType::Database,
            grants,
        )
        .await?;
        if let Some(command) = team_share {
            // The team share's state lives in a SharePermission row, made
            // the first time it is set.
            if row.share_permission_id.is_none() {
                let permission_id = macro_uuid::generate_uuid_v7().to_string();
                share_permission_db_utils::create_private_share_permission(
                    &mut *transaction,
                    &permission_id,
                )
                .await?;
                sqlx::query!(
                    "UPDATE database_entities SET share_permission_id = $2 WHERE database_id = $1",
                    database_id.into_uuid(),
                    permission_id,
                )
                .execute(&mut *transaction)
                .await?;
            }
            match team_share::apply(&mut transaction, command).await {
                Ok(()) => {}
                Err(error)
                    if matches!(
                        error.current_context(),
                        TeamShareError::ChangedFacts | TeamShareError::UntrackedGrant
                    ) =>
                {
                    transaction.rollback().await?;
                    return Ok(SharingWrite::Changed);
                }
                Err(error) => return Err(PgDatabasesRepoError::TeamShare(error)),
            }
        }
        transaction.commit().await?;
        Ok(SharingWrite::Written)
    }
}
