use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_writers_derive_the_provider_and_parent_changes_move_existing_work(db: PgPool) {
    let (_, link) = fixture(&db).await;
    sqlx::query!(
        "INSERT INTO email_message_reconciliation (link_id, generation, provider_id, is_import) VALUES ($1, 1, 'queued', false)",
        link
    )
    .execute(&db)
    .await
    .unwrap();

    // Older writers omit provider; a caller-supplied routing hint must not
    // override the parent either. Work identities and generation stay intact.
    sqlx::query!(
        "UPDATE email_links SET provider = 'IMAP' WHERE id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_message_reconciliation SET provider = 'GMAIL' WHERE link_id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let imap =
        PgMailboxSync::new(db.clone()).with_provider(crate::domain::models::UserProvider::Imap);
    let stream = imap
        .claim_stream(Uuid::from_u128(901), StreamKind::MailFolder)
        .await
        .unwrap()
        .unwrap();
    let message = imap
        .claim_message(Uuid::from_u128(902))
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stream.mailbox.link_id, link);
    assert_eq!(stream.mailbox.sync_generation, 1);
    assert_eq!(message.mailbox, stream.mailbox);
    assert_eq!(message.provider_id.as_str(), "queued");

    sqlx::query!("DELETE FROM email_links WHERE id = $1", link)
        .execute(&db)
        .await
        .unwrap();
    let streams = sqlx::query_scalar!(
        "SELECT count(*) AS \"count!\" FROM email_sync_streams WHERE link_id = $1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    let messages = sqlx::query_scalar!(
        "SELECT count(*) AS \"count!\" FROM email_message_reconciliation WHERE link_id = $1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(streams, 0);
    assert_eq!(messages, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_repeatable_read_provider_change_cannot_strand_a_newly_committed_child(db: PgPool) {
    let (_, link) = fixture(&db).await;
    let mut parent = db.begin().await.unwrap();
    sqlx::query!("SET TRANSACTION ISOLATION LEVEL REPEATABLE READ")
        .execute(&mut *parent)
        .await
        .unwrap();
    // Establish the old snapshot before the separate writer inserts its row.
    sqlx::query!("SELECT id FROM email_links WHERE id = $1", link)
        .fetch_one(&mut *parent)
        .await
        .unwrap();
    sqlx::query!(
        "INSERT INTO email_message_reconciliation (link_id, generation, provider_id, is_import) VALUES ($1, 1, 'new-child', false)",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let error = sqlx::query!(
        "UPDATE email_links SET provider = 'IMAP' WHERE id = $1",
        link
    )
    .execute(&mut *parent)
    .await
    .unwrap_err();
    assert_eq!(
        error.as_database_error().unwrap().code().as_deref(),
        Some("40001")
    );
    parent.rollback().await.unwrap();
    // Retrying with a fresh snapshot propagates both tables atomically.
    sqlx::query!(
        "UPDATE email_links SET provider = 'IMAP' WHERE id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let imap = PgMailboxSync::new(db).with_provider(crate::domain::models::UserProvider::Imap);
    assert!(
        imap.claim_message(Uuid::from_u128(903))
            .await
            .unwrap()
            .is_some()
    );
}
