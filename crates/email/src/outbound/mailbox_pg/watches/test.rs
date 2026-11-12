use super::*;
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
    let ingress = MailboxWatchNotifications(repo.clone());
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
    assert!(repo.claim_stream(Uuid::new_v4()).await.unwrap().is_some());
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
    let stream = repo.claim_stream(Uuid::new_v4()).await.unwrap().unwrap();
    MailboxWatchNotifications(repo.clone())
        .receive(id, vec![notification("secret", "sub", WatchHint::Changed)])
        .await
        .unwrap();
    repo.commit_page(&stream, &super::super::test::page())
        .await
        .unwrap();
    assert!(
        repo.claim_stream(Uuid::new_v4()).await.unwrap().is_some(),
        "the authenticated wakeup must survive the page commit"
    );
}
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn lifecycle_event_during_renewal_survives_worker_release(db: PgPool) {
    let (repo, _, lease, id) = setup(&db).await;
    MailboxWatchNotifications(repo.clone())
        .receive(
            id,
            vec![notification("secret", "sub", WatchHint::Reauthorize)],
        )
        .await
        .unwrap();
    repo.release_watch(&lease, 43200).await.unwrap();
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
    MailboxWatchNotifications(repo.clone())
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
async fn subscription_upkeep_records_what_it_did_and_a_failed_renewal_is_an_error(db: PgPool) {
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

    let spans = telemetry.spans("outlook.subscription.maintain");
    let [created, renewed, failed] = spans.as_slice() else {
        panic!("expected three upkeep spans, got {spans:?}");
    };
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

    MailboxWatchNotifications(repo.clone())
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
