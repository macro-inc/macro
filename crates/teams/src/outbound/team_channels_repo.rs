//! Implementation for TeamChannelsRepository using MacroDB.
use crate::domain::{model::TeamError, team_repo::TeamChannelsRepository};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;

#[cfg(test)]
mod test;

/// The TeamChannelsRepositoryImpl struct is a wrapper around sqlx::PgPool connected to macrodb.
#[derive(Clone)]
pub struct TeamChannelsRepositoryImpl {
    /// The underlying sqlx::PgPool connected to macrodb.
    pool: PgPool,
}

impl TeamChannelsRepositoryImpl {
    /// Creates a new instance of TeamChannelsRepositoryImpl
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

impl TeamChannelsRepository for TeamChannelsRepositoryImpl {
    #[tracing::instrument(skip(self), err)]
    async fn add_team_member_to_channels(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamError> {
        sqlx::query!(
            r#"
            INSERT INTO comms_channel_participants (channel_id, user_id, role, joined_at)
            SELECT cc.id, $2, 'member'::comms_participant_role, NOW()
            FROM comms_channels cc
            WHERE cc.team_id = $1
            ON CONFLICT (channel_id, user_id) DO NOTHING
            "#,
            team_id,
            user_id.as_ref(),
        )
        .execute(&self.pool)
        .await
        .map_err(|e| TeamError::StorageLayerError(e.into()))?;

        Ok(())
    }

    #[tracing::instrument(skip(self), err)]
    async fn remove_team_member_from_channels(
        &self,
        team_id: &uuid::Uuid,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<(), TeamError> {
        sqlx::query!(
            r#"
            DELETE FROM comms_channel_participants
            WHERE user_id = $2
            AND channel_id IN (
                SELECT id FROM comms_channels WHERE team_id = $1
            )
            "#,
            team_id,
            user_id.as_ref(),
        )
        .execute(&self.pool)
        .await
        .map_err(|e| TeamError::StorageLayerError(e.into()))?;

        Ok(())
    }
}
