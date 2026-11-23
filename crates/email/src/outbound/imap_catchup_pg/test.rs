use super::*;
use crate::domain::mailbox::imap_notifications::ImapNotificationService;
use crate::domain::mailbox::{MailboxSyncRepository, SyncRetry};
use crate::outbound::mailbox_pg::PgMailboxSync;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

async fn seed(db: &PgPool, count: u128) -> (Uuid, Vec<Uuid>, PgImapCatchup) {
    let link = Uuid::from_u128(1000);
    sqlx::query!(
        r#"
        INSERT INTO email_links (id, macro_id, fusionauth_user_id, email_address, provider, grant_generation)
        VALUES ($1, 'macro|catchup-owner@example.com', 'catchup-owner', 'catchup-owner@example.com', 'IMAP', 1)
        "#,
        link,
    ).execute(db).await.unwrap();
    let ids = (1..=count).map(Uuid::from_u128).collect::<Vec<_>>();
    sqlx::query!(
        r#"
        INSERT INTO email_sync_streams (id, link_id, generation, kind, scope_id, position, initial_complete, next_run_at)
        SELECT id, $2, 1, 'mail_folder', id::text, 'kept-cursor', true, now() + interval '1 day'
        FROM unnest($1::uuid[]) AS streams(id)
        "#,
        &ids,
        link,
    ).execute(db).await.unwrap();
    (link, ids, PgImapCatchup(db.clone()))
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_locked_startup_stream_does_not_block_others_and_retries_once_when_also_dirty(
    db: PgPool,
) {
    let (link, ids, job) = seed(&db, 3).await;
    let mut lock = db.begin().await.unwrap();
    sqlx::query!(
        "SELECT id FROM email_sync_streams WHERE id = $1 FOR UPDATE",
        ids[0]
    )
    .fetch_one(&mut *lock)
    .await
    .unwrap();
    let lease = job.claim(Uuid::now_v7(), 120).await.unwrap().unwrap();
    let first = tokio::time::timeout(std::time::Duration::from_secs(3), job.advance(&lease, 2, 0))
        .await
        .unwrap()
        .unwrap();
    assert_eq!((first.scanned, first.woken, first.deferred), (2, 1, 1));
    assert!(!first.complete);
    let lease = job.claim(Uuid::now_v7(), 120).await.unwrap().unwrap();
    assert_eq!(lease.after, ids[1]);
    let second = job.advance(&lease, 2, 0).await.unwrap();
    assert_eq!((second.scanned, second.woken), (1, 1));
    assert!(second.complete);
    lock.rollback().await.unwrap();
    // A real normal hint overlaps the deferred item, but the page must handle
    // it once. The current lease/cursor is never reset by this callback.
    ImapNotificationService(PgMailboxSync::new(db.clone()))
        .receive(imap_engine::domain::models::Notification {
            binding: imap_engine::domain::models::Binding {
                link_id: link,
                sync_generation: 1,
                grant_generation: 1,
            },
            credentials_rejected: false,
            revision: None,
            mailbox_issue: None,
            sync_retry_at: None,
        })
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE email_imap_host_catchup_deferred SET available_at = now() WHERE stream_id = $1",
        ids[0]
    )
    .execute(&db)
    .await
    .unwrap();
    let lease = job.claim(Uuid::now_v7(), 120).await.unwrap().unwrap();
    assert_eq!(lease.mode, CatchupMode::Pending);
    let third = job.advance(&lease, 16, 0).await.unwrap();
    assert_eq!((third.scanned, third.woken), (3, 3));
    let pending = sqlx::query_scalar!("SELECT count(*) FROM email_imap_host_catchup_deferred")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(pending, Some(0));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleted_deferred_streams_are_removed_in_one_page_and_cannot_spin(db: PgPool) {
    let (_, ids, job) = seed(&db, 1).await;
    let mut lock = db.begin().await.unwrap();
    sqlx::query!(
        "SELECT id FROM email_sync_streams WHERE id = $1 FOR UPDATE",
        ids[0]
    )
    .fetch_one(&mut *lock)
    .await
    .unwrap();
    let lease = job.claim(Uuid::now_v7(), 120).await.unwrap().unwrap();
    assert_eq!(job.advance(&lease, 16, 0).await.unwrap().deferred, 1);
    lock.rollback().await.unwrap();
    sqlx::query!("DELETE FROM email_sync_streams WHERE id = $1", ids[0])
        .execute(&db)
        .await
        .unwrap();
    sqlx::query!("UPDATE email_imap_host_catchup_deferred SET available_at = now(), created_at = now() - interval '1 day'")
        .execute(&db).await.unwrap();
    let lease = job.claim(Uuid::now_v7(), 120).await.unwrap().unwrap();
    let cleanup = job.advance(&lease, 16, 0).await.unwrap();
    assert_eq!(cleanup.scanned, 1);
    assert!(cleanup.deferred_age_seconds_max >= 86400);
    let lease = job.claim(Uuid::now_v7(), 120).await.unwrap().unwrap();
    assert_eq!(job.advance(&lease, 16, 0).await.unwrap().scanned, 0);
    let pending = sqlx::query_scalar!("SELECT count(*) FROM email_imap_host_catchup_deferred")
        .fetch_one(&db)
        .await
        .unwrap();
    assert_eq!(pending, Some(0));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn repeatedly_locked_rows_keep_bounded_backoff_and_visible_age_and_attempts(db: PgPool) {
    let (_, ids, job) = seed(&db, 1).await;
    let mut lock = db.begin().await.unwrap();
    sqlx::query!(
        "SELECT id FROM email_sync_streams WHERE id = $1 FOR UPDATE",
        ids[0]
    )
    .fetch_one(&mut *lock)
    .await
    .unwrap();
    for attempt in 1..=7 {
        let lease = job.claim(Uuid::now_v7(), 120).await.unwrap().unwrap();
        let page = job.advance(&lease, 16, 0).await.unwrap();
        assert_eq!(page.deferred, 1);
        if attempt > 1 {
            assert_eq!(page.deferred_attempts_max, attempt - 1);
            assert!(page.deferred_age_seconds_max >= 600);
        }
        let retry = sqlx::query!(
            r#"
            SELECT attempts,
                EXTRACT(EPOCH FROM available_at - clock_timestamp())::double precision AS "remaining!"
            FROM email_imap_host_catchup_deferred WHERE stream_id = $1
            "#,
            ids[0],
        ).fetch_one(&db).await.unwrap();
        assert_eq!(retry.attempts, i32::try_from(attempt).unwrap());
        assert!(retry.remaining > 0.0 && retry.remaining <= 300.0);
        sqlx::query!("UPDATE email_imap_host_catchup_deferred SET available_at = now(), created_at = now() - interval '10 minutes'")
            .execute(&db).await.unwrap();
    }
    lock.rollback().await.unwrap();
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_one_job_lease_advances_and_a_restart_resumes_the_saved_cursor(db: PgPool) {
    let (_, ids, job) = seed(&db, 2).await;
    let old = job.claim(Uuid::now_v7(), 120).await.unwrap().unwrap();
    assert!(job.claim(Uuid::now_v7(), 120).await.unwrap().is_none());
    sqlx::query!("UPDATE email_imap_host_catchup SET lease_until = now() - interval '1 second'")
        .execute(&db)
        .await
        .unwrap();
    let replacement = job.claim(Uuid::now_v7(), 120).await.unwrap().unwrap();
    assert!(matches!(
        job.advance(&old, 1, 0).await,
        Err(MailboxError::Stale)
    ));
    let first = job.advance(&replacement, 1, 0).await.unwrap();
    assert_eq!(first.woken, 1);
    let restarted = PgImapCatchup(db.clone());
    let next = restarted.claim(Uuid::now_v7(), 120).await.unwrap().unwrap();
    assert_eq!(next.after, ids[0]);
    assert_eq!(restarted.advance(&next, 16, 0).await.unwrap().woken, 1);
    restarted.request_startup(300).await.unwrap();
    let next = restarted.claim(Uuid::now_v7(), 120).await.unwrap().unwrap();
    assert_eq!(next.mode, CatchupMode::Pending);
    // Simulate consumers capturing the current hint generations: an idle
    // periodic cycle then does no fleet work.
    sqlx::query!(
        "UPDATE email_sync_streams SET leased_notification_revision = notification_revision"
    )
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(restarted.advance(&next, 16, 0).await.unwrap().scanned, 0);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn newer_hints_yield_local_backoff_but_never_shorten_a_provider_floor(db: PgPool) {
    let (link, ids, job) = seed(&db, 1).await;
    let lease = job.claim(Uuid::now_v7(), 120).await.unwrap().unwrap();
    job.advance(&lease, 16, 0).await.unwrap();
    let repo =
        PgMailboxSync::new(db.clone()).with_provider(crate::domain::models::UserProvider::Imap);
    let first = repo
        .claim_stream(
            Uuid::now_v7(),
            crate::domain::mailbox::live_pass::StreamKind::MailFolder,
        )
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    repo.release_stream(&first, SyncRetry::Provider(120))
        .await
        .unwrap();
    let floor = sqlx::query_scalar!(
        "SELECT provider_retry_at FROM email_sync_streams WHERE id = $1",
        ids[0]
    )
    .fetch_one(&db)
    .await
    .unwrap()
    .unwrap();
    let notifications = ImapNotificationService(repo.clone());
    let notice = imap_engine::domain::models::Notification {
        binding: imap_engine::domain::models::Binding {
            link_id: link,
            sync_generation: 1,
            grant_generation: 1,
        },
        credentials_rejected: false,
        revision: None,
        mailbox_issue: None,
        sync_retry_at: None,
    };
    notifications.receive(notice.clone()).await.unwrap();
    job.request_startup(0).await.unwrap();
    let lease = job.claim(Uuid::now_v7(), 120).await.unwrap().unwrap();
    job.advance(&lease, 16, 0).await.unwrap();
    let paced = sqlx::query!(
        r#"
        SELECT provider_retry_at, next_run_at = provider_retry_at AS "at_floor!"
        FROM email_sync_streams WHERE id = $1
        "#,
        ids[0],
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(paced.provider_retry_at, Some(floor));
    assert!(paced.at_floor);
    assert!(
        repo.claim_stream(
            Uuid::now_v7(),
            crate::domain::mailbox::live_pass::StreamKind::MailFolder
        )
        .await
        .unwrap()
        .into_lease()
        .is_none()
    );
    // Move this isolated fixture's clock-dependent deadlines into the past.
    sqlx::query!(
        r#"
        UPDATE email_sync_streams
        SET provider_retry_at = now() - interval '1 second', next_run_at = now() - interval '1 second'
        WHERE id = $1
        "#,
        ids[0],
    ).execute(&db).await.unwrap();
    let consumed = repo
        .claim_stream(
            Uuid::now_v7(),
            crate::domain::mailbox::live_pass::StreamKind::MailFolder,
        )
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    let cleared = sqlx::query_scalar!(
        "SELECT provider_retry_at FROM email_sync_streams WHERE id = $1",
        ids[0]
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(cleared.is_none());
    repo.release_stream(&consumed, SyncRetry::Local(120))
        .await
        .unwrap();
    assert!(
        repo.claim_stream(
            Uuid::now_v7(),
            crate::domain::mailbox::live_pass::StreamKind::MailFolder
        )
        .await
        .unwrap()
        .into_lease()
        .is_none()
    );
    notifications.receive(notice).await.unwrap();
    let prompt = repo
        .claim_stream(
            Uuid::now_v7(),
            crate::domain::mailbox::live_pass::StreamKind::MailFolder,
        )
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(prompt.id, ids[0]);
    assert_eq!(prompt.position.as_ref().unwrap().expose(), "kept-cursor");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_row_statement_failure_is_queued_without_hiding_later_streams(db: PgPool) {
    let (_, ids, job) = seed(&db, 2).await;
    sqlx::query!(
        r#"
        CREATE FUNCTION fail_first_catchup_row() RETURNS trigger LANGUAGE plpgsql AS $$
        BEGIN
            IF NEW.id = '00000000-0000-0000-0000-000000000001'::uuid THEN
                RAISE EXCEPTION USING ERRCODE = '57014', MESSAGE = 'synthetic statement timeout';
            END IF;
            RETURN NEW;
        END
        $$
        "#,
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        CREATE TRIGGER fail_first_catchup_row BEFORE UPDATE ON email_sync_streams
        FOR EACH ROW EXECUTE FUNCTION fail_first_catchup_row()
        "#,
    )
    .execute(&db)
    .await
    .unwrap();
    let lease = job.claim(Uuid::now_v7(), 120).await.unwrap().unwrap();
    let page = job.advance(&lease, 16, 0).await.unwrap();
    assert_eq!((page.scanned, page.failed, page.woken), (2, 1, 1));
    assert!(page.complete);
    let due = sqlx::query_scalar!(
        "SELECT next_run_at <= clock_timestamp() FROM email_sync_streams WHERE id = $1",
        ids[1]
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(due, Some(true));
    sqlx::query!("DROP TRIGGER IF EXISTS fail_first_catchup_row ON email_sync_streams")
        .execute(&db)
        .await
        .unwrap();
    sqlx::query!("UPDATE email_imap_host_catchup_deferred SET available_at = now()")
        .execute(&db)
        .await
        .unwrap();
    let lease = job.claim(Uuid::now_v7(), 120).await.unwrap().unwrap();
    let retry = job.advance(&lease, 16, 0).await.unwrap();
    assert_eq!(retry.failed, 0);
    assert_eq!(retry.woken, 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_health_wake_cannot_bypass_the_provider_floor_and_pending_work_keeps_queue_order(
    db: PgPool,
) {
    let (_, ids, job) = seed(&db, 2).await;
    let repo =
        PgMailboxSync::new(db.clone()).with_provider(crate::domain::models::UserProvider::Imap);
    sqlx::query!("UPDATE email_sync_streams SET next_run_at = now() - interval '1 minute'")
        .execute(&db)
        .await
        .unwrap();
    let stream = repo
        .claim_stream(
            Uuid::now_v7(),
            crate::domain::mailbox::live_pass::StreamKind::MailFolder,
        )
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    repo.release_stream(&stream, SyncRetry::Provider(3600))
        .await
        .unwrap();
    // The legacy health wake (and an old binary during rollout) can move the
    // due timestamp. The consuming claim must enforce the provider floor itself.
    sqlx::query!(
        "UPDATE email_sync_streams SET next_run_at = now() WHERE id = $1",
        stream.id
    )
    .execute(&db)
    .await
    .unwrap();
    let other = repo
        .claim_stream(
            Uuid::now_v7(),
            crate::domain::mailbox::live_pass::StreamKind::MailFolder,
        )
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_ne!(other.id, stream.id);
    assert!(
        repo.claim_stream(
            Uuid::now_v7(),
            crate::domain::mailbox::live_pass::StreamKind::MailFolder
        )
        .await
        .unwrap()
        .into_lease()
        .is_none(),
        "a health wake must not consume a future provider floor"
    );
    repo.release_stream(&other, SyncRetry::Local(0))
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE email_sync_streams SET notification_revision = 1, next_run_at = now() - interval '1 minute' WHERE id = $1",
        other.id,
    ).execute(&db).await.unwrap();
    let before = sqlx::query_scalar!(
        "SELECT next_run_at FROM email_sync_streams WHERE id = $1",
        other.id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    let lease = job.claim(Uuid::now_v7(), 120).await.unwrap().unwrap();
    job.advance(&lease, 16, 0).await.unwrap();
    let after = sqlx::query_scalar!(
        "SELECT next_run_at FROM email_sync_streams WHERE id = $1",
        other.id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(
        before, after,
        "already-due hints retain their place in the backlog"
    );
    assert_eq!(ids.len(), 2);
}
