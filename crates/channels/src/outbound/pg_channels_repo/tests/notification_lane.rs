//! A noise notification never satisfies a notification-state filter.

use super::*;
use item_filters::NotificationState::Unseen;

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn noise_does_not_make_a_channel_unread(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_channel_message_notification(&pool, LEFT_USER, TEAM_A_AUTO_ACTIVE, MSG1, false, false)
        .await?;
    insert_channel_message_notification(&pool, LEFT_USER, TEAM_A_MANUAL, MSG1, false, false)
        .await?;
    sqlx::query!(
        "UPDATE user_notification SET lane = 'noise' WHERE user_id = $1 AND event_item_id = $2",
        LEFT_USER,
        TEAM_A_AUTO_ACTIVE.to_string(),
    )
    .execute(&pool)
    .await?;

    assert_eq!(
        channel_ids_matching(&repo(pool), LEFT_USER, channel_state(Unseen)).await,
        HashSet::from([TEAM_A_MANUAL])
    );
    Ok(())
}

#[sqlx::test(
    fixtures(path = "../../../../fixtures", scripts("channels_repo")),
    migrator = "MACRO_DB_MIGRATIONS"
)]
async fn noise_does_not_make_a_thread_unread(pool: Pool<Postgres>) -> anyhow::Result<()> {
    insert_channel_thread_notification(&pool, USER_A, CH1, MSG1, false, false).await?;
    insert_channel_thread_notification(&pool, USER_A, CH1, MSG3, false, false).await?;
    sqlx::query!(
        "UPDATE user_notification un SET lane = 'noise' FROM notification n
         WHERE un.notification_id = n.id AND un.user_id = $1 AND n.secondary_event_item_id = $2",
        USER_A,
        MSG1.to_string(),
    )
    .execute(&pool)
    .await?;
    let unseen = || Expr::val(ChannelThreadLiteral::NotificationState(Unseen));

    // A lone state pages from the roots the viewer was notified about.
    assert_eq!(
        thread_ids_matching(pool.clone(), USER_A, unseen()).await?,
        vec![MSG3]
    );
    // Under OR with another literal it is checked per root on the channel scan.
    assert_eq!(
        thread_ids_matching(
            pool,
            USER_A,
            Expr::or(unseen(), Expr::val(ChannelThreadLiteral::ThreadId(MSG31))),
        )
        .await?,
        vec![MSG3, MSG31]
    );
    Ok(())
}
