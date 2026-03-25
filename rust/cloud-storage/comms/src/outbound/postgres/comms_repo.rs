use crate::domain::models::GetChannelsParams;
use crate::domain::ports::CommsRepo;
use chrono::DateTime;
use chrono::Utc;
use doppleganger::{Doppleganger, Mirror};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_comms::channel::{
    Activity, Channel, ChannelId, ChannelMessage, ChannelParticipant, ChannelWithParticipants,
    LatestMessage, OrganizationId,
};
use rootcause::Report;
use sqlx::PgPool;
use std::collections::HashMap;
use uuid::Uuid;

mod dynamic;
pub use dynamic::get_user_channels_dynamic;

#[derive(Debug, Clone, Copy, Doppleganger, sqlx::Type)]
#[sqlx(type_name = "comms_channel_type", rename_all = "snake_case")]
#[dg(forward = models_comms::channel::ChannelType)]
pub enum ChannelType {
    Public,
    Organization,
    Private,
    DirectMessage,
    Team,
}

#[tracing::instrument(skip(db))]
pub async fn get_user_channels_with_participants(
    db: &PgPool,
    user_id: &str,
) -> Result<Vec<ChannelWithParticipants>, sqlx::Error> {
    sqlx::query!(
        r#"
        WITH user_channels AS (
            SELECT DISTINCT c.*
            FROM comms_channels c
            INNER JOIN comms_channel_participants cp ON cp.channel_id = c.id
            WHERE cp.user_id = $1 AND cp.left_at IS NULL
        ),
        channel_participants_json AS (
            SELECT 
                uc.id as channel_id,
                ARRAY_AGG(
                    json_build_object(
                        'channel_id', cp.channel_id,
                        'user_id', cp.user_id,
                        'role', cp.role,
                        'joined_at', cp.joined_at,
                        'left_at', cp.left_at
                    )
                ) as participants
            FROM user_channels uc
            JOIN comms_channel_participants cp ON cp.channel_id = uc.id
            WHERE cp.left_at IS NULL
            GROUP BY uc.id
        )
        SELECT 
            uc.id as "id!",
            uc.name as "name",
            uc.channel_type as "channel_type!: ChannelType",
            uc.team_id,
            uc.org_id,
            uc.created_at as "created_at!",
            uc.updated_at as "updated_at!",
            uc.owner_id as "owner_id!",
            cpj.participants as "participants_json?"
        FROM user_channels uc
        LEFT JOIN channel_participants_json cpj ON cpj.channel_id = uc.id
        ORDER BY uc.created_at DESC
        "#,
        user_id
    )
    .try_map(|row| {
        let channel = Channel {
            id: ChannelId(row.id),
            name: row.name,
            channel_type: ChannelType::mirror(row.channel_type),
            org_id: row.org_id.map(|id| OrganizationId(id as u32)),
            team_id: row.team_id,
            created_at: row.created_at,
            updated_at: row.updated_at,
            owner_id: MacroUserIdStr::parse_from_str(&row.owner_id)
                .map_err(|e| sqlx::Error::Decode(Box::new(e)))?
                .into_owned(),
        };

        let participants = row
            .participants_json
            .map(|json_array| {
                json_array
                    .iter()
                    .filter_map(|json_value| {
                        serde_json::from_value::<ChannelParticipant>(json_value.clone()).ok()
                    })
                    .collect::<Vec<ChannelParticipant>>()
            })
            .unwrap_or_default();

        Ok(ChannelWithParticipants {
            channel,
            participants,
        })
    })
    .fetch_all(db)
    .await
}

#[tracing::instrument(err)]
pub async fn get_latest_channel_messages_batch(
    pool: &PgPool,
    channel_ids: &[ChannelId],
) -> Result<HashMap<ChannelId, LatestMessage>, Report> {
    if channel_ids.is_empty() {
        return Ok(HashMap::new());
    }

    let ids: Vec<Uuid> = channel_ids.iter().map(|x| x.0).collect();

    let rows = sqlx::query!(
        r#"
        WITH input_ids AS (
            SELECT UNNEST($1::uuid[]) AS channel_id
        )
        SELECT
            i.channel_id                                          AS "channel_id!",
            l.message_id                                           AS "l_message_id?: uuid::Uuid",
            l.thread_id                                            AS "l_thread_id?: uuid::Uuid",
            l.sender_id                                            AS "l_sender_id?: String",
            l.content                                              AS "l_content?: String",
            l.created_at                                           AS "l_created_at?: chrono::DateTime<chrono::Utc>",
            l.updated_at                                           AS "l_updated_at?: chrono::DateTime<chrono::Utc>",
            l.deleted_at                                           AS "l_deleted_at?: chrono::DateTime<chrono::Utc>",
            l.mentions                                             AS "l_mentions?: Vec<String>",
            n.message_id                                           AS "n_message_id?: uuid::Uuid",
            n.thread_id                                            AS "n_thread_id?: uuid::Uuid",
            n.sender_id                                            AS "n_sender_id?: String",
            n.content                                              AS "n_content?: String",
            n.created_at                                           AS "n_created_at?: chrono::DateTime<chrono::Utc>",
            n.updated_at                                           AS "n_updated_at?: chrono::DateTime<chrono::Utc>",
            n.deleted_at                                           AS "n_deleted_at?: chrono::DateTime<chrono::Utc>",
            n.mentions                                             AS "n_mentions?: Vec<String>"
        FROM input_ids i
        LEFT JOIN LATERAL (
            SELECT
                m.id AS message_id,
                m.thread_id,
                m.sender_id,
                m.content,
                m.created_at,
                m.updated_at,
                m.deleted_at::timestamptz AS deleted_at,
                COALESCE(
                    ARRAY(
                        SELECT entity_type || ':' || entity_id
                        FROM comms_entity_mentions em
                        WHERE em.source_entity_type = 'message'
                          AND em.source_entity_id = m.id::text
                    ),
                    '{}'::text[]
                ) AS mentions
            FROM comms_messages m
            WHERE m.channel_id = i.channel_id
              AND m.deleted_at IS NULL
            ORDER BY m.created_at DESC
            LIMIT 1
        ) l ON TRUE
        LEFT JOIN LATERAL (
            SELECT
                m.id AS message_id,
                m.thread_id,
                m.sender_id,
                m.content,
                m.created_at,
                m.updated_at,
                m.deleted_at::timestamptz AS deleted_at,
                COALESCE(
                    ARRAY(
                        SELECT entity_type || ':' || entity_id
                        FROM comms_entity_mentions em
                        WHERE em.source_entity_type = 'message'
                          AND em.source_entity_id = m.id::text
                    ),
                    '{}'::text[]
                ) AS mentions
            FROM comms_messages m
            WHERE m.channel_id = i.channel_id
              AND m.deleted_at IS NULL
              AND m.thread_id IS NULL
            ORDER BY m.created_at DESC
            LIMIT 1
        ) n ON TRUE
        "#,
        &ids
    )
    .fetch_all(pool)
    .await?;

    let mut result = HashMap::with_capacity(rows.len());

    let build_message = |message_id: Option<Uuid>,
                         thread_id: Option<Uuid>,
                         sender_id: Option<String>,
                         content: Option<String>,
                         created_at: Option<chrono::DateTime<chrono::Utc>>,
                         updated_at: Option<chrono::DateTime<chrono::Utc>>,
                         deleted_at: Option<chrono::DateTime<chrono::Utc>>,
                         mentions: Option<Vec<String>>| {
        match (message_id, sender_id, content, created_at, updated_at) {
            (
                Some(message_id),
                Some(sender_id),
                Some(content),
                Some(created_at),
                Some(updated_at),
            ) => Some(ChannelMessage {
                message_id,
                thread_id,
                sender_id,
                content,
                created_at,
                updated_at,
                deleted_at,
                mentions: mentions.unwrap_or_default(),
            }),
            (None, _, _, _, _) => None,
            _ => {
                tracing::warn!("incomplete latest message row; skipping");
                None
            }
        }
    };

    for row in rows {
        let latest_message = build_message(
            row.l_message_id,
            row.l_thread_id,
            row.l_sender_id,
            row.l_content,
            row.l_created_at,
            row.l_updated_at,
            row.l_deleted_at,
            row.l_mentions,
        );

        let latest_non_thread_message = build_message(
            row.n_message_id,
            row.n_thread_id,
            row.n_sender_id,
            row.n_content,
            row.n_created_at,
            row.n_updated_at,
            row.n_deleted_at,
            row.n_mentions,
        );

        result.insert(
            ChannelId(row.channel_id),
            LatestMessage {
                latest_message,
                latest_non_thread_message,
            },
        );
    }

    Ok(result)
}

pub async fn get_latest_channel_message(
    pool: &PgPool,
    channel_id: ChannelId,
) -> Result<LatestMessage, Report> {
    let res = get_latest_channel_messages_batch(pool, &[channel_id]).await?;
    Ok(res.get(&channel_id).cloned().unwrap_or(LatestMessage {
        latest_message: None,
        latest_non_thread_message: None,
    }))
}
#[tracing::instrument(skip(db), err)]
pub async fn get_activities(
    db: &PgPool,
    user_id: MacroUserIdStr<'_>,
) -> Result<Vec<Activity>, Report> {
    Ok(sqlx::query!(
        r#"
        SELECT 
            a.id as "id!: Uuid",
            a.user_id as "user_id!: String",
            a.channel_id as "channel_id!: Uuid",
            a.viewed_at as "viewed_at?: DateTime<Utc>",
            a.interacted_at as "interacted_at?: DateTime<Utc>",
            a.created_at as "created_at!: DateTime<Utc>",
            a.updated_at as "updated_at!: DateTime<Utc>"
        FROM comms_activity a
        WHERE a.user_id = $1
        ORDER BY 
            GREATEST(
                COALESCE(a.viewed_at, '1970-01-01'::timestamp),
                COALESCE(a.interacted_at, '1970-01-01'::timestamp)
            ) DESC,
            a.created_at DESC
        LIMIT 100
        "#,
        user_id.as_ref()
    )
    .map(|row| Activity {
        id: row.id,
        user_id: row.user_id,
        channel_id: ChannelId(row.channel_id),
        created_at: row.created_at,
        updated_at: row.updated_at,
        viewed_at: row.viewed_at,
        interacted_at: row.interacted_at,
    })
    .fetch_all(db)
    .await?)
}

pub struct PgCommsRepo {
    pub pool: PgPool,
}

impl CommsRepo for PgCommsRepo {
    async fn get_user_channels_with_participants(
        &self,
        req: GetChannelsParams,
    ) -> Result<Vec<ChannelWithParticipants>, rootcause::Report> {
        Ok(get_user_channels_dynamic(&self.pool, &req).await?)
    }

    async fn get_latest_channel_messages_batch(
        &self,
        channels: &[ChannelId],
    ) -> Result<
        std::collections::HashMap<ChannelId, models_comms::channel::LatestMessage>,
        rootcause::Report,
    > {
        get_latest_channel_messages_batch(&self.pool, channels).await
    }

    async fn get_activities(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<models_comms::channel::Activity>, rootcause::Report> {
        get_activities(&self.pool, user_id).await
    }
}
