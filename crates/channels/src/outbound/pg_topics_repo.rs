//! Postgres storage for channel topics.
use crate::domain::topics::{ChannelTopic, TopicRepository};
use sqlx::PgPool;
use uuid::Uuid;

#[cfg(test)]
mod tests;

/// Topic repository backed by MacroDB.
#[derive(Clone)]
pub struct PgTopicsRepo {
    pool: PgPool,
}

impl PgTopicsRepo {
    /// Construct a Postgres topic adapter.
    pub fn new(pool: PgPool) -> Self {
        Self { pool }
    }
}

#[async_trait::async_trait]
impl TopicRepository for PgTopicsRepo {
    async fn user_team(&self, user_id: &str) -> anyhow::Result<Option<Uuid>> {
        Ok(sqlx::query_scalar!(
            "SELECT team_id FROM team_user WHERE user_id = $1 LIMIT 1",
            user_id
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    async fn topic_team(&self, topic_id: Uuid) -> anyhow::Result<Option<Uuid>> {
        Ok(sqlx::query_scalar!(
            "SELECT team_id FROM comms_channel_topics WHERE id = $1",
            topic_id
        )
        .fetch_optional(&self.pool)
        .await?)
    }

    async fn team_channel_team(&self, channel_id: Uuid) -> anyhow::Result<Option<Uuid>> {
        Ok(sqlx::query_scalar!(
            "SELECT team_id FROM comms_channels WHERE id = $1 AND channel_type = 'team'::comms_channel_type",
            channel_id
        ).fetch_optional(&self.pool).await?.flatten())
    }

    async fn create(
        &self,
        id: Uuid,
        team_id: Uuid,
        name: &str,
        description: Option<&str>,
        user_id: &str,
    ) -> anyhow::Result<()> {
        sqlx::query!(
            "INSERT INTO comms_channel_topics (id, team_id, name, description, sort_order, created_by)
             VALUES ($1, $2, $3, $4, COALESCE((SELECT MAX(sort_order) + 1 FROM comms_channel_topics WHERE team_id = $2), 0), $5)",
            id, team_id, name, description, user_id
        ).execute(&self.pool).await?;
        Ok(())
    }

    async fn update(
        &self,
        id: Uuid,
        name: Option<&str>,
        description: Option<&str>,
    ) -> anyhow::Result<()> {
        sqlx::query!(
            "UPDATE comms_channel_topics SET name = COALESCE($2, name), description = COALESCE($3, description) WHERE id = $1",
            id, name, description
        ).execute(&self.pool).await?;
        Ok(())
    }

    async fn delete(&self, id: Uuid) -> anyhow::Result<()> {
        sqlx::query!("DELETE FROM comms_channel_topics WHERE id = $1", id)
            .execute(&self.pool)
            .await?;
        Ok(())
    }

    async fn add_channel(
        &self,
        topic_id: Uuid,
        channel_id: Uuid,
        user_id: &str,
    ) -> anyhow::Result<()> {
        sqlx::query!(
            "INSERT INTO comms_channel_topic_channels (topic_id, channel_id, added_by)
             VALUES ($1, $2, $3) ON CONFLICT (topic_id, channel_id) DO NOTHING",
            topic_id,
            channel_id,
            user_id
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn remove_channel(&self, topic_id: Uuid, channel_id: Uuid) -> anyhow::Result<()> {
        sqlx::query!(
            "DELETE FROM comms_channel_topic_channels WHERE topic_id = $1 AND channel_id = $2",
            topic_id,
            channel_id
        )
        .execute(&self.pool)
        .await?;
        Ok(())
    }

    async fn list(&self, team_id: Uuid, user_id: &str) -> anyhow::Result<Vec<ChannelTopic>> {
        let rows = sqlx::query!(
            r#"
            SELECT t.id, t.team_id, t.name, t.description, t.sort_order,
                   p.sort_position,
                   (SELECT COUNT(*) FROM comms_channel_topic_channels tc WHERE tc.topic_id = t.id) AS "channel_count!",
                   COALESCE(
                       (SELECT array_agg(tc.channel_id)
                        FROM comms_channel_topic_channels tc
                        JOIN comms_channel_participants cp ON cp.channel_id = tc.channel_id
                        WHERE tc.topic_id = t.id AND cp.user_id = $2 AND cp.left_at IS NULL),
                       '{}'::uuid[]
                   ) AS "channel_ids!"
            FROM comms_channel_topics t
            LEFT JOIN comms_user_channel_topic_prefs p ON p.topic_id = t.id AND p.user_id = $2
            WHERE t.team_id = $1
            ORDER BY COALESCE(p.sort_position, t.sort_order), t.name
            "#,
            team_id, user_id
        ).fetch_all(&self.pool).await?;
        Ok(rows
            .into_iter()
            .map(|row| ChannelTopic {
                id: row.id,
                team_id: row.team_id,
                name: row.name,
                description: row.description,
                sort_order: row.sort_order,
                sort_position: row.sort_position,
                channel_count: row.channel_count,
                channel_ids: row.channel_ids,
            })
            .collect())
    }

    async fn set_order(&self, user_id: &str, ids: &[Uuid]) -> anyhow::Result<()> {
        let mut transaction = self.pool.begin().await?;
        for (index, id) in ids.iter().enumerate() {
            sqlx::query!(
                "INSERT INTO comms_user_channel_topic_prefs (user_id, topic_id, sort_position)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (user_id, topic_id) DO UPDATE
                 SET sort_position = EXCLUDED.sort_position, updated_at = now()",
                user_id,
                id,
                index as f64
            )
            .execute(&mut *transaction)
            .await?;
        }
        transaction.commit().await?;
        Ok(())
    }
}
