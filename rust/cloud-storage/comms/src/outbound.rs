use doppleganger::{Doppleganger, Mirror};
use macro_user_id::cowlike::CowLike;
use models_comms::channel::{
    Channel, ChannelId, ChannelParticipant, ChannelWithParticipants, OrganizationId,
};
use sqlx::{Pool, Postgres};

#[derive(Debug, Clone, Copy, Doppleganger, sqlx::Type)]
#[sqlx(type_name = "comms_channel_type", rename_all = "snake_case")]
#[dg(forward = models_comms::channel::ChannelType)]
pub enum ChannelType {
    Public,
    Organization,
    Private,
    DirectMessage,
}

#[tracing::instrument(skip(db))]
pub async fn get_user_channels_with_participants(
    db: &Pool<Postgres>,
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
            created_at: row.created_at,
            updated_at: row.updated_at,
            owner_id: macro_user_id::user_id::MacroUserIdStr::parse_from_str(&row.owner_id)
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
