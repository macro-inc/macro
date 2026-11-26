//! A mailbox whose token is refused is marked as needing a reconnect, and
//! discovery keeps asking for a token about once an hour, the only sync work
//! claimed for it meanwhile. The first token that works clears the mark, and
//! the mailbox syncs again without a reconnect. Driven through the real
//! Outlook adapter and credential health against the Outlook emulator.

use super::outlook_import::{ADA, Gateway, connected};
use crate::domain::mailbox::credentials::{
    MailboxCredentialGateway, MailboxCredentialToken, MailboxCredentials,
};
use crate::domain::mailbox::{MailboxError, MailboxSyncService};
use crate::outbound::mailbox_pg::PgMailboxSync;
use email_api_client::OutlookApiClientRepository;
use email_api_client::domain::models::{
    AccessToken, EmailApiError, MailboxAccess, TokenError, TokenFreshness,
};
use email_api_client::domain::ports::AlwaysAllowRateLimiter;
use email_api_client::domain::service::mailbox::MailboxApiService;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_service_urls::MicrosoftGraphUrl;
use outlook_emulator::{OutlookEmulator, Seed};
use sqlx::PgPool;
use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};
use uuid::Uuid;

/// The sign-in service: it refuses the mailbox's token while `refused` is
/// set, as it does for a grant Microsoft refused, and hands out the
/// emulator's token otherwise.
#[derive(Clone)]
struct SignIn {
    token: String,
    refused: Arc<AtomicBool>,
}

impl MailboxCredentialGateway for SignIn {
    async fn acquire(
        &self,
        _: MailboxAccess,
        _: TokenFreshness,
    ) -> Result<MailboxCredentialToken, TokenError> {
        if self.refused.load(Ordering::SeqCst) {
            return Err(TokenError::ReauthRequired);
        }
        Ok(MailboxCredentialToken {
            token: AccessToken::new(self.token.clone()),
            scopes: vec![
                "Mail.ReadWrite".into(),
                "Mail.Send".into(),
                "User.Read".into(),
            ],
        })
    }
}

type Credentials = MailboxCredentials<PgMailboxSync, SignIn>;
type Sync = MailboxSyncService<PgMailboxSync, Gateway<Credentials>, PgMailboxSync>;

fn service(db: &PgPool, emulator: &OutlookEmulator, sign_in: &SignIn) -> Sync {
    let repo = PgMailboxSync::new(db.clone(), crate::domain::models::UserProvider::Outlook);
    let url = MicrosoftGraphUrl::from(emulator.graph_url());
    let gateway = || {
        Gateway(MailboxApiService::new(
            OutlookApiClientRepository::for_graph_url(&url).unwrap(),
            MailboxCredentials::new(repo.clone(), sign_in.clone()),
            AlwaysAllowRateLimiter,
        ))
    };
    MailboxSyncService::new(repo.clone(), gateway(), gateway(), repo.clone())
}

async fn needs_reauth(db: &PgPool, link: Uuid) -> bool {
    sqlx::query_scalar!("SELECT needs_reauth FROM email_links WHERE id = $1", link)
        .fetch_one(db)
        .await
        .unwrap()
}

/// Seconds until the link's discovery is due again.
async fn discovery_due_in(db: &PgPool, link: Uuid) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT floor(EXTRACT(EPOCH FROM next_run_at - now()))::bigint AS "seconds!"
        FROM email_sync_streams WHERE link_id = $1 AND kind = 'folder_catalog'"#,
        link
    )
    .fetch_one(db)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_refused_mailbox_is_probed_hourly_and_syncs_again_once_a_token_works(db: PgPool) {
    let seed = Seed::parse(&format!(
        "mailboxes:\n  - email: {ADA}\n    messages:\n      \
         - {{ subject: Hello, date: \"2026-10-01T09:00:00Z\" }}\n"
    ))
    .unwrap();
    let emulator = OutlookEmulator::start(seed).await.unwrap();
    let sign_in = SignIn {
        token: emulator.access_token(ADA).unwrap(),
        refused: Arc::new(AtomicBool::new(true)),
    };
    let service = service(&db, &emulator, &sign_in);
    let link = connected(&db).await;

    assert!(matches!(
        service.discover_once().await,
        Err(MailboxError::Provider(EmailApiError::AuthRequired))
    ));
    assert!(needs_reauth(&db, link).await);
    assert!(
        (3590..=3600).contains(&discovery_due_in(&db, link).await),
        "discovery asks again in an hour"
    );

    // An hour later, the refusal has cleared at Microsoft.
    sign_in.refused.store(false, Ordering::SeqCst);
    sqlx::query!(
        "UPDATE email_sync_streams SET next_run_at = now() WHERE link_id = $1 AND kind = 'folder_catalog'",
        link
    )
    .execute(&db)
    .await
    .unwrap();

    assert!(
        service.discover_once().await.unwrap(),
        "discovery probes a link needing a reconnect"
    );
    assert!(!needs_reauth(&db, link).await);
    assert!(
        service.enumerate_once().await.unwrap(),
        "the mailbox's folders sync again"
    );
}
