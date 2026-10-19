use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn setup(db: &PgPool) -> (PgMailboxSync, Uuid) {
    let (repo, link) = super::super::test::fixture(db).await;
    sqlx::query!("UPDATE email_links SET provider='GMAIL' WHERE id=$1", link)
        .execute(db)
        .await
        .unwrap();
    sqlx::query!(
        "INSERT INTO email_gmail_histories(link_id,history_id) VALUES($1,'10')",
        link
    )
    .execute(db)
    .await
    .unwrap();
    (repo, link)
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn history_advancement_and_child_work_commit_atomically_and_reject_stale_replay(db: PgPool) {
    let (repo, link) = setup(&db).await;
    let work = [
        HistoryWork::Upsert {
            provider_id: "message".into(),
        },
        HistoryWork::Labels {
            provider_id: "labels".into(),
        },
    ];
    repo.commit_history(link, "10", "20", &work).await.unwrap();
    assert!(matches!(
        repo.commit_history(link, "10", "30", &work).await,
        Err(MailboxError::Stale)
    ));
    let cursor = sqlx::query_scalar!(
        "SELECT history_id FROM email_gmail_histories WHERE link_id=$1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(cursor, "20");
    let count = sqlx::query_scalar!(
        "SELECT count(*) FROM email_mailbox_lifecycle_outbox WHERE link_id=$1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(count, Some(2));
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn failed_cursor_commit_rolls_back_every_journaled_child(db: PgPool) {
    let (repo, link) = setup(&db).await;
    sqlx::raw_sql("CREATE FUNCTION reject_cursor() RETURNS trigger LANGUAGE plpgsql AS $$BEGIN RAISE EXCEPTION 'test commit failure';END;$$; CREATE TRIGGER reject_cursor BEFORE UPDATE ON email_gmail_histories FOR EACH ROW EXECUTE FUNCTION reject_cursor();").execute(&db).await.unwrap();
    assert!(
        repo.commit_history(
            link,
            "10",
            "20",
            &[HistoryWork::Delete {
                provider_id: "deleted".into()
            }]
        )
        .await
        .is_err()
    );
    let cursor = sqlx::query_scalar!(
        "SELECT history_id FROM email_gmail_histories WHERE link_id=$1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(cursor, "10");
    let count = sqlx::query_scalar!(
        "SELECT count(*) FROM email_mailbox_lifecycle_outbox WHERE link_id=$1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(count, Some(0));
}
