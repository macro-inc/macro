use super::*;
use email::domain::mailbox::MailboxKey;
use email::outbound::mailbox_pg::PgMailboxSync;
use email_api_client::domain::models::{
    MailFolder, MailFolderCatalog, MailboxChangePage, MailboxMessage, ProviderId, RoundStart,
    StreamPosition, StreamToken,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::sync::{Arc, Mutex};
use tokio::sync::Notify;
use uuid::Uuid;

/// Logs every read. An importing folder always has another page; the synced
/// folder's page reaches a checkpoint, and no message is found.
#[derive(Clone, Default)]
struct Provider {
    reads: Arc<Mutex<Vec<String>>>,
    synced_read: Arc<Notify>,
}

impl MailboxGateway for Provider {
    async fn folders(&self, _: MailboxKey) -> Result<MailFolderCatalog, EmailApiError> {
        Ok(MailFolderCatalog::Folders(Vec::new()))
    }
    async fn changes(
        &self,
        _: MailboxKey,
        folder: &ProviderId,
        _: Option<&StreamToken>,
        _: RoundStart,
    ) -> Result<MailboxChangePage, EmailApiError> {
        self.reads.lock().unwrap().push(folder.as_str().to_owned());
        let position = if folder.as_str() == "importing" {
            StreamPosition::Continue(StreamToken::new("next-page".into()))
        } else {
            self.synced_read.notify_one();
            StreamPosition::Checkpoint(StreamToken::new("checkpoint".into()))
        };
        Ok(MailboxChangePage {
            changed: Vec::new(),
            removed: Vec::new(),
            position,
            reader_revision: 1,
        })
    }
    async fn message(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: &[MailFolder],
    ) -> Result<Option<MailboxMessage>, EmailApiError> {
        self.reads.lock().unwrap().push("message".into());
        Ok(None)
    }
    async fn admitted_requests(&self, _: MailboxKey) -> Option<u64> {
        None
    }
}

async fn mailbox(db: &PgPool, folder: &str, synced: bool, due: &str) -> Uuid {
    let link = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO email_links (id,macro_id,fusionauth_user_id,email_address,provider,grant_generation)
        VALUES ($1,$2,'outlook-owner',$3,'OUTLOOK',1)
    "#,
        link,
        format!("macro|{link}@example.com"),
        format!("{link}@example.com")
    )
    .execute(db)
    .await
    .unwrap();
    sqlx::query!(
        r#"
        INSERT INTO email_sync_streams (id,link_id,generation,kind,scope_id,position,initial_complete,next_run_at)
        VALUES ($1,$2,1,'mail_folder',$3,$4,$5,now() - $6::text::interval)
    "#,
        macro_uuid::generate_uuid_v7(),
        link,
        folder,
        synced.then_some("checkpoint"),
        synced,
        due
    )
    .execute(db)
    .await
    .unwrap();
    link
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn new_mail_in_a_synced_folder_waits_behind_one_queued_import_message_not_a_cycle(
    db: PgPool,
) {
    let importing = mailbox(&db, "importing", false, "7 minutes").await;
    // Due after the importing folder's first page and before its next one,
    // which is claimed as if due five minutes earlier than it is.
    mailbox(&db, "synced", true, "6 minutes").await;
    // Each queued message is read once more and then recorded as gone.
    sqlx::query!(
        r#"
        INSERT INTO email_message_reconciliation (link_id,generation,provider_id,is_import,attempts)
        SELECT $1,1,'queued-' || n,true,3 FROM generate_series(1,40) n
    "#,
        importing
    )
    .execute(&db)
    .await
    .unwrap();
    let repo = PgMailboxSync::new(db.clone());
    let provider = Provider::default();
    let service = MailboxSyncService::new(repo.clone(), provider.clone(), provider.clone(), repo);
    let cancellation = CancellationToken::new();
    let worker = tokio::spawn(run(service, cancellation.clone()));

    tokio::time::timeout(Duration::from_secs(30), provider.synced_read.notified())
        .await
        .expect("the synced folder's page is read");
    cancellation.cancel();
    worker.await.unwrap();

    let reads = provider.reads.lock().unwrap().clone();
    let before_synced: Vec<_> = reads.iter().take_while(|read| *read != "synced").collect();
    assert_eq!(before_synced, ["importing", "message"], "{reads:?}");
}
