//! Outlook imports driven through the real Outlook adapter against the
//! Outlook emulator. A large folder imports newest mail first, and mail that
//! arrives during the import is stored as new mail before the import's walk
//! ends, even mail dated just before the import started. Mail that moves or
//! is deleted between the import's listing and its read never holds the
//! import's end. The stored mail of a folder deleted for good is read once,
//! even when Graph refuses every read of it.

use crate::domain::mailbox::live_pass::LiveImportPass;
use crate::domain::mailbox::*;
use crate::outbound::mailbox_pg::PgMailboxSync;
use email_api_client::OutlookApiClientRepository;
use email_api_client::domain::models::{
    AccessToken, EmailApiError, MailFolder, MailFolderCatalog, MailboxAccess, MailboxChangePage,
    MailboxMessage, ProviderId, RoundStart, StreamToken, TokenError, TokenFreshness,
};
use email_api_client::domain::ports::{AlwaysAllowRateLimiter, MailboxTokenSource};
use email_api_client::domain::service::mailbox::MailboxApiService;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_service_urls::MicrosoftGraphUrl;
use outlook_emulator::{
    Fault, FaultError, MessageChange, NewMessage, OutlookEmulator, Route, Seed,
};
use sqlx::PgPool;
use uuid::Uuid;

pub(super) const ADA: &str = "ada@example.com";

/// The emulator's token for the mailbox, whatever the binding.
pub(super) struct EmulatorToken(String);

impl MailboxTokenSource for EmulatorToken {
    async fn access_token(
        &self,
        _: MailboxAccess,
        _: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        Ok(AccessToken::new(self.0.clone()))
    }
}

pub(super) type Graph =
    MailboxApiService<OutlookApiClientRepository, EmulatorToken, AlwaysAllowRateLimiter>;

/// What email-service's provider gateway does: the Graph service for a key.
pub(super) struct Gateway(pub(super) Graph);

pub(super) fn access(mailbox: MailboxKey) -> MailboxAccess {
    MailboxAccess {
        link_id: mailbox.link_id,
        sync_generation: mailbox.sync_generation,
        grant_generation: mailbox.grant_generation,
    }
}

impl MailboxGateway for Gateway {
    async fn folders(&self, mailbox: MailboxKey) -> Result<MailFolderCatalog, EmailApiError> {
        self.0.folders(access(mailbox)).await
    }
    async fn changes(
        &self,
        mailbox: MailboxKey,
        folder: &ProviderId,
        position: Option<&StreamToken>,
        start: RoundStart,
    ) -> Result<MailboxChangePage, EmailApiError> {
        self.0
            .changes(access(mailbox), folder, position, start)
            .await
    }
    async fn message(
        &self,
        mailbox: MailboxKey,
        message: &ProviderId,
        folders: &[MailFolder],
    ) -> Result<Option<MailboxMessage>, EmailApiError> {
        self.0.message(access(mailbox), message, folders).await
    }
    async fn admitted_requests(&self, _: MailboxKey) -> Option<u64> {
        None
    }
}

pub(super) fn gateway(emulator: &OutlookEmulator) -> Gateway {
    let url = MicrosoftGraphUrl::from(emulator.graph_url());
    Gateway(MailboxApiService::new(
        OutlookApiClientRepository::for_graph_url(&url).unwrap(),
        EmulatorToken(emulator.access_token(ADA).unwrap()),
        AlwaysAllowRateLimiter,
    ))
}

/// 250 inbox messages, one an hour, oldest first: three pages of a round.
fn seed() -> Seed {
    let mut seed = format!("mailboxes:\n  - email: {ADA}\n    messages:\n");
    for index in 0..250 {
        let (day, hour) = (1 + index / 24, index % 24);
        seed.push_str(&format!(
            "      - {{ subject: Message {index:03}, date: \"2026-10-{day:02}T{hour:02}:00:00Z\" }}\n"
        ));
    }
    Seed::parse(&seed).unwrap()
}

/// An Outlook link whose catalog is due, as a first connect leaves it.
pub(super) async fn connected(db: &PgPool) -> Uuid {
    let link = macro_uuid::generate_uuid_v7();
    sqlx::query!(r#"
        INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,grant_generation)
        VALUES ($1,'macro|ada@example.com','outlook-owner','ada@example.com','OUTLOOK',1)
    "#,link).execute(db).await.unwrap();
    sqlx::query!(
        "INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id) VALUES ($1,$2,1,'folder_catalog','mail')",
        macro_uuid::generate_uuid_v7(),
        link
    )
    .execute(db)
    .await
    .unwrap();
    link
}

/// The inbox stream's position and whether its import round is done.
async fn inbox_round(db: &PgPool, link: Uuid) -> (Option<String>, bool) {
    let row = sqlx::query!(
        r#"SELECT s.position, s.initial_complete FROM email_sync_streams s
        JOIN email_mailbox_folders f ON f.link_id = s.link_id AND f.provider_id = s.scope_id
        WHERE s.link_id = $1 AND s.kind = 'mail_folder' AND f.role = 'inbox'"#,
        link
    )
    .fetch_one(db)
    .await
    .unwrap();
    (row.position, row.initial_complete)
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
async fn a_large_folder_imports_newest_first_and_stores_new_mail_during_its_import(db: PgPool) {
    let emulator = OutlookEmulator::start(seed()).await.unwrap();
    let link = connected(&db).await;
    let repo = PgMailboxSync::new(db.clone());
    let live_pass = LiveImportPass::default();
    live_pass.set(true);
    let service = MailboxSyncService::new(
        repo.clone(),
        gateway(&emulator),
        gateway(&emulator),
        repo.clone(),
    )
    .with_live_import_pass(live_pass);
    assert!(service.discover_once().await.unwrap());

    // Read folder pages until the inbox's first one is in.
    for _ in 0..20 {
        if inbox_round(&db, link).await.0.is_some() {
            break;
        }
        service.enumerate_once().await.unwrap();
    }
    assert!(inbox_round(&db, link).await.0.is_some());

    let subjects: std::collections::HashMap<String, String> = emulator
        .messages(ADA)
        .unwrap()
        .into_iter()
        .map(|message| (message.id, message.subject))
        .collect();
    let mut first_page: Vec<String> = sqlx::query_scalar!(
        "SELECT provider_id FROM email_message_reconciliation WHERE link_id = $1 AND is_import",
        link
    )
    .fetch_all(&db)
    .await
    .unwrap()
    .into_iter()
    .map(|id| subjects[&id].clone())
    .collect();
    first_page.sort();
    let newest: Vec<String> = (150..250)
        .map(|index| format!("Message {index:03}"))
        .collect();
    assert_eq!(first_page, newest, "the first page is the newest hundred");

    let arrived = emulator
        .deliver(
            ADA,
            &NewMessage {
                subject: Some("Arrived during the import".into()),
                text: Some("Hello".into()),
                ..NewMessage::default()
            },
        )
        .unwrap()
        .id;
    // Graph dates mail when Exchange received it, and mail can reach its
    // folder after that date: mail dated just before the round started but
    // delivered after its snapshot is in neither the round nor a pass that
    // lists only mail received since the round started.
    let cutoff = sqlx::query_scalar!(
        r#"SELECT s.import_started_at AS "cutoff!" FROM email_sync_streams s
        JOIN email_mailbox_folders f ON f.link_id = s.link_id AND f.provider_id = s.scope_id
        WHERE s.link_id = $1 AND s.kind = 'mail_folder_live' AND f.role = 'inbox'"#,
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    let dated_earlier = emulator
        .deliver(
            ADA,
            &NewMessage {
                subject: Some("Dated before the import".into()),
                text: Some("Hello".into()),
                date: Some(cutoff - chrono::Duration::seconds(30)),
                ..NewMessage::default()
            },
        )
        .unwrap()
        .id;

    // The sync loop's order: a folder page, then a message. The walk is
    // paced at two pages while 200 import rows wait, so it cannot reach
    // the end of the round in these steps.
    for _ in 0..30 {
        if stored(&db, link, &arrived).await && stored(&db, link, &dated_earlier).await {
            break;
        }
        service.enumerate_once().await.unwrap();
        service.reconcile_once().await.unwrap();
    }

    assert!(
        stored(&db, link, &arrived).await,
        "new mail waited for the import"
    );
    assert!(
        stored(&db, link, &dated_earlier).await,
        "mail dated just before the import waited for it"
    );
    assert!(
        !inbox_round(&db, link).await.1,
        "stored before the inbox's import round ended"
    );
    let notified = sqlx::query_scalar!(
        r#"SELECT COALESCE(bool_and(NOT (o.payload->>'is_import')::boolean), false) AS "live!" FROM email_projection_outbox o
        JOIN email_messages m ON m.id = (o.payload->>'message_id')::uuid
        WHERE o.link_id = $1 AND m.provider_id = $2"#,
        link,
        arrived.as_str()
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(notified, "it is projected as new mail, not as import");
    emulator.shutdown().await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mail_moved_or_deleted_after_the_import_listed_it_settles_on_its_first_read(db: PgPool) {
    let seed = Seed::parse(&format!(
        "mailboxes:\n  - email: {ADA}\n    messages:\n      \
         - {{ subject: Kept, date: \"2026-10-01T09:00:00Z\" }}\n      \
         - {{ subject: Moved, date: \"2026-10-01T10:00:00Z\" }}\n      \
         - {{ subject: Deleted, date: \"2026-10-01T11:00:00Z\" }}\n"
    ))
    .unwrap();
    let emulator = OutlookEmulator::start(seed).await.unwrap();
    let link = connected(&db).await;
    let repo = PgMailboxSync::new(db.clone());
    let service = MailboxSyncService::new(
        repo.clone(),
        gateway(&emulator),
        gateway(&emulator),
        repo.clone(),
    );
    assert!(service.discover_once().await.unwrap());

    // Every folder's import round lists its mail; a finished round waits
    // two minutes for its next one, so the claims run out.
    for _ in 0..20 {
        if !service.enumerate_once().await.unwrap() {
            break;
        }
    }
    let listed = sqlx::query_scalar!(
        r#"SELECT count(*) AS "listed!" FROM email_message_reconciliation WHERE link_id = $1 AND is_import"#,
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(listed, 3);

    // Before any read, one message moves to Archive and one is deleted
    // for good. A move keeps the message's immutable id.
    let ids: std::collections::HashMap<String, String> = emulator
        .messages(ADA)
        .unwrap()
        .into_iter()
        .map(|message| (message.subject, message.id))
        .collect();
    emulator
        .update_message(
            ADA,
            &ids["Moved"],
            &MessageChange {
                folder: Some("archive".into()),
                ..MessageChange::default()
            },
        )
        .unwrap();
    emulator.delete_message(ADA, &ids["Deleted"]).unwrap();

    // Each read settles its row on the first claim: the deleted message's
    // 404 is not read again 30 and 60 seconds later.
    for _ in 0..3 {
        assert!(service.reconcile_once().await.unwrap());
    }

    assert!(stored(&db, link, &ids["Kept"]).await);
    assert!(!stored(&db, link, &ids["Deleted"]).await);
    let moved_to = sqlx::query_scalar!(
        r#"SELECT f.role FROM email_messages m
        JOIN email_mailbox_folders f ON f.link_id = m.link_id AND f.provider_id = m.provider_folder_id
        WHERE m.link_id = $1 AND m.provider_id = $2"#,
        link,
        ids["Moved"].as_str()
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(
        moved_to, "archive",
        "the moved message reads in its new folder"
    );
    let import = sqlx::query!(
        r#"SELECT
            (SELECT import_completed_at IS NOT NULL FROM email_sync_streams
                WHERE link_id = $1 AND kind = 'folder_catalog') AS "completed!",
            (SELECT count(*) FROM email_message_reconciliation WHERE link_id = $1) AS "rows_left!""#,
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(import.completed, "the import ends with its last read");
    assert_eq!(import.rows_left, 0);
    emulator.shutdown().await;
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mail_of_a_folder_deleted_for_good_is_read_once_when_graph_refuses_it(db: PgPool) {
    let seed = Seed::parse(&format!(
        "mailboxes:\n  - email: {ADA}\n    folders:\n      - name: Projects\n    messages:\n      \
         - {{ subject: Filed, folder: Projects, date: \"2026-10-01T09:00:00Z\" }}\n"
    ))
    .unwrap();
    let emulator = OutlookEmulator::start(seed).await.unwrap();
    let link = connected(&db).await;
    let repo = PgMailboxSync::new(db.clone());
    let service = MailboxSyncService::new(
        repo.clone(),
        gateway(&emulator),
        gateway(&emulator),
        repo.clone(),
    );
    assert!(service.discover_once().await.unwrap());
    for _ in 0..20 {
        if !service.enumerate_once().await.unwrap() {
            break;
        }
    }
    assert!(service.reconcile_once().await.unwrap());
    let filed = emulator.messages(ADA).unwrap().remove(0).id;
    assert!(stored(&db, link, &filed).await);

    // The folder is emptied out of Deleted Items, and Graph answers 403
    // ErrorAccessDenied to every read of the mail it held.
    emulator.delete_folder(ADA, "Projects").unwrap();
    emulator.inject_fault(Fault {
        route: Some(Route::MessagesGet),
        error: Some(FaultError::Forbidden),
        ..Fault::default()
    });

    // The discovery that finds the folder gone rechecks its mail, which is
    // refused three times and abandoned.
    sqlx::query!(
        "UPDATE email_sync_streams SET next_run_at = now() WHERE link_id = $1 AND kind = 'folder_catalog'",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(service.discover_once().await.unwrap());
    for _ in 0..3 {
        sqlx::query!(
            "UPDATE email_message_reconciliation SET available_at = now() WHERE link_id = $1 AND available_at <> 'infinity'",
            link
        )
        .execute(&db)
        .await
        .unwrap();
        assert!(matches!(
            service.reconcile_once().await,
            Err(MailboxError::Provider(EmailApiError::Forbidden))
        ));
    }

    // Later discoveries leave it abandoned: Graph is not asked again.
    emulator.clear_requests();
    for _ in 0..2 {
        sqlx::query!(
            "UPDATE email_sync_streams SET next_run_at = now() WHERE link_id = $1 AND kind = 'folder_catalog'",
            link
        )
        .execute(&db)
        .await
        .unwrap();
        assert!(service.discover_once().await.unwrap());
        assert!(
            matches!(service.reconcile_once().await, Ok(false)),
            "a later discovery revived the abandoned message"
        );
    }
    assert!(
        emulator
            .requests()
            .iter()
            .all(|request| request.route != Some(Route::MessagesGet))
    );
    emulator.shutdown().await;
}
