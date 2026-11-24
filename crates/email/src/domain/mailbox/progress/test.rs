use super::*;
use std::sync::atomic::{AtomicBool, Ordering};

/// Fails the first flush, then keeps what later flushes write.
#[derive(Default)]
struct FlakyStore {
    failed_once: AtomicBool,
    written: Mutex<Vec<HashMap<Uuid, MailboxImports>>>,
}

impl MailboxProgressRepository for FlakyStore {
    async fn record_imports(
        &self,
        imports: &HashMap<Uuid, MailboxImports>,
    ) -> Result<(), MailboxError> {
        if !self.failed_once.swap(true, Ordering::SeqCst) {
            return Err(MailboxError::Persistence);
        }
        self.written.lock().unwrap().push(imports.clone());
        Ok(())
    }
    async fn backlogs(&self) -> Result<Vec<MailboxBacklog>, MailboxError> {
        Ok(Vec::new())
    }
    async fn folder_line(&self) -> Result<FolderLine, MailboxError> {
        Ok(FolderLine {
            polls_due: 0,
            oldest_poll_due_seconds: 0,
            import_rounds_due: 0,
            oldest_import_round_due_seconds: 0,
        })
    }
}

#[tokio::test]
async fn imports_counted_before_a_failed_flush_reach_the_next_one() {
    let link = Uuid::now_v7();
    let early = Utc::now() - chrono::Duration::seconds(30);
    let late = Utc::now();
    let tally = ImportTally::default();
    let service = MailboxProgressService::new(FlakyStore::default(), tally.clone());
    tally.record(link, early);
    tally.record(link, early);

    assert!(service.flush().await.is_err());
    tally.record(link, late);
    service.flush().await.unwrap();

    let written = service.repo.written.lock().unwrap();
    assert_eq!(
        written.as_slice(),
        [HashMap::from([(
            link,
            MailboxImports {
                imported: 3,
                last_imported_at: late,
            }
        )])]
    );
}

/// The folder line can't be read; each mailbox's backlog can.
struct LineUnavailable {
    link: Uuid,
}

impl MailboxProgressRepository for LineUnavailable {
    async fn record_imports(&self, _: &HashMap<Uuid, MailboxImports>) -> Result<(), MailboxError> {
        Ok(())
    }
    async fn backlogs(&self) -> Result<Vec<MailboxBacklog>, MailboxError> {
        Ok(vec![MailboxBacklog {
            link_id: self.link,
            sync_generation: 1,
            queued: 0,
            parked: 0,
            abandoned: 0,
            leased: 0,
            oldest_waiting_seconds: 0,
            parked_until_max_seconds: 0,
            streams_incomplete: 0,
            imported_5m: 0,
            seconds_since_last_import: None,
            sync_active: true,
            needs_reauth: false,
            mailbox_unavailable: false,
            watch_failures: 0,
        }])
    }
    async fn folder_line(&self) -> Result<FolderLine, MailboxError> {
        Err(MailboxError::Persistence)
    }
}

#[tokio::test]
async fn mailbox_snapshots_go_out_when_the_folder_line_cannot_be_read() {
    let service = MailboxProgressService::new(
        LineUnavailable {
            link: Uuid::now_v7(),
        },
        ImportTally::default(),
    );

    assert_eq!(service.report().await.unwrap(), 1);
}
