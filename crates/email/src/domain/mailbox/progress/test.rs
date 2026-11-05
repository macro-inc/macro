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
