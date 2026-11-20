//! An Outlook account Graph serves no mailbox for, driven through the real
//! Outlook adapter against the Outlook emulator. Graph answers 404 to its
//! Inbox at discovery, and to every other mailbox call too, so the link is
//! marked: only discovery is claimed for it, as a probe that waits as long
//! as the link has been marked. The discovery that finds the mailbox clears
//! the mark and makes the link's other work due at once. A server error at
//! the Inbox is not a missing mailbox.

use super::outlook_import::{ADA, connected, gateway};
use crate::domain::mailbox::commands::MailboxCommandRepository;
use crate::domain::mailbox::contacts::AddressBookRepository;
use crate::domain::mailbox::live_pass::StreamKind;
use crate::domain::mailbox::progress::MailboxProgressRepository;
use crate::domain::mailbox::settings::MailboxSettingsRepository;
use crate::domain::mailbox::watches::MailboxWatchRepository;
use crate::domain::mailbox::{MailboxError, MailboxSyncRepository, MailboxSyncService};
use crate::outbound::mailbox_pg::PgMailboxSync;
use crate::telemetry_capture::Telemetry;
use email_api_client::domain::models::EmailApiError;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::user_id::MacroUserIdStr;
use outlook_emulator::{Fault, FaultError, OutlookEmulator, Route, Seed};
use sqlx::PgPool;
use uuid::Uuid;

type Sync = MailboxSyncService<PgMailboxSync, super::outlook_import::Gateway, PgMailboxSync>;

fn seed() -> Seed {
    Seed::parse(&format!(
        "mailboxes:\n  - email: {ADA}\n    messages:\n      \
         - {{ subject: Hello, date: \"2026-10-01T09:00:00Z\" }}\n"
    ))
    .unwrap()
}

fn service(db: &PgPool, emulator: &OutlookEmulator) -> (PgMailboxSync, Sync) {
    let repo = PgMailboxSync::new(db.clone());
    let service = MailboxSyncService::new(
        repo.clone(),
        gateway(emulator),
        gateway(emulator),
        repo.clone(),
    );
    (repo, service)
}

/// Graph answers 404 `MailboxNotEnabledForRESTAPI` to the Inbox, as it does
/// for an account without an Exchange Online mailbox.
fn no_mailbox() -> Fault {
    Fault {
        route: Some(Route::FoldersGet),
        error: Some(FaultError::MailboxNotEnabled),
        ..Fault::default()
    }
}

async fn make_catalog_due(db: &PgPool, link: Uuid) {
    sqlx::query!(
        "UPDATE email_sync_streams SET next_run_at = now() WHERE link_id = $1 AND kind = 'folder_catalog'",
        link
    )
    .execute(db)
    .await
    .unwrap();
}

async fn marked(db: &PgPool, link: Uuid) -> bool {
    sqlx::query_scalar!(
        r#"SELECT mailbox_unavailable_at IS NOT NULL AS "marked!" FROM email_links WHERE id = $1"#,
        link
    )
    .fetch_one(db)
    .await
    .unwrap()
}

/// A connected link whose discovery and first folder pages ran, with one
/// row due in each of the link's other kinds of work.
async fn syncing(db: &PgPool, service: &Sync) -> Uuid {
    let link = connected(db).await;
    assert!(service.discover_once().await.unwrap());
    for _ in 0..20 {
        if !service.enumerate_once().await.unwrap() {
            break;
        }
    }
    sqlx::query!(
        "INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id) VALUES ($1,$2,1,'contacts_catalog','contacts')",
        macro_uuid::generate_uuid_v7(),
        link
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_address_book_sources(link_id,folder_id,provider_id,emails,scan_id,photo_due_at) VALUES ($1,'contacts','ada','{}',$2,now() - interval '1 minute')",
        link,
        macro_uuid::generate_uuid_v7()
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_mailbox_watch_work(link_id) VALUES($1)",
        link
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO email_mailbox_settings_work(id,link_id,kind,resource_key,next_run_at) VALUES($1,$2,'catalog','',now() - interval '1 minute')",
        macro_uuid::generate_uuid_v7(),
        link
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO email_mailbox_commands(id,link_id,generation,actor_id,intent,status)
        VALUES ($1,$2,1,'macro|ada@example.com','{"kind":"read","value":true}','pending')"#,
        macro_uuid::generate_uuid_v7(),
        link
    )
    .execute(db)
    .await
    .unwrap();
    link
}

/// Which of the link's kinds of work a claim takes. Each claim leases what
/// it takes, so a row is reported once.
async fn claimable(repo: &PgMailboxSync) -> Vec<&'static str> {
    let lease = macro_uuid::generate_uuid_v7;
    let mut kinds = Vec::new();
    if repo
        .claim_stream(lease(), StreamKind::MailFolder)
        .await
        .unwrap()
        .is_some()
    {
        kinds.push("folder");
    }
    if repo.claim_message(lease()).await.unwrap().is_some() {
        kinds.push("message");
    }
    if AddressBookRepository::claim(repo, lease())
        .await
        .unwrap()
        .is_some()
    {
        kinds.push("contacts");
    }
    if repo.claim_photo(lease()).await.unwrap().is_some() {
        kinds.push("photo");
    }
    if repo.claim_watch(lease()).await.unwrap().is_some() {
        kinds.push("subscription");
    }
    if repo
        .claim_settings(lease(), true, true)
        .await
        .unwrap()
        .is_some()
    {
        kinds.push("settings");
    }
    if repo.claim_command(lease()).await.unwrap().is_some() {
        kinds.push("command");
    }
    kinds
}

const EVERY_KIND: [&str; 7] = [
    "folder",
    "message",
    "contacts",
    "photo",
    "subscription",
    "settings",
    "command",
];

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_account_graph_serves_no_mailbox_is_marked_and_only_discovery_looks_again(db: PgPool) {
    let telemetry = Telemetry::default();
    let _guard = telemetry.install();
    let emulator = OutlookEmulator::start(seed()).await.unwrap();
    let (repo, service) = service(&db, &emulator);
    let link = syncing(&db, &service).await;
    sqlx::query!(
        "UPDATE email_sync_streams SET next_run_at = now() WHERE link_id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    // The first discovery registered its callsite; recompute its interest on
    // this thread, since a test on another thread may have registered it
    // while this subscriber was being installed.
    tracing::callsite::rebuild_interest_cache();

    emulator.inject_fault(no_mailbox());
    assert!(matches!(
        service.discover_once().await,
        Err(MailboxError::NoMailbox)
    ));
    assert!(marked(&db, link).await);
    assert_eq!(claimable(&repo).await, Vec::<&str>::new());

    // Discovery looks again only after waiting as long as the link has been
    // marked: 30 s at first, then twice as far apart, at most 12 h.
    for marked_for in ["1 second", "2 hours", "3 days"] {
        sqlx::query(&format!(
            "UPDATE email_links SET mailbox_unavailable_at = now() - interval '{marked_for}' WHERE id = $1"
        ))
        .bind(link)
        .execute(&db)
        .await
        .unwrap();
        make_catalog_due(&db, link).await;
        assert!(matches!(
            service.discover_once().await,
            Err(MailboxError::NoMailbox)
        ));
    }
    let discoveries = telemetry.spans("outlook.sync.discover");
    let probes: Vec<(Option<&str>, Option<&str>, Option<&str>)> = discoveries
        .iter()
        .filter(|run| run.contains_key("outlook.defer_reason"))
        .map(|run| {
            (
                run.get("graph.error_code").map(String::as_str),
                run.get("outlook.defer_reason").map(String::as_str),
                run.get("outlook.defer_seconds").map(String::as_str),
            )
        })
        .collect();
    let code = Some("MailboxNotEnabledForRESTAPI");
    assert_eq!(
        probes,
        [
            (code, Some("no_mailbox"), Some("30")),
            (code, Some("no_mailbox"), Some("30")),
            (code, Some("no_mailbox"), Some("7200")),
            (code, Some("no_mailbox"), Some("43200")),
        ]
    );
    let next_probe = sqlx::query_scalar!(
        r#"SELECT EXTRACT(EPOCH FROM next_run_at - now())::float8 AS "seconds!" FROM email_sync_streams WHERE link_id = $1 AND kind = 'folder_catalog'"#,
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!((43_000.0..=43_200.0).contains(&next_probe));

    let health = repo.backlogs().await.unwrap();
    let mailbox = health
        .iter()
        .find(|backlog| backlog.link_id == link)
        .unwrap();
    assert!(mailbox.mailbox_unavailable);
    let owner = MacroUserIdStr::try_from("macro|ada@example.com".to_owned()).unwrap();
    let inboxes = email_db_client::links::get::fetch_inbox_details_for_macro_id(&db, &owner)
        .await
        .unwrap();
    assert!(inboxes.iter().all(|inbox| inbox.mailbox_unavailable));

    // Only the mark held the work: without it every kind is claimed again.
    sqlx::query!(
        "UPDATE email_links SET mailbox_unavailable_at = NULL WHERE id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert_eq!(claimable(&repo).await, EVERY_KIND);
    emulator.shutdown().await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_discovery_that_finds_the_mailbox_clears_the_mark_and_wakes_its_work(db: PgPool) {
    let emulator = OutlookEmulator::start(seed()).await.unwrap();
    let (repo, service) = service(&db, &emulator);
    let link = syncing(&db, &service).await;
    let fault = emulator.inject_fault(no_mailbox());
    make_catalog_due(&db, link).await;
    assert!(matches!(
        service.discover_once().await,
        Err(MailboxError::NoMailbox)
    ));

    // While the link waited, its work was backed off far ahead, and its
    // subscription upkeep had counted refusals.
    sqlx::query!("UPDATE email_sync_streams SET next_run_at = now() + interval '1 hour' WHERE link_id = $1 AND kind <> 'folder_catalog'", link).execute(&db).await.unwrap();
    sqlx::query!("UPDATE email_message_reconciliation SET available_at = now() + interval '1 hour' WHERE link_id = $1", link).execute(&db).await.unwrap();
    sqlx::query!("UPDATE email_mailbox_watch_work SET next_run_at = now() + interval '12 hours', failures = 5 WHERE link_id = $1", link).execute(&db).await.unwrap();
    sqlx::query!("UPDATE email_mailbox_settings_work SET next_run_at = now() + interval '1 hour' WHERE link_id = $1", link).execute(&db).await.unwrap();

    let revision = sqlx::query_scalar!(
        "SELECT revision FROM email_mailbox_watch_work WHERE link_id = $1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();

    // The account gets its mailbox; the next probe finds it.
    assert!(emulator.remove_fault(fault));
    make_catalog_due(&db, link).await;
    assert!(service.discover_once().await.unwrap());
    assert!(!marked(&db, link).await);
    let upkeep = sqlx::query!(
        "SELECT failures, revision FROM email_mailbox_watch_work WHERE link_id = $1",
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    // A new revision, so an upkeep run that held its lease meanwhile can't
    // put its old wait back when it releases.
    assert_eq!((upkeep.failures, upkeep.revision), (0, revision + 1));
    let catalog_due = sqlx::query_scalar!(
        r#"SELECT next_run_at <= now() AS "due!" FROM email_sync_streams WHERE link_id = $1 AND kind = 'folder_catalog'"#,
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(!catalog_due, "discovery keeps its own cadence");
    // Message rows keep their own retry times.
    assert_eq!(
        claimable(&repo).await,
        [
            "folder",
            "contacts",
            "photo",
            "subscription",
            "settings",
            "command"
        ]
    );
    emulator.shutdown().await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_server_error_at_the_inbox_leaves_the_link_unmarked(db: PgPool) {
    let emulator = OutlookEmulator::start(seed()).await.unwrap();
    let (repo, service) = service(&db, &emulator);
    let link = syncing(&db, &service).await;
    sqlx::query!(
        "UPDATE email_sync_streams SET next_run_at = now() WHERE link_id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    emulator.inject_fault(Fault {
        route: Some(Route::FoldersGet),
        error: Some(FaultError::Internal),
        ..Fault::default()
    });
    assert!(matches!(
        service.discover_once().await,
        Err(MailboxError::Provider(EmailApiError::Transient { .. }))
    ));
    assert!(!marked(&db, link).await);
    assert_eq!(claimable(&repo).await, EVERY_KIND);
    emulator.shutdown().await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_discovery_that_lost_its_lease_does_not_mark_the_link(db: PgPool) {
    let link = connected(&db).await;
    let repo = PgMailboxSync::new(db.clone());
    let lease = repo
        .claim_catalog(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();
    // Its lease lapsed and another discovery took the catalog over.
    sqlx::query!(
        "UPDATE email_sync_streams SET lease_id = $2, fence = fence + 1 WHERE link_id = $1 AND kind = 'folder_catalog'",
        link,
        macro_uuid::generate_uuid_v7()
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(matches!(
        repo.mark_no_mailbox(&lease).await,
        Err(MailboxError::Stale)
    ));
    assert!(!marked(&db, link).await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_mark_behind_a_share_locked_link_fails_fast_then_marks(db: PgPool) {
    let link = connected(&db).await;
    let repo = PgMailboxSync::new(db.clone());
    let lease = repo
        .claim_catalog(macro_uuid::generate_uuid_v7())
        .await
        .unwrap()
        .unwrap();

    // A CRM contact population holds the link this way for its whole transaction.
    let mut population = db.begin().await.unwrap();
    sqlx::query!("SELECT id FROM email_links WHERE id = $1 FOR SHARE", link)
        .fetch_one(&mut *population)
        .await
        .unwrap();
    let blocked = tokio::time::timeout(
        std::time::Duration::from_secs(10),
        repo.mark_no_mailbox(&lease),
    )
    .await
    .expect("the mark waited past its lock timeout");
    assert!(
        matches!(&blocked, Err(error) if error.is_lock_timeout()),
        "{blocked:?}"
    );
    assert!(!marked(&db, link).await);
    population.rollback().await.unwrap();

    repo.mark_no_mailbox(&lease).await.unwrap();
    assert!(marked(&db, link).await);
}
