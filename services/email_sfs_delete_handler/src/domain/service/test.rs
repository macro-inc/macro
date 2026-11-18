use std::{
    collections::VecDeque,
    sync::{Arc, Mutex},
};

use uuid::Uuid;

use super::*;
use crate::domain::models::OrphanedAttachment;

#[derive(Debug, PartialEq, Eq)]
enum Call {
    FindOrphaned,
    Enqueue(OrphanedAttachment),
}

type Calls = Arc<Mutex<Vec<Call>>>;

struct Repository {
    calls: Calls,
    results: Mutex<VecDeque<Result<Vec<OrphanedAttachment>, &'static str>>>,
}

impl OrphanRepository for Repository {
    type Error = &'static str;

    async fn find_orphaned(&self) -> Result<Vec<OrphanedAttachment>, Self::Error> {
        self.calls.lock().unwrap().push(Call::FindOrphaned);
        self.results
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected repository call")
    }
}

struct Queue {
    calls: Calls,
    results: Mutex<VecDeque<Result<(), &'static str>>>,
}

impl DeleteQueue for Queue {
    type Error = &'static str;

    async fn enqueue(&self, attachment: OrphanedAttachment) -> Result<(), Self::Error> {
        self.calls.lock().unwrap().push(Call::Enqueue(attachment));
        self.results
            .lock()
            .unwrap()
            .pop_front()
            .expect("unexpected queue call")
    }
}

fn attachment(id: u128) -> OrphanedAttachment {
    OrphanedAttachment {
        db_id: Uuid::from_u128(id),
        sfs_id: Uuid::from_u128(900 + id),
    }
}

fn service(
    batches: impl IntoIterator<Item = Result<Vec<OrphanedAttachment>, &'static str>>,
    sends: impl IntoIterator<Item = Result<(), &'static str>>,
) -> (OrphanCleanup<Repository, Queue>, Calls) {
    let calls = Calls::default();
    (
        OrphanCleanup::new(
            Repository {
                calls: Arc::clone(&calls),
                results: Mutex::new(batches.into_iter().collect()),
            },
            Queue {
                calls: Arc::clone(&calls),
                results: Mutex::new(sends.into_iter().collect()),
            },
        ),
        calls,
    )
}

#[tokio::test]
async fn empty_query_sends_nothing() {
    let (service, calls) = service([Ok(vec![])], []);
    service.enqueue_orphaned_attachments().await;
    assert_eq!(*calls.lock().unwrap(), [Call::FindOrphaned]);
}

#[tokio::test]
async fn query_failure_sends_nothing_and_finishes() {
    let (service, calls) = service([Err("query failed")], []);
    service.enqueue_orphaned_attachments().await;
    assert_eq!(*calls.lock().unwrap(), [Call::FindOrphaned]);
}

#[tokio::test]
async fn sends_every_row_in_repository_order() {
    let rows = vec![attachment(3), attachment(1), attachment(2)];
    let (service, calls) = service([Ok(rows.clone())], [Ok(()); 3]);
    service.enqueue_orphaned_attachments().await;
    assert_eq!(
        *calls.lock().unwrap(),
        std::iter::once(Call::FindOrphaned)
            .chain(rows.into_iter().map(Call::Enqueue))
            .collect::<Vec<_>>()
    );
}

async fn verify_queue_failures(sends: [Result<(), &'static str>; 3]) {
    let rows = vec![attachment(1), attachment(2), attachment(3)];
    let (service, calls) = service([Ok(rows)], sends);
    service.enqueue_orphaned_attachments().await;
    assert_eq!(
        *calls.lock().unwrap(),
        [
            Call::FindOrphaned,
            Call::Enqueue(attachment(1)),
            Call::Enqueue(attachment(2)),
            Call::Enqueue(attachment(3))
        ]
    );
}

#[tokio::test]
async fn continues_after_first_queue_failure() {
    verify_queue_failures([Err("queue failed"), Ok(()), Ok(())]).await;
}

#[tokio::test]
async fn continues_after_middle_queue_failure() {
    verify_queue_failures([Ok(()), Err("queue failed"), Ok(())]).await;
}

#[tokio::test]
async fn finishes_after_all_queue_sends_fail() {
    verify_queue_failures([Err("queue failed"); 3]).await;
}

#[tokio::test]
async fn repeated_invocations_query_again_and_do_not_deduplicate_static_file_ids() {
    let first = attachment(1);
    let second = OrphanedAttachment {
        db_id: Uuid::from_u128(2),
        sfs_id: first.sfs_id,
    };
    let (service, calls) = service(
        [Ok(vec![first, second]), Ok(vec![first, second])],
        [Ok(()); 4],
    );
    service.enqueue_orphaned_attachments().await;
    service.enqueue_orphaned_attachments().await;
    assert_eq!(
        *calls.lock().unwrap(),
        [
            Call::FindOrphaned,
            Call::Enqueue(first),
            Call::Enqueue(second),
            Call::FindOrphaned,
            Call::Enqueue(first),
            Call::Enqueue(second)
        ]
    );
}
