//! Transactional native channel effects for verified provider lifecycle facts.
use super::*;

impl PgChannelsRepo {
    /// Delete under the caller's transaction after domain lifecycle authorization.
    pub async fn delete_channel_in(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        channel_id: Uuid,
        user_id: &str,
    ) -> anyhow::Result<()> {
        let result = sqlx::query!(
            r#"
            DELETE FROM comms_channels
            WHERE id = $1
              AND EXISTS (
                  SELECT 1
                  FROM comms_channel_participants
                  WHERE channel_id = $1
                    AND user_id = $2
                    AND role = 'owner'::comms_participant_role
              )
            "#,
            channel_id,
            user_id,
        )
        .execute(&mut **tx)
        .await
        .context("failed to delete channel")?;

        if result.rows_affected() == 0 {
            anyhow::bail!(
                "channel not deleted, either it didn't exist or the user_id provided was not the owner"
            );
        }
        Ok(())
    }

    /// Bind a freshly reserved private channel in the same native transaction.
    pub async fn bind_messaging_in(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        channel: Uuid,
        binding: crate::domain::models::MessagingBinding,
    ) -> anyhow::Result<()> {
        let changed=sqlx::query!("UPDATE comms_channels SET messaging_binding=$2 WHERE id=$1 AND channel_type='private' AND team_id IS NULL AND messaging_binding='native'",channel,binding.as_ref()).execute(&mut **tx).await?;
        anyhow::ensure!(
            changed.rows_affected() == 1,
            "external bindings require fresh private native channels"
        );
        Ok(())
    }

    /// Apply a provider-owned name through the native channel owner. The host
    /// publishes the returned native event after the binding transaction commits.
    pub async fn provider_name_in(
        tx: &mut sqlx::Transaction<'_, sqlx::Postgres>,
        channel: Uuid,
        name: &str,
    ) -> anyhow::Result<crate::domain::events::ChannelEvent> {
        let row = sqlx::query!(
            "SELECT name,owner_id FROM comms_channels WHERE id=$1 AND messaging_binding='whatsapp_group' FOR UPDATE",
            channel
        )
        .fetch_one(&mut **tx)
        .await?;
        sqlx::query!(
            "UPDATE comms_channels SET name=$2,updated_at=now() WHERE id=$1",
            channel,
            name
        )
        .execute(&mut **tx)
        .await?;
        Ok(crate::domain::events::ChannelEvent::ChannelUpdated {
            channel_id: channel,
            actor: MacroUserIdStr::try_from(row.owner_id)?,
            previous_name: row.name,
            channel_name: Some(name.to_owned()),
        })
    }
}

#[async_trait::async_trait]
impl crate::domain::provider::ChannelCallPolicy for PgChannelsRepo {
    type Err = sqlx::Error;
    async fn allows_calls(&self, channel: Uuid) -> Result<bool, Self::Err> {
        Ok(sqlx::query_scalar!("SELECT messaging_binding <> 'whatsapp_group' AS \"allowed!\" FROM comms_channels WHERE id=$1",channel)
            .fetch_optional(&self.pool).await?.unwrap_or(false))
    }
}
