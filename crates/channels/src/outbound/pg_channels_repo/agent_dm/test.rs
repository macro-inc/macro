use super::*;
use crate::domain::channel_agents::{ChannelAgent, ChannelAgentKind, ChannelAgentRepo};
use crate::domain::ports::ChannelRepo;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

fn user() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from("macro|agent-dm@example.com".to_owned()).unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn other_people_and_bots_cannot_be_added_to_a_persona_dm(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let dm = repo
        .ensure(user(), bot_id::MACRO_NEW_BOT_ID)
        .await
        .unwrap()
        .dm;
    for principal in [
        "macro|teammate@example.com".to_owned(),
        bot_id::MACRO_CODER_BOT_ID.into_storage_id().to_string(),
    ] {
        let error = sqlx::query!(
            "INSERT INTO comms_channel_participants (channel_id, user_id, role) VALUES ($1, $2, 'member')",
            dm.channel_id, principal
        ).execute(&pool).await.unwrap_err();
        assert_eq!(
            error.as_database_error().unwrap().code().as_deref(),
            Some("23514")
        );
    }
    assert_eq!(repo.for_user(user()).await.unwrap(), vec![dm]);
    assert!(
        repo.for_user(MacroUserIdStr::try_from_email("teammate@example.com").unwrap())
            .await
            .unwrap()
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_opens_create_one_channel_and_two_memberships(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let (left, right) = tokio::join!(
        repo.ensure(user(), bot_id::MACRO_NEW_BOT_ID),
        repo.ensure(user(), bot_id::MACRO_NEW_BOT_ID),
    );
    let left = left.unwrap();
    let right = right.unwrap();
    assert_eq!(left.dm, right.dm);
    assert_ne!(left.created, right.created);
    let participants = sqlx::query!(
        "SELECT user_id, role::text AS \"role!\" FROM comms_channel_participants WHERE channel_id = $1 AND left_at IS NULL",
        left.dm.channel_id,
    ).fetch_all(&pool).await.unwrap();
    assert_eq!(participants.len(), 2);
    assert!(
        participants
            .iter()
            .any(|p| p.user_id == user().as_ref() && p.role == "owner")
    );
    assert!(
        participants
            .iter()
            .any(|p| p.user_id == bot_id::MACRO_NEW_BOT_ID.into_storage_id().as_ref())
    );
    let count = sqlx::query_scalar!("SELECT COUNT(*) FROM comms_channels")
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(
        count,
        Some(1),
        "the losing request must not leave an orphan channel"
    );
    assert_eq!(
        repo.find(left.dm.channel_id, bot_id::MACRO_NEW_BOT_ID)
            .await
            .unwrap(),
        Some(ChannelAgent {
            channel_id: left.dm.channel_id,
            bot_id: bot_id::MACRO_NEW_BOT_ID,
            kind: ChannelAgentKind::Direct { user_id: user() },
        })
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn conversations_are_isolated_by_both_user_and_persona(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool);
    let first = repo.ensure(user(), bot_id::MACRO_NEW_BOT_ID).await.unwrap();
    let other_user = MacroUserIdStr::try_from("macro|someone-else@example.com".to_owned()).unwrap();
    let second = repo
        .ensure(other_user, bot_id::MACRO_NEW_BOT_ID)
        .await
        .unwrap();
    let third = repo
        .ensure(user(), bot_id::MACRO_CODER_BOT_ID)
        .await
        .unwrap();
    assert_ne!(first.dm.channel_id, second.dm.channel_id);
    assert_ne!(first.dm.channel_id, third.dm.channel_id);
    assert_ne!(second.dm.channel_id, third.dm.channel_id);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reopening_restores_membership_and_deletion_removes_the_pair(pool: PgPool) {
    let repo = PgChannelsRepo::new(pool.clone());
    let first = repo.ensure(user(), bot_id::MACRO_NEW_BOT_ID).await.unwrap();
    sqlx::query!(
        "UPDATE comms_channel_participants SET left_at = now() WHERE channel_id = $1",
        first.dm.channel_id
    )
    .execute(&pool)
    .await
    .unwrap();
    let reopened = repo.ensure(user(), bot_id::MACRO_NEW_BOT_ID).await.unwrap();
    assert_eq!(reopened.dm, first.dm);
    assert!(!reopened.created);
    let members = sqlx::query_scalar!(
        "SELECT COUNT(*) FROM comms_channel_participants WHERE channel_id = $1 AND left_at IS NULL",
        first.dm.channel_id,
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(members, Some(2));
    // The existing human roster endpoint deliberately excludes bot principals.
    assert_eq!(
        repo.get_channel_participants(first.dm.channel_id)
            .await
            .unwrap()
            .len(),
        1
    );
    sqlx::query!(
        "DELETE FROM comms_channels WHERE id = $1",
        first.dm.channel_id
    )
    .execute(&pool)
    .await
    .unwrap();
    assert!(
        repo.agents_in(first.dm.channel_id)
            .await
            .unwrap()
            .is_empty()
    );
    let recreated = repo.ensure(user(), bot_id::MACRO_NEW_BOT_ID).await.unwrap();
    assert!(recreated.created);
    assert_ne!(recreated.dm.channel_id, first.dm.channel_id);
}
