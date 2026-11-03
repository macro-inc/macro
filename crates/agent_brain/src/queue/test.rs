use std::sync::Arc;

use tokio::sync::{Semaphore, mpsc};

use super::*;

type Seen = mpsc::UnboundedReceiver<(String, Vec<u32>)>;

/// A queue whose handler reports each batch, then waits for a permit.
fn gated(dir: &Path) -> (ConversationQueue<u32>, Seen, Arc<Semaphore>) {
    let (tx, rx) = mpsc::unbounded_channel();
    let gate = Arc::new(Semaphore::new(0));
    let handler_gate = Arc::clone(&gate);
    let queue =
        ConversationQueue::new(dir, CancellationToken::new(), move |conversation, batch| {
            let tx = tx.clone();
            let gate = Arc::clone(&handler_gate);
            async move {
                tx.send((conversation, batch)).ok();
                gate.acquire()
                    .await
                    .map_err(|e| Error::Wake(e.to_string()))?
                    .forget();
                Ok(())
            }
        });
    (queue, rx, gate)
}

#[tokio::test]
async fn items_queued_during_a_turn_arrive_as_one_batch() {
    let dir = tempfile::tempdir().unwrap();
    let (queue, mut seen, gate) = gated(dir.path());

    queue.push("ch1", &1).await.unwrap();
    assert_eq!(seen.recv().await.unwrap(), ("ch1".to_owned(), vec![1]));
    queue.push("ch1", &2).await.unwrap();
    queue.push("ch1", &3).await.unwrap();
    assert_eq!(queue.pending("ch1").await.unwrap(), vec![1, 2, 3]);

    gate.add_permits(1);
    assert_eq!(seen.recv().await.unwrap(), ("ch1".to_owned(), vec![2, 3]));
    gate.add_permits(1);
    queue.shutdown().await;
    assert!(queue.pending("ch1").await.unwrap().is_empty());
}

#[tokio::test]
async fn conversations_run_in_parallel() {
    let dir = tempfile::tempdir().unwrap();
    let (queue, mut seen, gate) = gated(dir.path());

    queue.push("a", &1).await.unwrap();
    queue.push("b", &2).await.unwrap();
    let mut got = vec![seen.recv().await.unwrap(), seen.recv().await.unwrap()];
    got.sort();

    assert_eq!(
        got,
        vec![("a".to_owned(), vec![1]), ("b".to_owned(), vec![2])]
    );
    gate.add_permits(2);
    queue.shutdown().await;
}

#[tokio::test]
async fn an_interrupted_batch_runs_first_after_a_restart() {
    let dir = tempfile::tempdir().unwrap();
    tokio::fs::write(dir.path().join("ch1.batch"), "1\n")
        .await
        .unwrap();
    tokio::fs::write(dir.path().join("ch1.jsonl"), "2\n3\n")
        .await
        .unwrap();
    let (queue, mut seen, gate) = gated(dir.path());
    gate.add_permits(10);

    assert_eq!(queue.resume().await.unwrap(), 1);
    assert_eq!(seen.recv().await.unwrap().1, vec![1]);
    assert_eq!(seen.recv().await.unwrap().1, vec![2, 3]);
    queue.shutdown().await;
    assert!(!dir.path().join("ch1.batch").exists());
    assert!(!dir.path().join("ch1.jsonl").exists());
}

#[tokio::test]
async fn a_failed_batch_is_set_aside_not_lost() {
    let dir = tempfile::tempdir().unwrap();
    let queue: ConversationQueue<u32> =
        ConversationQueue::new(dir.path(), CancellationToken::new(), |_, _| async {
            Err(Error::Wake("agent crashed".to_owned()))
        });

    queue.push("ch1", &7).await.unwrap();
    queue.shutdown().await;

    let failed = crate::memory::list_dir(&dir.path().join("failed"))
        .await
        .unwrap();
    assert_eq!(failed.len(), 1);
    let items: Vec<u32> = read_jsonl(&failed[0]).await.unwrap();
    assert_eq!(items, vec![7]);
    assert!(queue.pending("ch1").await.unwrap().is_empty());
}

#[tokio::test]
async fn conversation_keys_are_file_safe() {
    let dir = tempfile::tempdir().unwrap();
    let (queue, mut seen, gate) = gated(dir.path());
    gate.add_permits(1);

    queue.push("../escape", &1).await.unwrap();

    assert_eq!(seen.recv().await.unwrap().0, ".._escape");
    queue.shutdown().await;
}
