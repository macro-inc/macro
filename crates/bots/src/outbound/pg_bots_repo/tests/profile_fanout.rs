use super::*;
use crate::domain::{
    models::BotOwnerProfile, ports::BotProfilePublisher, profile_fanout::BotProfileFanout,
};
use rootcause::Report;

/// A published profile and its sorted recipients.
type Published = (BotOwnerProfile, Vec<String>);

#[derive(Clone, Default)]
struct RecordingProfilePublisher {
    published: Arc<Mutex<Vec<Published>>>,
}

impl RecordingProfilePublisher {
    fn published(&self) -> Vec<Published> {
        self.published
            .lock()
            .expect("publisher lock poisoned")
            .clone()
    }
}

impl BotProfilePublisher for RecordingProfilePublisher {
    async fn publish_profile(
        &self,
        profile: BotOwnerProfile,
        recipients: Vec<MacroUserIdStr<'static>>,
    ) -> Result<(), Report> {
        let mut recipients = recipients
            .iter()
            .map(|recipient| recipient.as_ref().to_string())
            .collect::<Vec<_>>();
        recipients.sort();
        self.published
            .lock()
            .expect("publisher lock poisoned")
            .push((profile, recipients));
        Ok(())
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_renamed_team_bot_reaches_its_team_and_the_people_in_its_channels(
    pool: PgPool,
) -> anyhow::Result<()> {
    let team_id = macro_uuid::generate_uuid_v7();
    insert_team_user(&pool, team_id, TEAM_ADMIN, "admin").await?;
    insert_team_user(&pool, team_id, TEAM_MEMBER, "member").await?;
    let service = service(&pool);
    let mut request = create_req("fanout-team");
    request.team_id = Some(team_id);
    let bot = service.create_bot(user_id(TEAM_ADMIN), request).await?;

    let channel_id = macro_uuid::generate_uuid_v7();
    insert_channel_member(&pool, channel_id, USER_OTHER).await?;
    sqlx::query!(
        r#"
        INSERT INTO comms_channel_participants (channel_id, user_id, role, left_at)
        VALUES
            ($1, 'macro|bot-left-channel@example.com', 'member'::comms_participant_role, now()),
            ($1, 'bot|0196f0a4-6d5e-7c3a-9f00-000000000001', 'member'::comms_participant_role, NULL)
        "#,
        channel_id,
    )
    .execute(&pool)
    .await?;
    PgBotsRepo::new(pool.clone())
        .add_bot_to_channel(channel_id, bot.id)
        .await?;

    service
        .patch_bot(
            user_id(TEAM_ADMIN),
            bot.id,
            PatchBotRequest {
                name: Some("Renamed alerts".to_string()),
                handle: None,
                description: None,
                avatar_url: Some("https://static.example/alerts.png".to_string()),
                has_agent: None,
            },
        )
        .await?;

    let publisher = RecordingProfilePublisher::default();
    BotProfileFanout::new(PgBotsRepo::new(pool.clone()), publisher.clone())
        .publish(bot.id)
        .await
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;

    let published = publisher.published();
    assert_eq!(published.len(), 1);
    let (profile, recipients) = &published[0];
    assert_eq!(profile.id, bot.id);
    assert_eq!(profile.name, "Renamed alerts");
    assert_eq!(
        profile.avatar_url.as_deref(),
        Some("https://static.example/alerts.png")
    );
    assert_eq!(profile.deleted_at, None);
    assert_eq!(
        recipients,
        &vec![
            USER_OTHER.to_string(),
            TEAM_ADMIN.to_string(),
            TEAM_MEMBER.to_string(),
        ]
    );
    Ok(())
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_deleted_bot_reaches_the_people_in_the_channels_its_deletion_left(
    pool: PgPool,
) -> anyhow::Result<()> {
    let service = service(&pool);
    let bot = service
        .create_bot(user_id(USER_OWNER), create_req("fanout-deleted"))
        .await?;
    let repo = PgBotsRepo::new(pool.clone());

    let kept_channel_id = macro_uuid::generate_uuid_v7();
    insert_channel_member(&pool, kept_channel_id, USER_OTHER).await?;
    repo.add_bot_to_channel(kept_channel_id, bot.id).await?;

    let earlier_channel_id = macro_uuid::generate_uuid_v7();
    insert_channel_member(&pool, earlier_channel_id, TEAM_OTHER).await?;
    repo.add_bot_to_channel(earlier_channel_id, bot.id).await?;
    repo.remove_bot_from_channel(earlier_channel_id, bot.id)
        .await?;

    service.delete_bot(user_id(USER_OWNER), bot.id).await?;

    let publisher = RecordingProfilePublisher::default();
    BotProfileFanout::new(repo, publisher.clone())
        .publish(bot.id)
        .await
        .map_err(|error| anyhow::anyhow!("{error:?}"))?;

    let published = publisher.published();
    assert_eq!(published.len(), 1);
    let (profile, recipients) = &published[0];
    assert!(profile.deleted_at.is_some());
    assert_eq!(
        recipients,
        &vec![USER_OTHER.to_string(), USER_OWNER.to_string()]
    );
    Ok(())
}
