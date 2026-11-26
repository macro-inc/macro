//! A change notification names its message, and with notified reads on the
//! message is read as live work on the next message turn, without waiting for
//! any folder's page.

use super::outlook_import::{ADA, connected, gateway};
use crate::domain::mailbox::watches::{
    MailboxWatchNotifications, MailboxWatchRepository, NotifiedMessageReads, WatchHint,
    WatchNotification,
};
use crate::domain::mailbox::*;
use crate::outbound::mailbox_pg::PgMailboxSync;
use chrono::Utc;
use email_api_client::domain::models::ProviderId;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use outlook_emulator::{NewMessage, OutlookEmulator, Seed};
use sha2::{Digest, Sha256};
use sqlx::PgPool;
use uuid::Uuid;

/// One message in the inbox and an empty folder of the user's own.
fn seed() -> Seed {
    Seed::parse(&format!(
        "mailboxes:\n  - email: {ADA}\n    folders:\n      - name: Projects\n    messages:\n      - {{ subject: Imported, date: \"2026-10-01T09:00:00Z\" }}\n"
    ))
    .unwrap()
}

/// A connected mailbox whose import has finished, with a bound subscription
/// attempt whose client state is `secret`.
async fn imported(db: &PgPool, emulator: &OutlookEmulator) -> (PgMailboxSync, Uuid, Uuid) {
    let link = connected(db).await;
    let repo = PgMailboxSync::new(db.clone());
    let service = MailboxSyncService::new(
        repo.clone(),
        gateway(emulator),
        gateway(emulator),
        repo.clone(),
    );
    assert!(service.discover_once().await.unwrap());
    for _ in 0..20 {
        let enumerated = service.enumerate_once().await.unwrap();
        let reconciled = service.reconcile_once().await.unwrap();
        if !enumerated && !reconciled {
            break;
        }
    }
    let importing = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM email_sync_streams WHERE link_id = $1 AND kind = 'mail_folder' AND NOT initial_complete"#,
        link
    )
    .fetch_one(db)
    .await
    .unwrap();
    assert_eq!(importing, 0, "the import finished");

    sqlx::query!(
        "INSERT INTO email_mailbox_watch_work(link_id) VALUES($1)",
        link
    )
    .execute(db)
    .await
    .unwrap();
    let lease = repo.claim_watch(Uuid::now_v7()).await.unwrap().unwrap();
    let attempt = Uuid::now_v7();
    repo.reserve_watch(
        &lease,
        attempt,
        &Sha256::digest(b"secret"),
        Utc::now() + chrono::Duration::days(3),
    )
    .await
    .unwrap();
    (repo, link, attempt)
}

async fn notify(repo: &PgMailboxSync, attempt: Uuid, reads: bool, message: &str) {
    let switch = NotifiedMessageReads::default();
    switch.set(reads);
    MailboxWatchNotifications::new(repo.clone())
        .with_message_reads(switch)
        .receive(
            attempt,
            vec![WatchNotification {
                subscription_id: "sub".into(),
                client_state: "secret".into(),
                hint: WatchHint::Changed,
                message: Some(ProviderId::new(message).unwrap()),
            }],
        )
        .await
        .unwrap();
}

async fn stored(db: &PgPool, link: Uuid, provider_id: &str) -> bool {
    sqlx::query_scalar!(
        r#"SELECT EXISTS(SELECT 1 FROM email_messages WHERE link_id = $1 AND provider_id = $2) AS "stored!""#,
        link,
        provider_id
    )
    .fetch_one(db)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_notified_message_is_stored_on_the_next_message_read_before_any_folder_page(db: PgPool) {
    let emulator = OutlookEmulator::start(seed()).await.unwrap();
    let (repo, link, attempt) = imported(&db, &emulator).await;
    let arrived = emulator
        .deliver(
            ADA,
            &NewMessage {
                subject: Some("Arrived after the import".into()),
                text: Some("Hello".into()),
                ..NewMessage::default()
            },
        )
        .unwrap()
        .id;

    notify(&repo, attempt, true, &arrived).await;

    // Only a message read runs: no folder is enumerated.
    let service = MailboxSyncService::new(
        repo.clone(),
        gateway(&emulator),
        gateway(&emulator),
        repo.clone(),
    );
    assert!(service.reconcile_once().await.unwrap());
    assert!(stored(&db, link, &arrived).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn with_notified_reads_off_a_notification_only_wakes_the_folders(db: PgPool) {
    let emulator = OutlookEmulator::start(seed()).await.unwrap();
    let (repo, link, attempt) = imported(&db, &emulator).await;
    let arrived = emulator
        .deliver(
            ADA,
            &NewMessage {
                subject: Some("Arrived after the import".into()),
                text: Some("Hello".into()),
                ..NewMessage::default()
            },
        )
        .unwrap()
        .id;

    notify(&repo, attempt, false, &arrived).await;

    let queued = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM email_message_reconciliation WHERE link_id = $1"#,
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(queued, 0, "nothing is queued but the folders' wakeup");
    let service = MailboxSyncService::new(
        repo.clone(),
        gateway(&emulator),
        gateway(&emulator),
        repo.clone(),
    );
    assert!(!service.reconcile_once().await.unwrap());
    assert!(!stored(&db, link, &arrived).await);
    // The inbox's next page reads it, as before.
    for _ in 0..10 {
        if stored(&db, link, &arrived).await {
            break;
        }
        service.enumerate_once().await.unwrap();
        service.reconcile_once().await.unwrap();
    }
    assert!(stored(&db, link, &arrived).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_notified_message_in_a_folder_the_catalog_does_not_list_is_not_stored(db: PgPool) {
    let emulator = OutlookEmulator::start(seed()).await.unwrap();
    let (repo, link, attempt) = imported(&db, &emulator).await;
    // As a hidden folder, or one made since the last discovery, is unknown to
    // the catalog, so no folder page lists its mail.
    sqlx::query!(
        "UPDATE email_mailbox_folders SET deleted_at = now() WHERE link_id = $1 AND display_name = 'Projects'",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let filed = emulator
        .deliver(
            ADA,
            &NewMessage {
                subject: Some("Filed by a rule".into()),
                text: Some("Hello".into()),
                folder: Some("Projects".into()),
                ..NewMessage::default()
            },
        )
        .unwrap()
        .id;

    notify(&repo, attempt, true, &filed).await;

    let service = MailboxSyncService::new(
        repo.clone(),
        gateway(&emulator),
        gateway(&emulator),
        repo.clone(),
    );
    assert!(service.reconcile_once().await.unwrap());
    assert!(!stored(&db, link, &filed).await);
    let left = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM email_message_reconciliation WHERE link_id = $1"#,
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(left, 0, "the read settles without storing");
}
