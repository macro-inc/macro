//! Subscription upkeep driven through the real Outlook adapter against the
//! Outlook emulator. A subscription Graph keeps refusing waits longer after
//! each refusal, and the mailbox's health snapshot shows the refusals.

use super::outlook_import::{ADA, Gateway, access, connected, gateway};
use crate::domain::mailbox::progress::MailboxProgressRepository;
use crate::domain::mailbox::watches::{MailboxWatchGateway, MailboxWatchService};
use crate::domain::mailbox::{MailboxError, MailboxKey};
use crate::outbound::mailbox_pg::PgMailboxSync;
use crate::telemetry_capture::Telemetry;
use chrono::{DateTime, Utc};
use email_api_client::domain::models::{
    EmailApiError, MailboxSubscription, MailboxWatchDetails, ProviderId,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use outlook_emulator::{Fault, FaultError, OutlookEmulator, Route, Seed};
use sqlx::PgPool;

/// What email-service's watch gateway does: the Graph service's
/// subscription calls for a key, with one callback for notifications and
/// lifecycle events.
impl MailboxWatchGateway for Gateway {
    async fn watches(&self, key: MailboxKey) -> Result<Vec<MailboxWatchDetails>, EmailApiError> {
        self.0.watches(access(key)).await
    }
    async fn create_watch(
        &self,
        key: MailboxKey,
        url: &str,
        state: &str,
        expires: DateTime<Utc>,
    ) -> Result<MailboxSubscription, EmailApiError> {
        self.0
            .create_watch(access(key), url, url, state, expires)
            .await
    }
    async fn renew_watch(
        &self,
        key: MailboxKey,
        id: &ProviderId,
        expires: DateTime<Utc>,
    ) -> Result<MailboxSubscription, EmailApiError> {
        self.0.renew_watch(access(key), id, expires).await
    }
    async fn remove_watch(&self, key: MailboxKey, id: &ProviderId) -> Result<(), EmailApiError> {
        self.0.remove_watch(access(key), id).await
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_subscription_graph_keeps_refusing_waits_longer_and_shows_in_the_mailbox_health(
    db: PgPool,
) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let emulator =
        OutlookEmulator::start(Seed::parse(&format!("mailboxes:\n  - email: {ADA}\n")).unwrap())
            .await
            .unwrap();
    let link = connected(&db).await;
    sqlx::query!(
        "INSERT INTO email_mailbox_watch_work(link_id) VALUES($1)",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    // Graph serves the mailbox but refuses to create its subscription.
    emulator.inject_fault(Fault {
        route: Some(Route::SubscriptionsCreate),
        error: Some(FaultError::ExtensionForbidden),
        ..Fault::default()
    });
    let repo = PgMailboxSync::new(db.clone());
    let service = MailboxWatchService::new(
        repo.clone(),
        gateway(&emulator),
        "https://email.example.test".into(),
    );

    for _ in 0..4 {
        sqlx::query!(
            "UPDATE email_mailbox_watch_work SET next_run_at = now() WHERE link_id = $1",
            link
        )
        .execute(&db)
        .await
        .unwrap();
        assert!(matches!(
            service.execute_once().await,
            Err(MailboxError::Provider(EmailApiError::Forbidden))
        ));
    }

    let runs = telemetry.spans("outlook.subscription.maintain");
    let delays: Vec<(&str, &str, &str, &str)> = runs
        .iter()
        .map(|run| {
            (
                run["outlook.subscription_action"].as_str(),
                run["outlook.defer_reason"].as_str(),
                run["outlook.defer_seconds"].as_str(),
                run["outlook.upkeep_failures"].as_str(),
            )
        })
        .collect();
    assert_eq!(
        delays,
        [
            ("create", "forbidden", "30", "1"),
            ("create", "forbidden", "60", "2"),
            ("create", "forbidden", "120", "3"),
            ("create", "forbidden", "240", "4"),
        ]
    );
    let health = repo.backlogs().await.unwrap();
    let mailbox = health
        .iter()
        .find(|backlog| backlog.link_id == link)
        .unwrap();
    assert_eq!(mailbox.watch_failures, 4);
    emulator.shutdown().await;
}
