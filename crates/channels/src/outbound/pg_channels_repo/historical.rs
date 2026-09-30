//! Silent archive persistence and the shared live/archive DM transaction.

use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::{PgConnection, Postgres, Transaction};
use uuid::Uuid;

use crate::domain::{
    dm::DmPair,
    historical::{DmCreation, EnsuredChannel, HistoricalChannel, HistoricalChannelKind},
    models::ChannelType,
    ports::HistoricalChannelRepo,
};

use super::{PgChannelsRepo, create_activity};

#[cfg(test)]
mod test;

impl HistoricalChannelRepo for PgChannelsRepo {
    async fn create_historical_channel(
        &self,
        channel: &HistoricalChannel,
    ) -> anyhow::Result<EnsuredChannel> {
        validate_reserved_id(channel.id)?;
        let (channel_type, team_id) = match channel.kind {
            HistoricalChannelKind::Team(team_id) => (ChannelType::Team, Some(team_id)),
            HistoricalChannelKind::Private => (ChannelType::Private, None),
        };
        let mut tx = self.pool.begin().await?;
        let inserted = sqlx::query_scalar!(
            r#"
            INSERT INTO comms_channels
                (id, name, owner_id, channel_type, team_id, auto_join_team, created_at, updated_at)
            VALUES ($1, $2, $3, $4, $5, false, $6, $6)
            ON CONFLICT (id) DO NOTHING
            RETURNING id
            "#,
            channel.id,
            channel.name,
            channel.owner.as_ref(),
            channel_type as ChannelType,
            team_id,
            channel.created_at,
        )
        .fetch_optional(&mut *tx)
        .await?;
        let created = inserted.is_some();
        if created {
            insert_owner(&mut tx, channel.id, &channel.owner, channel.created_at).await?;
            let participants = channel.participants.iter().cloned().collect::<Vec<_>>();
            insert_members(&mut tx, channel.id, &participants, channel.created_at).await?;
        } else {
            // An explicit ID is not authority to repurpose a different target.
            let existing = sqlx::query!(
                r#"SELECT channel_type AS "channel_type: ChannelType", team_id
                   FROM comms_channels WHERE id = $1 FOR UPDATE"#,
                channel.id,
            )
            .fetch_one(&mut *tx)
            .await?;
            anyhow::ensure!(
                existing.channel_type == channel_type && existing.team_id == team_id,
                "historical channel reservation conflicts with existing target"
            );
        }
        tx.commit().await?;
        Ok(EnsuredChannel {
            id: channel.id,
            created,
        })
    }

    async fn insert_historical_participants(
        &self,
        channel_id: Uuid,
        participants: &[MacroUserIdStr<'static>],
        joined_at: DateTime<Utc>,
    ) -> anyhow::Result<()> {
        let mut tx = self.pool.begin().await?;
        let channel_type = sqlx::query_scalar!(
            r#"SELECT channel_type AS "channel_type: ChannelType"
               FROM comms_channels WHERE id = $1 FOR UPDATE"#,
            channel_id,
        )
        .fetch_one(&mut *tx)
        .await?;
        anyhow::ensure!(
            matches!(channel_type, ChannelType::Team | ChannelType::Private),
            "historical membership insertion requires a Team or Private channel"
        );
        insert_members(&mut tx, channel_id, participants, joined_at).await?;
        tx.commit().await?;
        Ok(())
    }

    async fn advance_historical_activity(
        &self,
        channel_id: Uuid,
        activity_at: DateTime<Utc>,
    ) -> anyhow::Result<()> {
        let mut tx = self.pool.begin().await?;
        advance_historical_activity(&mut tx, channel_id, activity_at).await?;
        tx.commit().await?;
        Ok(())
    }
}

/// Update historical activity inside the composition root's batch transaction.
/// Does not emit events or write per-user activity; never backdates newer live activity.
pub async fn advance_historical_activity(
    tx: &mut Transaction<'_, Postgres>,
    channel_id: Uuid,
    activity_at: DateTime<Utc>,
) -> anyhow::Result<()> {
    let updated = sqlx::query!(
        "UPDATE comms_channels SET updated_at = GREATEST(updated_at, $2) WHERE id = $1",
        channel_id,
        activity_at,
    )
    .execute(&mut **tx)
    .await?;
    anyhow::ensure!(updated.rows_affected() == 1, "historical channel not found");
    Ok(())
}

pub(super) async fn ensure_dm(
    repo: &PgChannelsRepo,
    pair: DmPair,
    creation: DmCreation,
) -> anyhow::Result<EnsuredChannel> {
    let owner = creation.owner(&pair)?;
    let (id, created_at) = match &creation {
        DmCreation::Live(_) => (macro_uuid::generate_uuid_v7(), None),
        DmCreation::Historical { id, created_at } => {
            validate_reserved_id(*id)?;
            (*id, Some(*created_at))
        }
    };
    let mut tx = repo.pool.begin().await?;
    // Length-prefix the first identity so arbitrary valid email characters cannot
    // make two distinct pairs share a lock key. Hash collisions only serialize work.
    let lock_key = format!(
        "channels:dm:{}:{}{}",
        pair.lo().as_ref().len(),
        pair.lo(),
        pair.hi()
    );
    sqlx::query!(
        "SELECT pg_advisory_xact_lock(hashtextextended($1, 0))",
        lock_key
    )
    .execute(&mut *tx)
    .await?;
    // This must be a separate statement after acquiring the lock: READ COMMITTED
    // then observes a concurrent creator that committed while we were waiting.
    if let Some(id) = find_dm(&mut tx, &pair).await? {
        tx.commit().await?;
        return Ok(EnsuredChannel { id, created: false });
    }
    let inserted_at = sqlx::query_scalar!(
        r#"
        INSERT INTO comms_channels
            (id, owner_id, channel_type, auto_join_team, created_at, updated_at)
        VALUES ($1, $2, 'direct_message', false, COALESCE($3, NOW()), COALESCE($3, NOW()))
        ON CONFLICT (id) DO NOTHING
        RETURNING created_at
        "#,
        id,
        owner.as_ref(),
        created_at,
    )
    .fetch_optional(&mut *tx)
    .await?;
    let created_at = inserted_at
        .ok_or_else(|| anyhow::anyhow!("DM reservation conflicts with existing target"))?;
    insert_owner(&mut tx, id, owner, created_at).await?;
    insert_members(
        &mut tx,
        id,
        &[pair.lo().clone(), pair.hi().clone()],
        created_at,
    )
    .await?;
    if matches!(creation, DmCreation::Live(_)) {
        create_activity(&mut *tx, id, owner.as_ref()).await?;
    }
    tx.commit().await?;
    Ok(EnsuredChannel { id, created: true })
}

pub(super) async fn find_dm(
    connection: &mut PgConnection,
    pair: &DmPair,
) -> anyhow::Result<Option<Uuid>> {
    Ok(sqlx::query_scalar!(
        r#"
        SELECT c.id FROM comms_channels c
        WHERE c.channel_type = 'direct_message'
          AND EXISTS (SELECT 1 FROM comms_channel_participants p
                      WHERE p.channel_id = c.id AND p.user_id = $1)
          AND EXISTS (SELECT 1 FROM comms_channel_participants p
                      WHERE p.channel_id = c.id AND p.user_id = $2)
          AND (SELECT COUNT(*) FROM comms_channel_participants p WHERE p.channel_id = c.id) = 2
        ORDER BY c.created_at, c.id
        LIMIT 1
        "#,
        pair.lo().as_ref(),
        pair.hi().as_ref(),
    )
    .fetch_optional(connection)
    .await?)
}

async fn insert_owner(
    tx: &mut Transaction<'_, Postgres>,
    channel_id: Uuid,
    owner: &MacroUserIdStr<'_>,
    joined_at: DateTime<Utc>,
) -> anyhow::Result<()> {
    sqlx::query!(
        r#"INSERT INTO comms_channel_participants (channel_id, user_id, role, joined_at)
           VALUES ($1, $2, 'owner', $3) ON CONFLICT (channel_id, user_id) DO NOTHING"#,
        channel_id,
        owner.as_ref(),
        joined_at,
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

async fn insert_members(
    tx: &mut Transaction<'_, Postgres>,
    channel_id: Uuid,
    participants: &[MacroUserIdStr<'static>],
    joined_at: DateTime<Utc>,
) -> anyhow::Result<()> {
    let user_ids = participants
        .iter()
        .map(ToString::to_string)
        .collect::<Vec<_>>();
    sqlx::query!(
        r#"INSERT INTO comms_channel_participants (channel_id, user_id, role, joined_at)
           SELECT $1, user_id, 'member'::comms_participant_role, $3 FROM UNNEST($2::text[]) AS user_id
           ON CONFLICT (channel_id, user_id) DO NOTHING"#,
        channel_id,
        &user_ids,
        joined_at,
    )
    .execute(&mut **tx)
    .await?;
    Ok(())
}

fn validate_reserved_id(id: Uuid) -> anyhow::Result<()> {
    anyhow::ensure!(
        id.get_variant() == uuid::Variant::RFC4122
            && id.get_version() == Some(uuid::Version::SortRand),
        "historical channel ID must be UUIDv7"
    );
    Ok(())
}
