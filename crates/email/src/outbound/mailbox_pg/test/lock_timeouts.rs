use super::retries::{Provider, queue, row, sync};
use super::*;
use email_api_client::domain::models::MailboxState;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_page_commit_behind_a_share_locked_link_fails_fast_then_commits(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let lease = repo
        .claim_stream(macro_uuid::generate_uuid_v7(), StreamKind::MailFolder)
        .await
        .unwrap()
        .unwrap();

    // A CRM contact population holds the link this way for its whole transaction.
    let mut population = db.begin().await.unwrap();
    sqlx::query!("SELECT id FROM email_links WHERE id=$1 FOR SHARE", link)
        .fetch_one(&mut *population)
        .await
        .unwrap();

    let blocked = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        repo.commit_page(&lease, &page()),
    )
    .await;
    assert!(
        matches!(
            &blocked,
            Ok(Err(MailboxError::Database(DatabaseFailure::Sqlstate(code)))) if code == "55P03"
        ),
        "{blocked:?}"
    );
    let position = sqlx::query_scalar!(
        "SELECT position FROM email_sync_streams WHERE id = $1",
        lease.id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(position, None);
    let queued = sqlx::query_scalar!(
        "SELECT count(*) FROM email_message_reconciliation WHERE link_id = $1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(queued, Some(0));

    population.rollback().await.unwrap();
    repo.commit_page(&lease, &page()).await.unwrap();
    let position = sqlx::query_scalar!(
        "SELECT position FROM email_sync_streams WHERE id = $1",
        lease.id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(position.as_deref(), Some("opaque-checkpoint"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_message_whose_ingest_times_out_on_a_lock_is_backed_off_never_abandoned(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    // One claim short of the limit that abandons a message failing on its own.
    queue(&db, link, "busy", 49).await;
    let service = sync(
        &repo,
        Provider::answering(vec![Ok(Some(snapshot(
            link,
            "busy",
            MailboxState::default(),
            "v1",
        )))]),
    );

    // A CRM contact population holds the link this way for its whole transaction.
    let mut population = db.begin().await.unwrap();
    sqlx::query!("SELECT id FROM email_links WHERE id=$1 FOR SHARE", link)
        .fetch_one(&mut *population)
        .await
        .unwrap();
    let reconciled =
        tokio::time::timeout(std::time::Duration::from_secs(10), service.reconcile_once()).await;
    assert!(
        matches!(&reconciled, Ok(Err(error)) if error.is_lock_timeout()),
        "{reconciled:?}"
    );
    population.rollback().await.unwrap();

    let waiting = row(&db, link, "busy").await;
    assert_eq!((waiting.abandoned, waiting.attempts), (false, 49));
    assert!(
        (1799..=1800).contains(&waiting.delay_seconds),
        "it waits the longest backoff, got {}",
        waiting.delay_seconds
    );
    assert_eq!(
        sqlx::query_scalar!(
            "SELECT count(*) FROM email_messages WHERE link_id = $1",
            link
        )
        .fetch_one(&db)
        .await
        .unwrap(),
        Some(0)
    );
}
