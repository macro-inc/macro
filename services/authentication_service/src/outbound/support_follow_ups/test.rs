use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn support_channel(db: &PgPool) -> Uuid {
    let macro_user_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'new.user', 'new.user@example.com', 'cus_follow_up_test')",
        macro_user_id,
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|new.user@example.com', 'new.user@example.com', $1)"#,
        macro_user_id,
    )
    .execute(db)
    .await
    .unwrap();

    let channel_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO comms_channels (id, name, channel_type, owner_id) VALUES ($1, 'Support', 'private', 'macro|new.user@example.com')",
        channel_id,
    )
    .execute(db)
    .await
    .unwrap();
    channel_id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_follow_up_is_held_by_one_replica_until_its_claim_expires(db: PgPool) {
    let queue = PgSupportFollowUps::new(db.clone());
    let channel_id = support_channel(&db).await;
    let user = MacroUserIdStr::try_from_email("new.user@example.com").unwrap();
    let message_id = macro_uuid::generate_uuid_v7();

    queue.schedule(channel_id, &user, message_id).await.unwrap();
    queue
        .schedule(channel_id, &user, macro_uuid::generate_uuid_v7())
        .await
        .unwrap();

    queue.note_gmail_attempt(&user).await.unwrap();
    queue.note_checkout(&user).await.unwrap();
    let pending = queue.unclaimed().await.unwrap();
    assert_eq!(pending.len(), 1);
    assert_eq!(pending[0].channel_id, channel_id);
    assert_eq!(pending[0].user_id, user);
    assert!(pending[0].gmail_attempted);
    assert!(pending[0].checkout_opened);

    assert_eq!(queue.claim(channel_id).await.unwrap(), Some(message_id));
    assert_eq!(queue.claim(channel_id).await.unwrap(), None);
    assert!(queue.unclaimed().await.unwrap().is_empty());

    sqlx::query!("UPDATE support_follow_ups SET claimed_until = NOW() - INTERVAL '1 second'")
        .execute(&db)
        .await
        .unwrap();
    assert_eq!(queue.claim(channel_id).await.unwrap(), Some(message_id));

    queue.finish(channel_id).await.unwrap();
    assert!(queue.unclaimed().await.unwrap().is_empty());
    assert_eq!(queue.claim(channel_id).await.unwrap(), None);
}
