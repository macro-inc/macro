//! A folder still in its first delta round finds mail that arrives
//! meanwhile by sweeping its recent mail: the round lists only what the
//! folder held when it started.

use super::{fixture, snapshot};
use crate::domain::mailbox::*;
use chrono::{DateTime, Duration, Utc};
use email_api_client::domain::models::{
    EmailApiError, MailFolder, MailboxChangePage, MailboxMessage, MailboxState, ProviderId,
    ReceivedMessages, StreamPosition, StreamToken,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

/// One sweep as the provider was asked for it.
#[derive(Debug, Clone, PartialEq)]
struct Sweep {
    provider: &'static str,
    since: DateTime<Utc>,
    limit: u16,
}

#[derive(Default)]
struct Mailbox {
    pages: u32,
    /// Whether a round ends with its first page.
    small: bool,
    /// What a sweep lists, newest first.
    received: Vec<&'static str>,
    refuse_sweeps: bool,
    sweeps: Vec<Sweep>,
}

/// A folder whose delta round lists 100 new messages a page and, unless it
/// is `small`, never ends; `received` is the mail it got since.
#[derive(Clone)]
struct Folder {
    provider: &'static str,
    mailbox: Arc<Mutex<Mailbox>>,
}

impl Folder {
    /// The live and the import provider of one mailbox.
    fn pair(mailbox: Mailbox) -> (Self, Self) {
        let mailbox = Arc::new(Mutex::new(mailbox));
        let live = Self {
            provider: "live",
            mailbox: mailbox.clone(),
        };
        let import = Self {
            provider: "import",
            mailbox,
        };
        (live, import)
    }

    fn sweeps(&self) -> Vec<Sweep> {
        self.mailbox.lock().unwrap().sweeps.clone()
    }

    fn receive(&self, ids: &[&'static str]) {
        self.mailbox.lock().unwrap().received = ids.to_vec();
    }
}

impl MailboxGateway for Folder {
    async fn folders(&self, _: MailboxKey) -> Result<Vec<MailFolder>, EmailApiError> {
        Ok(Vec::new())
    }
    async fn changes(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: Option<&StreamToken>,
    ) -> Result<MailboxChangePage, EmailApiError> {
        let mut mailbox = self.mailbox.lock().unwrap();
        mailbox.pages += 1;
        let page = mailbox.pages;
        let position = StreamToken::new(format!("page-{page}"));
        Ok(MailboxChangePage {
            changed: (0..100)
                .map(|i| ProviderId::new(format!("old-{page}-{i:02}")).unwrap())
                .collect(),
            removed: Vec::new(),
            position: if mailbox.small {
                StreamPosition::Checkpoint(position)
            } else {
                StreamPosition::Continue(position)
            },
            reader_revision: 1,
        })
    }
    async fn message(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: &[MailFolder],
    ) -> Result<Option<MailboxMessage>, EmailApiError> {
        Ok(None)
    }
    async fn received_since(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        since: DateTime<Utc>,
        limit: u16,
    ) -> Result<ReceivedMessages, EmailApiError> {
        let mut mailbox = self.mailbox.lock().unwrap();
        mailbox.sweeps.push(Sweep {
            provider: self.provider,
            since,
            limit,
        });
        if mailbox.refuse_sweeps {
            return Err(EmailApiError::Permanent {
                message: "Microsoft Graph returned HTTP 400".into(),
            });
        }
        Ok(ReceivedMessages {
            ids: mailbox
                .received
                .iter()
                .map(|id| ProviderId::new(*id).unwrap())
                .collect(),
            truncated: false,
        })
    }
    async fn admitted_requests(&self, _: MailboxKey) -> Option<u64> {
        None
    }
}

fn service(
    repo: &crate::outbound::mailbox_pg::PgMailboxSync,
    mailbox: Mailbox,
) -> (
    MailboxSyncService<
        crate::outbound::mailbox_pg::PgMailboxSync,
        Folder,
        crate::outbound::mailbox_pg::PgMailboxSync,
    >,
    Folder,
) {
    let (live, import) = Folder::pair(mailbox);
    let service = MailboxSyncService::new(repo.clone(), live.clone(), import, repo.clone());
    (service, live)
}

async fn swept_at(db: &PgPool, link: Uuid) -> Option<DateTime<Utc>> {
    sqlx::query_scalar!(
        "SELECT swept_at FROM email_sync_streams WHERE link_id = $1",
        link
    )
    .fetch_one(db)
    .await
    .unwrap()
}

/// What the webhook does with a change notification for the mailbox.
async fn notify(db: &PgPool, link: Uuid) {
    sqlx::query!(
        "UPDATE email_sync_streams SET notified_at = clock_timestamp(), next_run_at = now() WHERE link_id = $1",
        link
    )
    .execute(db)
    .await
    .unwrap();
}

async fn make_due(db: &PgPool, link: Uuid) {
    sqlx::query!(
        "UPDATE email_sync_streams SET next_run_at = now() WHERE link_id = $1",
        link
    )
    .execute(db)
    .await
    .unwrap();
}

/// The queued work for a message: whether it is an import, if it is queued.
async fn queued(db: &PgPool, link: Uuid, id: &str) -> Option<bool> {
    sqlx::query_scalar!(
        "SELECT is_import FROM email_message_reconciliation WHERE link_id = $1 AND provider_id = $2",
        link,
        id
    )
    .fetch_optional(db)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mail_arriving_mid_round_is_queued_live_ahead_of_the_import(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let (service, folder) = service(&repo, Mailbox::default());
    assert!(service.enumerate_once().await.unwrap());
    let round_start = swept_at(&db, link)
        .await
        .expect("the round's first page records when it started");
    // One message of that page is imported already.
    let work = repo.claim_message(Uuid::now_v7()).await.unwrap().unwrap();
    assert_eq!(work.provider_id.as_str(), "old-1-00");
    repo.ingest(
        &work,
        snapshot(link, "old-1-00", MailboxState::default(), "v1"),
    )
    .await
    .unwrap();
    repo.complete_message(&work).await.unwrap();

    // New mail arrives and Graph says so. The sweep lists it, with older
    // mail it looks back over: one message the round queued and one the
    // mailbox holds.
    folder.receive(&["new", "old-1-05", "old-1-00"]);
    notify(&db, link).await;
    assert!(service.enumerate_once().await.unwrap());

    assert_eq!(
        folder.sweeps(),
        [Sweep {
            provider: "live",
            since: round_start - Duration::seconds(300),
            limit: 200,
        }]
    );
    assert_eq!(queued(&db, link, "new").await, Some(false));
    assert_eq!(queued(&db, link, "old-1-05").await, Some(true));
    assert_eq!(queued(&db, link, "old-1-00").await, None);
    assert!(swept_at(&db, link).await.unwrap() > round_start);
    // The round read on, and the new mail is claimed before its import.
    assert_eq!(folder.mailbox.lock().unwrap().pages, 2);
    let next = repo.claim_message(Uuid::now_v7()).await.unwrap().unwrap();
    assert_eq!(next.provider_id.as_str(), "new");
    assert!(!next.is_import);
    assert!(next.notification.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_round_sweeps_when_notified_and_otherwise_every_two_minutes(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let (service, folder) = service(&repo, Mailbox::default());
    // The first page lists the folder as it is; the next, without news,
    // does not sweep.
    assert!(service.enumerate_once().await.unwrap());
    assert!(service.enumerate_once().await.unwrap());
    assert!(folder.sweeps().is_empty());

    // Two minutes on, a page sweeps first.
    sqlx::query!(
        "UPDATE email_sync_streams SET swept_at = swept_at - interval '2 minutes' WHERE link_id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let before = swept_at(&db, link).await.unwrap();
    // Two pages wait for import now, so the round is paced after the sweep.
    service.enumerate_once().await.unwrap();
    assert_eq!(folder.sweeps().len(), 1);
    assert_eq!(folder.sweeps()[0].since, before - Duration::seconds(300));

    // A notification the sweep answered sweeps no more.
    notify(&db, link).await;
    service.enumerate_once().await.unwrap();
    assert_eq!(folder.sweeps().len(), 2);
    make_due(&db, link).await;
    service.enumerate_once().await.unwrap();
    assert_eq!(folder.sweeps().len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_paced_round_still_sweeps(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let (service, folder) = service(&repo, Mailbox::default());
    assert!(service.enumerate_once().await.unwrap());
    assert!(service.enumerate_once().await.unwrap());
    // Two pages wait for import, so the round reads no further.
    folder.receive(&["new"]);
    notify(&db, link).await;
    assert!(!service.enumerate_once().await.unwrap());
    assert_eq!(folder.mailbox.lock().unwrap().pages, 2);
    assert_eq!(folder.sweeps().len(), 1);
    assert_eq!(queued(&db, link, "new").await, Some(false));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_refused_sweep_stays_due_and_the_round_reads_on(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let (service, folder) = service(
        &repo,
        Mailbox {
            refuse_sweeps: true,
            ..Mailbox::default()
        },
    );
    assert!(service.enumerate_once().await.unwrap());
    let round_start = swept_at(&db, link).await.unwrap();
    notify(&db, link).await;
    assert!(service.enumerate_once().await.unwrap());
    assert_eq!(folder.mailbox.lock().unwrap().pages, 2);
    assert_eq!(swept_at(&db, link).await, Some(round_start));

    folder.mailbox.lock().unwrap().refuse_sweeps = false;
    folder.receive(&["new"]);
    service.enumerate_once().await.unwrap();
    assert_eq!(folder.sweeps().len(), 2);
    assert_eq!(queued(&db, link, "new").await, Some(false));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_sweep_the_database_refuses_stays_due_and_the_round_reads_on(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let (service, folder) = service(&repo, Mailbox::default());
    assert!(service.enumerate_once().await.unwrap());
    let round_start = swept_at(&db, link).await.unwrap();
    sqlx::raw_sql(
        "CREATE FUNCTION refuse_live_work() RETURNS trigger LANGUAGE plpgsql AS \
         $$BEGIN RAISE EXCEPTION 'refused'; END$$; \
         CREATE TRIGGER refuse_live_work BEFORE INSERT ON email_message_reconciliation \
         FOR EACH ROW WHEN (NOT NEW.is_import) EXECUTE FUNCTION refuse_live_work();",
    )
    .execute(&db)
    .await
    .unwrap();
    folder.receive(&["new"]);
    notify(&db, link).await;
    assert!(service.enumerate_once().await.unwrap());
    assert_eq!(folder.sweeps().len(), 1);
    assert_eq!(folder.mailbox.lock().unwrap().pages, 2);
    assert_eq!(swept_at(&db, link).await, Some(round_start));
    assert_eq!(queued(&db, link, "new").await, None);

    sqlx::raw_sql("DROP TRIGGER refuse_live_work ON email_message_reconciliation")
        .execute(&db)
        .await
        .unwrap();
    service.enumerate_once().await.unwrap();
    assert_eq!(folder.sweeps().len(), 2);
    assert_eq!(queued(&db, link, "new").await, Some(false));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_folder_past_its_first_round_never_sweeps(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let (service, folder) = service(
        &repo,
        Mailbox {
            small: true,
            ..Mailbox::default()
        },
    );
    assert!(service.enumerate_once().await.unwrap());
    assert_eq!(swept_at(&db, link).await, None);
    notify(&db, link).await;
    assert!(service.enumerate_once().await.unwrap());
    assert!(folder.sweeps().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_round_begun_before_sweeps_sweeps_from_its_next_page(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    sqlx::query!(
        "UPDATE email_sync_streams SET position = 'page-0' WHERE link_id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let (service, folder) = service(&repo, Mailbox::default());
    notify(&db, link).await;
    assert!(service.enumerate_once().await.unwrap());
    assert!(folder.sweeps().is_empty());
    let page_start = swept_at(&db, link).await.unwrap();

    notify(&db, link).await;
    assert!(service.enumerate_once().await.unwrap());
    assert_eq!(folder.sweeps().len(), 1);
    assert_eq!(
        folder.sweeps()[0].since,
        page_start - Duration::seconds(300)
    );
}
