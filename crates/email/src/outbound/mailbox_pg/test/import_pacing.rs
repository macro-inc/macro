//! An import round's folder walk stays about two pages ahead of its import.

use super::fixture;
use crate::domain::mailbox::*;
use email_api_client::domain::models::{
    EmailApiError, GateLimit, MailFolder, MailFolderCatalog, MailboxChangePage, MailboxMessage,
    ProviderId, RateLimitOrigin, RoundStart, StreamPosition, StreamToken,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::sync::{Arc, Mutex};
use uuid::Uuid;

/// A folder far larger than any test reads: every page lists 100 messages
/// not seen before and points at another page.
#[derive(Clone, Default)]
struct LargeFolder {
    pages: Arc<Mutex<u32>>,
}

impl LargeFolder {
    fn pages_read(&self) -> u32 {
        *self.pages.lock().unwrap()
    }
}

impl MailboxGateway for LargeFolder {
    async fn folders(&self, _: MailboxKey) -> Result<MailFolderCatalog, EmailApiError> {
        Ok(MailFolderCatalog::Folders(Vec::new()))
    }
    async fn changes(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: Option<&StreamToken>,
        _: RoundStart,
    ) -> Result<MailboxChangePage, EmailApiError> {
        let page = {
            let mut pages = self.pages.lock().unwrap();
            *pages += 1;
            *pages
        };
        Ok(MailboxChangePage {
            changed: (0..100)
                .map(|i| ProviderId::new(format!("page-{page}-{i}")).unwrap())
                .collect(),
            removed: Vec::new(),
            position: StreamPosition::Continue(StreamToken::new(format!("page-{page}"))),
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
    async fn admitted_requests(&self, _: MailboxKey) -> Option<u64> {
        None
    }
}

async fn queued_imports(db: &PgPool, link: Uuid) -> i64 {
    sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM email_message_reconciliation WHERE link_id = $1 AND is_import"#,
        link
    )
    .fetch_one(db)
    .await
    .unwrap()
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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_import_round_reads_no_further_while_two_pages_wait_for_import(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    let folder = LargeFolder::default();
    let service = MailboxSyncService::new(repo.clone(), folder.clone(), folder.clone(), repo);

    assert!(service.enumerate_once().await.unwrap());
    assert!(service.enumerate_once().await.unwrap());
    // The folder is put back for a while without a Graph request, so the
    // calls after it find nothing due.
    for _ in 0..3 {
        assert!(!service.enumerate_once().await.unwrap());
    }
    assert_eq!(folder.pages_read(), 2);
    assert_eq!(queued_imports(&db, link).await, 200);
    let waits = sqlx::query_scalar!(
        r#"SELECT next_run_at > now() + interval '5 seconds' AS "waits!" FROM email_sync_streams WHERE link_id = $1"#,
        link
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(waits);

    // One message the import gave up on and one backed off after a failure
    // of its own leave 198 due; one more makes 199. New mail is live work.
    // Counting any of those three would make 200 and hold the walk.
    sqlx::query!(
        r#"
        WITH taken AS (
            SELECT provider_id, row_number() OVER (ORDER BY provider_id) AS n
            FROM email_message_reconciliation WHERE link_id = $1
        )
        UPDATE email_message_reconciliation q SET available_at = CASE taken.n
            WHEN 1 THEN 'infinity'::timestamptz ELSE now() + interval '30 minutes' END
        FROM taken WHERE q.link_id = $1 AND q.provider_id = taken.provider_id AND taken.n <= 2
    "#,
        link
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import) VALUES
            ($1,1,'one-more',true),
            ($1,1,'arrived',false)
    "#,
        link
    )
    .execute(&db)
    .await
    .unwrap();
    make_due(&db, link).await;
    assert!(service.enumerate_once().await.unwrap());
    assert_eq!(folder.pages_read(), 3);
    assert!(!service.enumerate_once().await.unwrap());
    assert_eq!(folder.pages_read(), 3);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_folder_past_its_import_reads_new_mail_while_the_import_is_queued(db: PgPool) {
    let (repo, link) = fixture(&db).await;
    sqlx::query!(
        r#"
        INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import)
        SELECT $1,1,'queued-' || n,true FROM generate_series(1,300) n
    "#,
        link
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_sync_streams SET initial_complete = true, position = 'checkpoint' WHERE link_id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let folder = LargeFolder::default();
    let service = MailboxSyncService::new(repo.clone(), folder.clone(), folder.clone(), repo);

    for _ in 0..3 {
        assert!(service.enumerate_once().await.unwrap());
    }
    assert_eq!(folder.pages_read(), 3);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_paced_import_round_does_not_take_another_mailboxs_turn(db: PgPool) {
    let (repo, importing) = fixture(&db).await;
    sqlx::query!(
        r#"
        INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import)
        SELECT $1,1,'queued-' || n,true FROM generate_series(1,200) n
    "#,
        importing
    )
    .execute(&db)
    .await
    .unwrap();
    sqlx::query!(
        "UPDATE email_sync_streams SET next_run_at = now() - interval '1 minute' WHERE link_id = $1",
        importing
    )
    .execute(&db)
    .await
    .unwrap();
    let polled = macro_uuid::generate_uuid_v7();
    sqlx::query!(r#"
        INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,grant_generation)
        VALUES ($1,'macro|polled@example.com','outlook-owner','polled@example.com','OUTLOOK',1)
    "#,polled).execute(&db).await.unwrap();
    sqlx::query!(
        "INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,initial_complete,position) VALUES ($1,$2,1,'mail_folder','folder',true,'checkpoint')",
        macro_uuid::generate_uuid_v7(),
        polled
    )
    .execute(&db)
    .await
    .unwrap();
    let folder = LargeFolder::default();
    let service = MailboxSyncService::new(repo.clone(), folder.clone(), folder.clone(), repo);

    // The importing mailbox's round comes first and is paced; the same call
    // goes on to read the other mailbox's folder.
    assert!(service.enumerate_once().await.unwrap());
    assert_eq!(folder.pages_read(), 1);
    assert_eq!(queued_imports(&db, importing).await, 200);
    let read = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM email_message_reconciliation WHERE link_id = $1 AND NOT is_import"#,
        polled
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert_eq!(read, 100);
}

/// The request gate while `busy`'s import slots are in use: every page of
/// its folders is refused. Other mailboxes' folders list one message.
#[derive(Clone)]
struct BusyImport {
    busy: Uuid,
    read: Arc<Mutex<Vec<Uuid>>>,
}

impl MailboxGateway for BusyImport {
    async fn folders(&self, _: MailboxKey) -> Result<MailFolderCatalog, EmailApiError> {
        Ok(MailFolderCatalog::Folders(Vec::new()))
    }
    async fn changes(
        &self,
        mailbox: MailboxKey,
        _: &ProviderId,
        _: Option<&StreamToken>,
        _: RoundStart,
    ) -> Result<MailboxChangePage, EmailApiError> {
        if mailbox.link_id == self.busy {
            return Err(EmailApiError::RateLimited {
                retry_after: Some(std::time::Duration::from_secs(1)),
                origin: RateLimitOrigin::Gate(GateLimit::Concurrency),
            });
        }
        self.read.lock().unwrap().push(mailbox.link_id);
        Ok(MailboxChangePage {
            changed: vec![ProviderId::new("new-mail").unwrap()],
            removed: Vec::new(),
            position: StreamPosition::Checkpoint(StreamToken::new("checkpoint".into())),
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
    async fn admitted_requests(&self, _: MailboxKey) -> Option<u64> {
        None
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_import_round_the_gate_refuses_waits_like_a_paced_one(db: PgPool) {
    let (repo, importing) = fixture(&db).await;
    sqlx::query!(
        "UPDATE email_sync_streams SET next_run_at = now() - interval '1 minute' WHERE link_id = $1",
        importing
    )
    .execute(&db)
    .await
    .unwrap();
    let polled = macro_uuid::generate_uuid_v7();
    sqlx::query!(r#"
        INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,grant_generation)
        VALUES ($1,'macro|polled@example.com','outlook-owner','polled@example.com','OUTLOOK',1)
    "#,polled).execute(&db).await.unwrap();
    sqlx::query!(
        "INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,initial_complete,position) VALUES ($1,$2,1,'mail_folder','folder',true,'checkpoint')",
        macro_uuid::generate_uuid_v7(),
        polled
    )
    .execute(&db)
    .await
    .unwrap();
    let gate = BusyImport {
        busy: importing,
        read: Arc::default(),
    };
    let service = MailboxSyncService::new(repo.clone(), gate.clone(), gate.clone(), repo);

    // The refused round comes first; the same call reads the other folder.
    assert!(service.enumerate_once().await.unwrap());
    assert_eq!(*gate.read.lock().unwrap(), [polled]);
    let waits = sqlx::query_scalar!(
        r#"SELECT next_run_at > now() + interval '5 seconds' AS "waits!" FROM email_sync_streams WHERE link_id = $1"#,
        importing
    )
    .fetch_one(&db)
    .await
    .unwrap();
    assert!(
        waits,
        "a refused round waits as long as a paced one, not the gate's second"
    );
}
