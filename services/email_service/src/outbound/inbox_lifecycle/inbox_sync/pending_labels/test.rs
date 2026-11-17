use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

const MESSAGE: Uuid = Uuid::from_u128(0xa);

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("gmail_ops_label_revert"))
)]
async fn a_write_gmail_confirms_during_the_read_is_not_trusted_from_it(pool: PgPool) {
    let read = read_around(
        &pool,
        MESSAGE,
        Box::pin(async {
            // gmail_ops applies the archive and clears its marker while Gmail's
            // answer, still showing INBOX, is on its way.
            sqlx::query!(
                "DELETE FROM email_gmail_pending_label_writes WHERE message_id = $1",
                MESSAGE
            )
            .execute(&pool)
            .await
            .unwrap();
            vec!["INBOX".to_string()]
        }),
    )
    .await
    .unwrap();

    assert_eq!(read.untrusted_labels(), vec!["INBOX".to_string()]);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("gmail_ops_label_revert"))
)]
async fn a_write_staged_during_the_read_is_not_trusted_from_it(pool: PgPool) {
    let read = read_around(&pool, MESSAGE, Box::pin(async {
        sqlx::query!(
            r#"
            INSERT INTO email_gmail_pending_label_writes
                (message_id, provider_label_id, write_id, label_present, label_present_before, expires_at)
            VALUES ($1, 'STARRED', $2, true, false, now() + interval '12 hours')
            "#,
            MESSAGE,
            Uuid::from_u128(0xf9),
        )
        .execute(&pool)
        .await
        .unwrap();
    }))
    .await
    .unwrap();

    assert_eq!(
        read.untrusted_labels(),
        vec!["INBOX".to_string(), "STARRED".to_string()]
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../../../fixtures", scripts("gmail_ops_label_revert"))
)]
async fn a_resync_snapshot_has_the_labels_stored_before_the_fetch(pool: PgPool) {
    let (fetched, snapshot) = resync_around(
        &pool,
        MESSAGE,
        Box::pin(async {
            sqlx::query!(
                "INSERT INTO email_message_labels (message_id, label_id) VALUES ($1, $2)",
                MESSAGE,
                Uuid::from_u128(0xc1),
            )
            .execute(&pool)
            .await
            .unwrap();
            "fetched"
        }),
    )
    .await
    .unwrap();

    assert_eq!(fetched, "fetched");
    assert!(snapshot.stored_labels.is_empty());
    assert_eq!(snapshot.pending_labels, vec!["INBOX".to_string()]);
}
