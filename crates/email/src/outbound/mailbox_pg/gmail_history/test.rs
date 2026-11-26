use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn setup(db: &PgPool) -> (PgMailboxSync, Uuid) {
    let (repo, link) =
        super::super::test::fixture_for_provider(db, crate::domain::models::UserProvider::Gmail)
            .await;

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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_history_commit_proceeds_while_a_crm_population_share_locks_the_link(db: PgPool) {
    let (repo, link) = setup(&db).await;

    // A CRM contact population holds the link this way for its whole transaction.
    let mut population = db.begin().await.unwrap();
    sqlx::query!("SELECT id FROM email_links WHERE id=$1 FOR SHARE", link)
        .fetch_one(&mut *population)
        .await
        .unwrap();

    let work = [HistoryWork::Upsert {
        provider_id: "message".into(),
    }];
    let committed = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        repo.commit_history(link, "10", "20", &work),
    )
    .await;
    assert!(matches!(committed, Ok(Ok(()))), "{committed:?}");
    population.rollback().await.unwrap();

    let cursor = sqlx::query_scalar!(
        "SELECT history_id FROM email_gmail_histories WHERE link_id=$1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(cursor, "20");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_history_commit_behind_a_disconnect_fails_fast_then_sees_the_disconnect(db: PgPool) {
    let (repo, link) = setup(&db).await;

    let mut disconnect = db.begin().await.unwrap();
    sqlx::query!(
        "UPDATE email_links SET is_sync_active=false,disconnect_requested_at=now(),sync_generation=sync_generation+1 WHERE id=$1",
        link
    )
    .execute(&mut *disconnect)
    .await
    .unwrap();

    let work = [HistoryWork::Upsert {
        provider_id: "message".into(),
    }];
    let blocked = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        repo.commit_history(link, "10", "20", &work),
    )
    .await;
    assert!(
        matches!(
            &blocked,
            Ok(Err(MailboxError::Database(DatabaseFailure::Sqlstate(code)))) if code == "55P03"
        ),
        "{blocked:?}"
    );

    disconnect.commit().await.unwrap();
    assert!(matches!(
        repo.commit_history(link, "10", "20", &work).await,
        Err(MailboxError::Stale)
    ));

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
