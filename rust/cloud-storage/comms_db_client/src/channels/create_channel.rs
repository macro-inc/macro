use crate::activity;
use anyhow::{Context, Result};
#[allow(unused_imports)]
use model::comms::{ChannelType, ParticipantRole};
use sqlx::{Pool, Postgres};
use uuid::Uuid;

#[derive(Debug)]
pub struct CreateChannelOptions {
    pub name: Option<String>,
    pub owner_id: String,
    pub org_id: Option<i64>,
    pub channel_type: ChannelType,
    pub participants: Vec<String>,
}

pub async fn create_channel(db: &Pool<Postgres>, options: CreateChannelOptions) -> Result<Uuid> {
    let channel_id = macro_uuid::generate_uuid_v7();
    let mut transaction = db.begin().await?;

    // create the channel
    let channel = sqlx::query!(
        r#"
        INSERT INTO comms_channels (id, name, owner_id, org_id, channel_type)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id
        "#,
        channel_id,
        options.name,
        options.owner_id,
        options.org_id,
        options.channel_type as ChannelType
    )
    .fetch_one(&mut *transaction)
    .await
    .context("unable to create channel")?;

    // insert channel owner
    sqlx::query!(
        r#"
        INSERT INTO comms_channel_participants (channel_id, role, user_id)
        VALUES ($1, $2, $3)
        "#,
        channel.id,
        ParticipantRole::Owner as ParticipantRole,
        options.owner_id
    )
    .execute(&mut *transaction)
    .await
    .context("unable to create channel participant for owner")?;

    // Filter out the owner from the participants list
    let participants_without_owner: Vec<String> = options
        .participants
        .into_iter()
        .filter(|p| p != options.owner_id.as_str())
        .collect::<Vec<_>>();

    if !participants_without_owner.is_empty() {
        // insert channel participants
        for participant in participants_without_owner {
            sqlx::query!(
                r#"
                INSERT INTO comms_channel_participants (channel_id, role, user_id)
                VALUES ($1, $2, $3)
                "#,
                channel.id,
                ParticipantRole::Member as ParticipantRole,
                participant
            )
            .execute(&mut *transaction)
            .await
            .context("unable to create channel participant")?;
        }
    }

    // create activity for channel
    activity::create_activity::create_activity(&mut *transaction, &channel.id, &options.owner_id)
        .await
        .context("unable to create activity for channel")?;

    transaction
        .commit()
        .await
        .context("unable to commit transaction")?;

    Ok(channel.id)
}
