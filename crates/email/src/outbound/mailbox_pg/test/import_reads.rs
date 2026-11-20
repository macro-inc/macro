//! Which provider each kind of sync work reads through.

use super::fixture;
use crate::domain::mailbox::*;
use email_api_client::domain::models::{
    EmailApiError, MailFolder, MailFolderCatalog, MailboxChangePage, MailboxMessage, ProviderId,
    RoundStart, StreamPosition, StreamToken,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;
use std::sync::{Arc, Mutex};

/// Answers every read with nothing new, logging which provider served it.
struct Provider {
    name: &'static str,
    reads: Arc<Mutex<Vec<(&'static str, &'static str)>>>,
}

impl Provider {
    fn served(&self, read: &'static str) {
        self.reads.lock().unwrap().push((self.name, read));
    }
}

impl MailboxGateway for Provider {
    async fn folders(&self, _: MailboxKey) -> Result<MailFolderCatalog, EmailApiError> {
        self.served("folders");
        Ok(MailFolderCatalog::Folders(Vec::new()))
    }
    async fn changes(
        &self,
        _: MailboxKey,
        _: &ProviderId,
        _: Option<&StreamToken>,
        _: RoundStart,
    ) -> Result<MailboxChangePage, EmailApiError> {
        self.served("changes");
        Ok(MailboxChangePage {
            changed: Vec::new(),
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
        self.served("message");
        Ok(None)
    }
    async fn admitted_requests(&self, _: MailboxKey) -> Option<u64> {
        None
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_import_reads_through_the_import_provider_and_live_work_through_the_live_one(
    db: PgPool,
) {
    let (repo, link) = fixture(&db).await;
    sqlx::query!(
        r#"
        INSERT INTO email_message_reconciliation(link_id,generation,provider_id,is_import) VALUES
            ($1,1,'imported',true),
            ($1,1,'arrived',false)
    "#,
        link
    )
    .execute(&db)
    .await
    .unwrap();
    let reads = Arc::new(Mutex::new(Vec::new()));
    let service = MailboxSyncService::new(
        repo.clone(),
        Provider {
            name: "live",
            reads: reads.clone(),
        },
        Provider {
            name: "import",
            reads: reads.clone(),
        },
        repo.clone(),
    );

    // The folder's first round is its import; once it reached a checkpoint,
    // the next round only reads what changed since.
    assert!(service.enumerate_once().await.unwrap());
    sqlx::query!(
        "UPDATE email_sync_streams SET next_run_at = now() WHERE link_id = $1",
        link
    )
    .execute(&db)
    .await
    .unwrap();
    assert!(service.enumerate_once().await.unwrap());
    // Live rows are claimed first. Neither message is found: the live one
    // is released to be read again, the import one settles as gone.
    assert!(matches!(
        service.reconcile_once().await,
        Err(MailboxError::LocationUnsettled)
    ));
    assert!(service.reconcile_once().await.unwrap());

    assert_eq!(
        *reads.lock().unwrap(),
        [
            ("import", "changes"),
            ("live", "changes"),
            ("live", "message"),
            ("import", "message"),
        ]
    );
}
