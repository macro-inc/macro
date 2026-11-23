use super::*;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn legacy_writers_derive_the_provider_and_deletion_keeps_existing_ownership(db: PgPool) {
    let (_, link) = fixture_for_provider(&db, crate::domain::models::UserProvider::Imap).await;
    sqlx::query!(
        r#"
        INSERT INTO email_message_reconciliation (link_id, generation, provider_id, is_import)
            VALUES ($1, 1, 'queued', false)
        "#,
        link,
    )
    .execute(&db)
    .await
    .unwrap();

    // Older writers omit provider; a caller-supplied routing hint must not
    // override the parent either. Work identities and generation stay intact.

    sqlx::query!(
        r#"
        UPDATE
            email_message_reconciliation
        SET
            provider = 'GMAIL'
        WHERE
            link_id = $1
        "#,
        link,
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
        .into_lease()
        .unwrap();
    let message = imap
        .claim_message(Uuid::from_u128(902))
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(stream.mailbox.link_id, link);
    assert_eq!(stream.mailbox.sync_generation, 1);
    assert_eq!(message.mailbox, stream.mailbox);
    assert_eq!(message.provider_id.as_str(), "queued");

    sqlx::query!(
        r#"
        DELETE FROM email_links
        WHERE id = $1
        "#,
        link,
    )
    .execute(&db)
    .await
    .unwrap();
    let streams = sqlx::query_scalar!(
        r#"
        SELECT
            count(*) AS "count!"
        FROM
            email_sync_streams
        WHERE
            link_id = $1
        "#,
        link,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    let messages = sqlx::query_scalar!(
        r#"
        SELECT
            count(*) AS "count!"
        FROM
            email_message_reconciliation
        WHERE
            link_id = $1
        "#,
        link,
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(streams, 0);
    assert_eq!(messages, 0);
}
