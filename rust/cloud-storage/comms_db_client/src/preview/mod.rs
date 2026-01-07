use crate::participants::get_participants::get_participants;
use anyhow::{Context, Result};
use model::comms::{ChannelParticipant, ChannelType};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[derive(Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow, Debug)]
pub struct RawPreviewRecord {
    pub channel_id: Uuid,
    pub channel_name: Option<String>,
    pub channel_type: ChannelType,
    pub has_access: bool,
    pub participants: Vec<ChannelParticipant>,
}

#[derive(Clone, serde::Serialize, serde::Deserialize, sqlx::FromRow, Debug)]
pub struct Previews {
    pub exists: Vec<RawPreviewRecord>,
    pub remaining: Vec<String>,
}

#[tracing::instrument(skip(db))]
pub async fn batch_get_channel_preview(
    db: &Pool<Postgres>,
    channel_ids: &Vec<String>,
    user_id: &str,
    org_id: Option<i64>,
) -> Result<Previews> {
    let preview_data = sqlx::query!(
        r#"
        SELECT 
            c.id as channel_id,
            c.name as channel_name,
            c.channel_type as "channel_type: ChannelType",
            (
                SELECT COUNT(*) 
                FROM comms_channel_participants cp_count 
                WHERE cp_count.channel_id = c.id 
                AND cp_count.left_at IS NULL
            ) as "participants!: i32",
            CASE WHEN (
                c.channel_type = 'public'
                OR
                (c.channel_type = 'organization' AND $3::bigint IS NOT NULL AND c.org_id = $3)
                OR
                (c.channel_type IN ('private', 'direct_message') AND EXISTS (
                    SELECT 1 FROM comms_channel_participants cp 
                    WHERE cp.channel_id = c.id 
                    AND cp.user_id = $2
                    AND cp.left_at IS NULL
                ))
            ) THEN true ELSE false END as "has_access!: bool"
        FROM
            comms_channels c
        WHERE
            c.id::text = ANY($1)
            AND (c.channel_type != 'organization' OR $3::bigint IS NOT NULL)
        GROUP BY 
            c.id,
            c.name,
            c.channel_type,
            c.org_id
        "#,
        channel_ids,
        user_id,
        org_id as Option<i64>
    )
    .fetch_all(db)
    .await
    .context("unable to get channels")?;

    let mut previews: Vec<RawPreviewRecord> = vec![];

    for row in preview_data {
        let participants = get_participants(db, &row.channel_id).await?;

        previews.push(RawPreviewRecord {
            channel_id: row.channel_id,
            channel_name: row.channel_name.to_owned(),
            channel_type: row.channel_type,
            has_access: row.has_access,
            participants,
        });
    }

    let previews_ids = previews
        .iter()
        .map(|p| p.channel_id.to_string())
        .collect::<Vec<String>>();

    let remaining = channel_ids
        .iter()
        .filter(|id| !previews_ids.contains(id))
        .map(|id| id.to_owned())
        .collect();

    let result = Previews {
        exists: previews,
        remaining,
    };

    Ok(result)
}

#[cfg(test)]
mod tests {
    use std::str::FromStr;

    use super::*;
    use macro_db_migrator::MACRO_DB_MIGRATIONS;
    use sqlx::{Pool, Postgres};
    use uuid::Uuid;

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("channels"))
    )]
    async fn test_preview_for_private_channel(pool: Pool<Postgres>) -> anyhow::Result<()> {
        const _: &sqlx::migrate::Migrator = &MACRO_DB_MIGRATIONS; // Dummy reference for IDE
        let ids = vec!["11111111-1111-1111-1111-111111111111".to_string()];
        let previews = batch_get_channel_preview(&pool, &ids, "user1", None).await?;
        assert_eq!(previews.exists.len(), 1);
        assert_eq!(
            previews.exists[0].channel_id,
            Uuid::from_str("11111111-1111-1111-1111-111111111111")?
        );
        assert_eq!(
            previews.exists[0].channel_name,
            Some("private 1 ".to_string())
        );
        assert_eq!(previews.exists[0].channel_type, ChannelType::Private);
        assert!(previews.exists[0].has_access);
        assert_eq!(previews.exists[0].participants.len(), 3);

        dbg!(&previews);

        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("channels"))
    )]
    async fn test_access_dm(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let ids = vec!["22222222-2222-2222-2222-222222222222".to_string()];
        let previews = batch_get_channel_preview(&pool, &ids, "user4", None).await?;
        assert_eq!(previews.exists.len(), 1);
        assert!(
            previews.exists[0].has_access,
            "user 1 should have access to this channel"
        );
        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("channels"))
    )]
    async fn test_no_access_dm(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let ids = vec!["22222222-2222-2222-2222-222222222222".to_string()];
        let previews = batch_get_channel_preview(&pool, &ids, "user1", None).await?;
        assert_eq!(previews.exists.len(), 1);
        assert!(
            !previews.exists[0].has_access,
            "user should not have access to this channel"
        );
        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("channels"))
    )]
    async fn test_does_not_exist(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let ids = vec!["44444444-4444-4444-4444-444444444444".to_string()];
        let previews = batch_get_channel_preview(&pool, &ids, "user1", None).await?;
        assert_eq!(previews.exists.len(), 0);
        assert_eq!(previews.remaining.len(), 1);
        Ok(())
    }

    #[sqlx::test(
        migrator = "MACRO_DB_MIGRATIONS",
        fixtures(path = "../../fixtures", scripts("channels"))
    )]
    async fn test_no_access_private(pool: Pool<Postgres>) -> anyhow::Result<()> {
        let ids = vec!["11111111-1111-1111-1111-111111111111".to_string()];
        let previews = batch_get_channel_preview(&pool, &ids, "user4", None).await?;
        assert_eq!(previews.exists.len(), 1);
        assert!(
            !previews.exists[0].has_access,
            "user 4 should not have access to this channel"
        );

        Ok(())
    }
}
