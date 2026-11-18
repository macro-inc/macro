//! A large Outlook folder's import, driven through the real Outlook adapter
//! against the Outlook emulator: newest mail first, and mail that arrives
//! during the import is stored as new mail before the import's walk ends.

use crate::domain::mailbox::live_pass::LiveImportPass;
use crate::domain::mailbox::*;
use crate::outbound::mailbox_pg::PgMailboxSync;
use email_api_client::OutlookApiClientRepository;
use email_api_client::domain::models::{
    AccessToken, EmailApiError, MailFolder, MailboxAccess, MailboxChangePage, MailboxMessage,
    ProviderId, RoundStart, StreamToken, TokenError, TokenFreshness,
};
use email_api_client::domain::ports::{AlwaysAllowRateLimiter, MailboxTokenSource};
use email_api_client::domain::service::mailbox::MailboxApiService;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_service_urls::MicrosoftGraphUrl;
use outlook_emulator::{NewMessage, OutlookEmulator, Seed};
use sqlx::PgPool;
use uuid::Uuid;

const ADA: &str = "ada@example.com";

/// The emulator's token for the mailbox, whatever the binding.
struct EmulatorToken(String);

impl MailboxTokenSource for EmulatorToken {
    async fn access_token(
        &self,
        _: MailboxAccess,
        _: TokenFreshness,
    ) -> Result<AccessToken, TokenError> {
        Ok(AccessToken::new(self.0.clone()))
    }
}

type Graph = MailboxApiService<OutlookApiClientRepository, EmulatorToken, AlwaysAllowRateLimiter>;

/// What email-service's provider gateway does: the Graph service for a key.
struct Gateway(Graph);

fn access(mailbox: MailboxKey) -> MailboxAccess {
    MailboxAccess {
        link_id: mailbox.link_id,
        sync_generation: mailbox.sync_generation,
        grant_generation: mailbox.grant_generation,
    }
}

impl MailboxGateway for Gateway {
    async fn folders(&self, mailbox: MailboxKey) -> Result<Vec<MailFolder>, EmailApiError> {
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

fn gateway(emulator: &OutlookEmulator) -> Gateway {
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
async fn connected(db: &PgPool) -> Uuid {
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

    // The sync loop's order: a folder page, then a message. The walk is
    // paced at two pages while 200 import rows wait, so it cannot reach
    // the end of the round in these steps.
    for _ in 0..30 {
        if stored(&db, link, &arrived).await {
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
