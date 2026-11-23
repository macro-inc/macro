use super::*;
use crate::domain::mailbox::live_pass::StreamKind;
use email_api_client::domain::models::EmailApiError;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sha2::{Digest, Sha256};

async fn setup(db: &PgPool) -> (PgMailboxSync, Uuid, WatchLease, Uuid) {
    let (repo, link) = super::super::test::fixture(db).await;
    sqlx::query!(
        "INSERT INTO email_mailbox_watch_work(link_id) VALUES($1)",
        link
    )
    .execute(db)
    .await
    .unwrap();
    let lease = repo.claim_watch(Uuid::new_v4()).await.unwrap().unwrap();
    let id = Uuid::new_v4();
    let hash = Sha256::digest(b"secret");
    repo.reserve_watch(&lease, id, &hash, Utc::now() + chrono::Duration::days(3))
        .await
        .unwrap();
    (repo, link, lease, id)
}
fn notification(state: &str, subscription: &str, hint: WatchHint) -> WatchNotification {
    WatchNotification {
        subscription_id: subscription.into(),
        client_state: state.into(),
        hint,
        message: None,
    }
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_a_matching_verifier_can_bind_an_unknown_create_and_wake_the_mailbox(db: PgPool) {
    let (repo, link, _, id) = setup(&db).await;
    sqlx::query!(
        "UPDATE email_sync_streams SET next_run_at=now()+interval '1 hour' WHERE link_id=$1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let ingress = MailboxWatchNotifications::new(repo.clone());
    ingress
        .receive(id, vec![notification("wrong", "sub", WatchHint::Changed)])
        .await
        .unwrap();
    let row = sqlx::query!(
        "SELECT provider_id FROM email_provider_subscriptions WHERE id=$1",
        id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(row.provider_id.is_none());
    ingress
        .receive(id, vec![notification("secret", "sub", WatchHint::Changed)])
        .await
        .unwrap();
    let row = sqlx::query!(
        "SELECT provider_id FROM email_provider_subscriptions WHERE id=$1",
        id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(row.provider_id.as_deref(), Some("sub"));
    assert!(
        repo.claim_stream(Uuid::new_v4(), StreamKind::MailFolder)
            .await
            .unwrap()
            .into_lease()
            .is_some()
    );
    ingress
        .receive(
            id,
            vec![notification("secret", "different", WatchHint::Changed)],
        )
        .await
        .unwrap();
    assert_eq!(
        repo.notification_binding(id)
            .await
            .unwrap()
            .unwrap()
            .provider_id
            .unwrap()
            .as_str(),
        "sub"
    );
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn notification_during_a_delta_page_is_not_erased_by_its_checkpoint(db: PgPool) {
    let (repo, _, _, id) = setup(&db).await;
    let stream = repo
        .claim_stream(Uuid::new_v4(), StreamKind::MailFolder)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    MailboxWatchNotifications::new(repo.clone())
        .receive(id, vec![notification("secret", "sub", WatchHint::Changed)])
        .await
        .unwrap();
    repo.commit_page(&stream, &super::super::test::page())
        .await
        .unwrap();
    assert!(
        repo.claim_stream(Uuid::new_v4(), StreamKind::MailFolder)
            .await
            .unwrap()
            .into_lease()
            .is_some(),
        "the authenticated wakeup must survive the page commit"
    );
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lifecycle_event_during_renewal_survives_worker_release(db: PgPool) {
    let (repo, _, lease, id) = setup(&db).await;
    MailboxWatchNotifications::new(repo.clone())
        .receive(
            id,
            vec![notification("secret", "sub", WatchHint::Reauthorize)],
        )
        .await
        .unwrap();
    repo.release_watch(&lease, 43200, 0).await.unwrap();
    assert!(repo.claim_watch(Uuid::new_v4()).await.unwrap().is_some());
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reconnect_rejects_old_notification_and_worker_but_keeps_attempt_for_remote_cleanup(
    db: PgPool,
) {
    let (repo, link, lease, id) = setup(&db).await;
    sqlx::query!(
        "UPDATE email_links SET sync_generation=sync_generation+1 WHERE id=$1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(repo.notification_binding(id).await.unwrap().is_none());
    assert!(matches!(
        repo.bind_watch(
            &lease,
            id,
            &MailboxSubscription {
                id: ProviderId::new("sub").unwrap(),
                expires_at: Utc::now() + chrono::Duration::days(2)
            }
        )
        .await,
        Err(MailboxError::Stale)
    ));
    MailboxWatchNotifications::new(repo.clone())
        .receive(id, vec![notification("secret", "sub", WatchHint::Changed)])
        .await
        .unwrap();
    let rows = repo.watch_attempts(&lease).await.unwrap();
    assert_eq!(rows.len(), 1);
    assert!(rows[0].provider_id.is_none());
}

/// Graph double: remembers the subscription it created and lists it back.
#[derive(Default)]
struct Gateway {
    created: std::sync::Mutex<Option<(MailboxSubscription, String)>>,
    renewals_fail: std::sync::Arc<std::sync::atomic::AtomicBool>,
}

impl MailboxWatchGateway for Gateway {
    async fn watches(
        &self,
        _: MailboxKey,
    ) -> Result<Vec<email_api_client::domain::models::MailboxWatchDetails>, EmailApiError> {
        let created = self.created.lock().unwrap();
        Ok(created
            .iter()
            .map(
                |(subscription, url)| email_api_client::domain::models::MailboxWatchDetails {
                    subscription: subscription.clone(),
                    notification_url: url.clone(),
                    lifecycle_url: Some(url.clone()),
                    resource: "me/messages".to_owned(),
                },
            )
            .collect())
    }
    async fn create_watch(
        &self,
        _: MailboxKey,
        url: &str,
        _: &str,
        expires: DateTime<Utc>,
    ) -> Result<MailboxSubscription, EmailApiError> {
        let subscription = MailboxSubscription {
            id: ProviderId::new("sub").unwrap(),
            expires_at: expires,
        };
        *self.created.lock().unwrap() = Some((subscription.clone(), url.to_owned()));
        Ok(subscription)
    }
    async fn renew_watch(
        &self,
        _: MailboxKey,
        id: &ProviderId,
        expires: DateTime<Utc>,
    ) -> Result<MailboxSubscription, EmailApiError> {
        if self.renewals_fail.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(EmailApiError::Transient {
                message: "Microsoft Graph returned HTTP 503".into(),
            });
        }
        Ok(MailboxSubscription {
            id: id.clone(),
            expires_at: expires,
        })
    }
    async fn remove_watch(&self, _: MailboxKey, _: &ProviderId) -> Result<(), EmailApiError> {
        Ok(())
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn subscription_upkeep_records_what_it_did_and_failed_renewals_back_off_until_one_works(
    db: PgPool,
) {
    let telemetry = crate::telemetry_capture::Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link) = super::super::test::fixture(&db).await;
    sqlx::query!(
        "INSERT INTO email_mailbox_watch_work(link_id) VALUES($1)",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let make_due = || {
        sqlx::query!(
            "UPDATE email_mailbox_watch_work SET next_run_at = now() WHERE link_id = $1",
            link
        )
        .execute(&db)
    };
    let renewals_fail = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
    let service = MailboxWatchService::new(
        repo.clone(),
        Gateway {
            renewals_fail: renewals_fail.clone(),
            ..Gateway::default()
        },
        "https://email.example.test".into(),
    );

    assert!(service.execute_once().await.unwrap());
    make_due().await.unwrap();
    assert!(service.execute_once().await.unwrap());
    renewals_fail.store(true, std::sync::atomic::Ordering::SeqCst);
    make_due().await.unwrap();
    assert!(service.execute_once().await.is_err());
    make_due().await.unwrap();
    assert!(service.execute_once().await.is_err());
    renewals_fail.store(false, std::sync::atomic::Ordering::SeqCst);
    make_due().await.unwrap();
    assert!(service.execute_once().await.unwrap());

    let spans = telemetry.spans("outlook.subscription.maintain");
    let [created, renewed, failed, failed_again, recovered] = spans.as_slice() else {
        panic!("expected five upkeep spans, got {spans:?}");
    };
    assert_eq!(failed_again["outlook.defer_seconds"], "60");
    assert_eq!(recovered["outlook.outcome"], "done");
    // A renewal that works clears the failures, so the next refusal waits
    // 30 s again.
    let failures = sqlx::query_scalar!(
        "SELECT failures FROM email_mailbox_watch_work WHERE link_id = $1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(failures, 0);
    assert_eq!(created["mailbox.link_id"], link.to_string());
    assert_eq!(created["outlook.subscription_action"], "created");
    assert!(created.contains_key("outlook.subscription_expires_at"));
    assert_eq!(created["outlook.outcome"], "done");
    assert!(!created.contains_key("otel.status_description"));
    assert_eq!(renewed["outlook.subscription_action"], "renewed");
    assert_eq!(renewed["outlook.outcome"], "done");
    assert_eq!(failed["outlook.subscription_action"], "renew");
    assert_eq!(failed["outlook.outcome"], "deferred");
    assert_eq!(failed["outlook.defer_seconds"], "30");
    assert!(failed.contains_key("otel.status_description"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lifecycle_events_are_logged_with_the_mailbox_and_counted_on_the_span(db: PgPool) {
    let telemetry = crate::telemetry_capture::Telemetry::default();
    let _guard = telemetry.install();
    let (repo, link, _, id) = setup(&db).await;

    MailboxWatchNotifications::new(repo.clone())
        .receive(
            id,
            vec![
                notification("secret", "sub", WatchHint::Changed),
                notification("secret", "sub", WatchHint::Missed),
                notification("secret", "sub", WatchHint::Reauthorize),
                notification("wrong", "sub", WatchHint::Removed),
            ],
        )
        .await
        .unwrap();

    let spans = telemetry.spans("outlook.subscription.notify");
    let [span] = spans.as_slice() else {
        panic!("expected one notification span, got {spans:?}");
    };
    assert_eq!(span["outlook.subscription_attempt"], id.to_string());
    assert_eq!(span["mailbox.link_id"], link.to_string());
    assert_eq!(span["outlook.notifications"], "4");
    assert_eq!(span["outlook.notifications_accepted"], "3");
    assert_eq!(span["outlook.lifecycle_events"], "2");
    let events = telemetry.events("outlook subscription lifecycle event");
    let [(missed_level, missed), (reauthorize_level, reauthorize)] = events.as_slice() else {
        panic!("expected two lifecycle events, got {events:?}");
    };
    assert_eq!(*missed_level, tracing::Level::WARN);
    assert_eq!(missed["lifecycle_event"], "missed");
    assert_eq!(missed["link_id"], link.to_string());
    assert_eq!(*reauthorize_level, tracing::Level::INFO);
    assert_eq!(reauthorize["lifecycle_event"], "reauthorizationRequired");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_change_notification_makes_a_folders_live_pass_due(db: PgPool) {
    let (repo, link, _, id) = setup(&db).await;
    sqlx::query!(
        "INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,initial_complete,next_run_at) VALUES ($1,$2,1,'mail_folder_live','folder',true,now() + interval '2 minutes')",
        macro_uuid::generate_uuid_v7(),
        link
    )
    .execute(&db)
    .await
    .unwrap();

    MailboxWatchNotifications::new(repo.clone())
        .receive(id, vec![notification("secret", "sub", WatchHint::Changed)])
        .await
        .unwrap();

    let pass = repo
        .claim_stream(Uuid::new_v4(), StreamKind::LivePass)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(pass.folder.as_str(), "folder");
    assert!(pass.notification.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn subscription_writes_behind_a_share_locked_link_fail_fast(db: PgPool) {
    let (repo, link, lease, id) = setup(&db).await;
    sqlx::query!(
        "UPDATE email_sync_streams SET next_run_at=now()+interval '1 hour' WHERE link_id=$1",
        link
    )
    .execute(&db)
    .await
    .unwrap();

    // A CRM contact population holds the link this way for its whole transaction.
    let mut population = db.begin().await.unwrap();
    sqlx::query!("SELECT id FROM email_links WHERE id=$1 FOR SHARE", link)
        .fetch_one(&mut *population)
        .await
        .unwrap();

    let bound = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        repo.bind_watch(
            &lease,
            id,
            &MailboxSubscription {
                id: ProviderId::new("sub").unwrap(),
                expires_at: Utc::now() + chrono::Duration::days(2),
            },
        ),
    )
    .await;
    assert!(
        matches!(
            &bound,
            Ok(Err(MailboxError::Database(DatabaseFailure::Sqlstate(code)))) if code == "55P03"
        ),
        "{bound:?}"
    );
    let notified = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        MailboxWatchNotifications::new(repo.clone())
            .receive(id, vec![notification("secret", "sub", WatchHint::Changed)]),
    )
    .await;
    assert!(
        matches!(
            &notified,
            Ok(Err(MailboxError::Database(DatabaseFailure::Sqlstate(code)))) if code == "55P03"
        ),
        "{notified:?}"
    );
    population.rollback().await.unwrap();

    let row = sqlx::query!(
        "SELECT provider_id FROM email_provider_subscriptions WHERE id=$1",
        id
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(row.provider_id.is_none());
    assert!(
        repo.claim_stream(Uuid::new_v4(), StreamKind::MailFolder)
            .await
            .unwrap()
            .into_lease()
            .is_none(),
        "a notification that failed must not wake the mailbox"
    );
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_notification_keeps_a_due_folder_ahead_of_folders_due_after_it(db: PgPool) {
    let (repo, link, _, id) = setup(&db).await;
    sqlx::query!(
        "UPDATE email_sync_streams SET next_run_at=now()-interval '5 minutes' WHERE link_id=$1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let other = macro_uuid::generate_uuid_v7();
    sqlx::query!(r#"
        INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,grant_generation)
        VALUES ($1,'macro|other@example.com','other-owner','other@example.com','OUTLOOK',1)
    "#,other).execute(&db).await.unwrap();
    sqlx::query!(
        "INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,next_run_at) VALUES ($1,$2,1,'mail_folder','folder',now()-interval '1 minute')",
        macro_uuid::generate_uuid_v7(),
        other
    )
    .execute(&db)
    .await
    .unwrap();

    MailboxWatchNotifications::new(repo.clone())
        .receive(id, vec![notification("secret", "sub", WatchHint::Changed)])
        .await
        .unwrap();

    let claimed = repo
        .claim_stream(macro_uuid::generate_uuid_v7(), StreamKind::MailFolder)
        .await
        .unwrap()
        .into_lease()
        .unwrap();
    assert_eq!(
        claimed.mailbox.link_id, link,
        "a notified mailbox's folder, due longest, must not wait behind another mailbox's"
    );
}

fn notified(message: &str) -> WatchNotification {
    notified_on("sub", message)
}

fn notified_on(subscription: &str, message: &str) -> WatchNotification {
    WatchNotification {
        subscription_id: subscription.into(),
        client_state: "secret".into(),
        hint: WatchHint::Changed,
        message: Some(ProviderId::new(message).unwrap()),
    }
}

fn reads_on() -> NotifiedMessageReads {
    let switch = NotifiedMessageReads::default();
    switch.set(true);
    switch
}

async fn finish_import(db: &PgPool, link: Uuid) {
    sqlx::query!(
        "UPDATE email_sync_streams SET initial_complete = true, position = 'checkpoint' WHERE link_id = $1 AND kind = 'mail_folder'",
        link
    )
    .execute(db)
    .await
    .unwrap();
}

async fn queued(db: &PgPool, link: Uuid, message: &str) -> bool {
    sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM email_message_reconciliation WHERE link_id = $1 AND provider_id = $2) AS "queued!""#,
        link,
        message
    )
    .fetch_one(db)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn changes_to_one_notified_message_merge_into_one_live_row(db: PgPool) {
    let (repo, link, _, id) = setup(&db).await;
    finish_import(&db, link).await;
    let ingress = MailboxWatchNotifications::new(repo.clone()).with_message_reads(reads_on());

    ingress
        .receive(id, vec![notified("changed")])
        .await
        .unwrap();
    let first = sqlx::query_scalar!(
        "SELECT revision FROM email_message_reconciliation WHERE link_id = $1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    // Read, flagged, moved: each change notifies again.
    ingress
        .receive(id, vec![notified("changed"), notified("changed")])
        .await
        .unwrap();

    let rows = sqlx::query!(
        r#"SELECT revision, is_import, from_notification, notified_at IS NOT NULL AS "notified!" FROM email_message_reconciliation WHERE link_id = $1"#,
        link
    )
    .fetch_all(&db)
    .await
    .unwrap();
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].revision, first + 2);
    assert!(!rows[0].is_import && rows[0].from_notification && rows[0].notified);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_mailbox_still_importing_queues_no_notified_message(db: PgPool) {
    // The fixture's folder has not finished its import round.
    let (repo, link, _, id) = setup(&db).await;

    MailboxWatchNotifications::new(repo.clone())
        .with_message_reads(reads_on())
        .receive(id, vec![notified("old-mail")])
        .await
        .unwrap();

    assert!(!queued(&db, link, "old-mail").await);
    assert!(
        repo.claim_stream(macro_uuid::generate_uuid_v7(), StreamKind::MailFolder)
            .await
            .unwrap()
            .into_lease()
            .is_some(),
        "the folders are still woken"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_mailbox_with_its_live_reads_ahead_queues_no_more_while_another_mailbox_does(db: PgPool) {
    let (repo, busy, _, busy_attempt) = setup(&db).await;
    finish_import(&db, busy).await;
    sqlx::query!(
        r#"
        INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import)
        SELECT $1,1,'queued-' || n,false FROM generate_series(1,50) n
    "#,
        busy
    )
    .execute(&db)
    .await
    .unwrap();
    let quiet = macro_uuid::generate_uuid_v7();
    sqlx::query!(r#"
        INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,grant_generation)
        VALUES ($1,'macro|quiet@example.com','quiet-owner','quiet@example.com','OUTLOOK',1)
    "#,quiet).execute(&db).await.unwrap();
    sqlx::query!(
        "INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,initial_complete,position) VALUES ($1,$2,1,'mail_folder','folder',true,'checkpoint')",
        macro_uuid::generate_uuid_v7(),
        quiet
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_mailbox_watch_work(link_id) VALUES($1)",
        quiet
    )
    .execute(&db)
    .await
    .unwrap();
    // The busy mailbox's upkeep is still leased, so this claim is the quiet one's.
    let lease = repo
        .claim_watch(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    assert_eq!(lease.mailbox.link_id, quiet);
    let quiet_attempt = macro_uuid::generate_uuid_v7();
    repo.reserve_watch(
        &lease,
        quiet_attempt,
        &Sha256::digest(b"secret"),
        Utc::now() + chrono::Duration::days(3),
    )
    .await
    .unwrap();
    let ingress = MailboxWatchNotifications::new(repo.clone()).with_message_reads(reads_on());

    ingress
        .receive(busy_attempt, vec![notified("one-more")])
        .await
        .unwrap();
    ingress
        .receive(quiet_attempt, vec![notified_on("quiet-sub", "new-mail")])
        .await
        .unwrap();

    assert!(
        !queued(&db, busy, "one-more").await,
        "its folders' pages list the rest"
    );
    assert!(queued(&db, quiet, "new-mail").await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_folder_page_listing_a_notified_message_reads_it_as_its_own(db: PgPool) {
    let (repo, link, _, id) = setup(&db).await;
    finish_import(&db, link).await;
    MailboxWatchNotifications::new(repo.clone())
        .with_message_reads(reads_on())
        .receive(id, vec![notified("moved")])
        .await
        .unwrap();
    let stream = repo
        .claim_stream(macro_uuid::generate_uuid_v7(), StreamKind::MailFolder)
        .await
        .unwrap()
        .into_lease()
        .unwrap();

    repo.commit_page(
        &stream,
        &MailboxChangePage {
            changed: Vec::new(),
            removed: vec![ProviderId::new("moved").unwrap()],
            position: StreamPosition::Checkpoint(StreamToken::new("checkpoint-2".into())),
            reader_revision: 1,
        },
    )
    .await
    .unwrap();

    let from_notification = sqlx::query_scalar!(
        "SELECT from_notification FROM email_message_reconciliation WHERE link_id = $1 AND provider_id = 'moved'",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(
        !from_notification,
        "a message a folder page lists follows the folder page's rules, wherever it moved"
    );
}
