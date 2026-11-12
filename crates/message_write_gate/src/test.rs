use super::*;
use std::future::Future;
use std::pin::Pin;
use std::task::{Context, Waker};

fn assert_pending<T>(future: Pin<&mut impl Future<Output = T>>) {
    let mut context = Context::from_waker(Waker::noop());
    assert!(future.poll(&mut context).is_pending());
}

#[tokio::test]
async fn all_callers_share_four_permits_for_a_parent() {
    let mut held = Vec::new();
    for _ in 0..4 {
        held.push(acquire("channel", "shared-limit").await.unwrap());
    }
    let PermitLease::Parent(original) = &held[0]._lease else {
        panic!("top-level admission must use the shared registry");
    };
    let original = original.semaphore.clone();
    let mut fifth = Box::pin(acquire("channel", "shared-limit"));
    assert_pending(fifth.as_mut());

    drop(held.pop());
    let fifth = fifth.await.unwrap();
    let PermitLease::Parent(lease) = &fifth._lease else {
        panic!("top-level admission must use the shared registry");
    };
    assert!(Arc::ptr_eq(&original, &lease.semaphore));
    let mut sixth = Box::pin(acquire("channel", "shared-limit"));
    assert_pending(sixth.as_mut());

    drop(fifth);
    drop(sixth.await.unwrap());
    drop(held);
    let parent = Parent {
        kind: "channel".into(),
        id: "shared-limit".into(),
    };
    assert!(!registry().entries.lock().unwrap().contains_key(&parent));
}

#[tokio::test]
async fn parent_kind_and_id_have_independent_limits() {
    let registry = Arc::new(Registry::default());
    let mut held = Vec::new();
    for _ in 0..4 {
        held.push(registry.acquire("channel", "same-id").await.unwrap());
    }
    let mut waiting = Box::pin(registry.acquire("channel", "same-id"));
    assert_pending(waiting.as_mut());

    for _ in 0..4 {
        held.push(registry.acquire("document", "same-id").await.unwrap());
        held.push(registry.acquire("channel", "different-id").await.unwrap());
    }
    assert_eq!(registry.entries.lock().unwrap().len(), 3);
    drop(held);
    drop(waiting.await.unwrap());
    assert!(registry.entries.lock().unwrap().is_empty());
}

#[tokio::test(start_paused = true)]
async fn saturated_parent_times_out_after_two_seconds() {
    let registry = Arc::new(Registry::default());
    let mut held = Vec::new();
    for _ in 0..4 {
        held.push(registry.acquire("channel", "timeout").await.unwrap());
    }
    let mut waiting = Box::pin(registry.acquire("channel", "timeout"));
    assert_pending(waiting.as_mut());
    tokio::time::advance(Duration::from_millis(1_999)).await;
    assert_pending(waiting.as_mut());
    tokio::time::advance(Duration::from_millis(1)).await;
    assert_eq!(waiting.await.unwrap_err(), AdmissionTimeout);

    let entries = registry.entries.lock().unwrap();
    assert_eq!(entries.len(), 1);
    assert_eq!(entries.values().next().unwrap().leases, 4);
    drop(entries);
    drop(held);
    assert!(registry.entries.lock().unwrap().is_empty());
}

#[tokio::test]
async fn cancelling_a_waiter_releases_its_lease() {
    let registry = Arc::new(Registry::default());
    let mut held = Vec::new();
    for _ in 0..4 {
        held.push(registry.acquire("channel", "cancel").await.unwrap());
    }
    let mut waiting = Box::pin(registry.acquire("channel", "cancel"));
    assert_pending(waiting.as_mut());
    drop(waiting);
    assert_eq!(
        registry
            .entries
            .lock()
            .unwrap()
            .values()
            .next()
            .unwrap()
            .leases,
        4
    );

    drop(held.pop());
    held.push(registry.acquire("channel", "cancel").await.unwrap());
    let mut still_full = Box::pin(registry.acquire("channel", "cancel"));
    assert_pending(still_full.as_mut());
    drop(still_full);
    drop(held);
    assert!(registry.entries.lock().unwrap().is_empty());
}

#[tokio::test]
async fn cancelling_after_a_slot_is_assigned_does_not_leak_it() {
    let registry = Arc::new(Registry::default());
    let mut held = Vec::new();
    for _ in 0..4 {
        held.push(
            registry
                .acquire("channel", "assigned-cancel")
                .await
                .unwrap(),
        );
    }
    let mut waiting = Box::pin(registry.acquire("channel", "assigned-cancel"));
    assert_pending(waiting.as_mut());

    // The semaphore assigns the returned slot to the waiter before it is
    // polled again. Cancelling must return both that slot and its registry lease.
    drop(held.pop());
    drop(waiting);
    held.push(
        registry
            .acquire("channel", "assigned-cancel")
            .await
            .unwrap(),
    );
    drop(held);
    assert!(registry.entries.lock().unwrap().is_empty());
}

#[tokio::test]
async fn unpolled_acquisition_does_not_register_a_parent() {
    let registry = Arc::new(Registry::default());
    drop(registry.acquire("channel", "never-polled"));
    assert!(registry.entries.lock().unwrap().is_empty());
}

#[tokio::test]
async fn dropping_many_parents_removes_every_idle_entry() {
    let registry = Arc::new(Registry::default());
    let mut held = Vec::new();
    for index in 0..1_024 {
        held.push(
            registry
                .acquire("channel", &index.to_string())
                .await
                .unwrap(),
        );
    }
    assert_eq!(registry.entries.lock().unwrap().len(), 1_024);
    drop(held);
    assert!(registry.entries.lock().unwrap().is_empty());

    for index in 0..1_024 {
        let id = index.to_string();
        let permit = registry.acquire("channel", &id).await.unwrap();
        assert_eq!(permit._permit.semaphore().available_permits(), 3);
        drop(permit);
    }
    assert!(registry.entries.lock().unwrap().is_empty());
}

#[tokio::test]
async fn scoped_writes_reuse_admission_when_all_global_slots_are_held() {
    let mut held = Vec::new();
    for _ in 0..4 {
        held.push(acquire("channel", "nested-full").await.unwrap());
    }
    let outer = held.pop().unwrap();
    let nested = outer
        .scope(async { acquire("channel", "nested-full").await.unwrap() })
        .await;
    assert!(matches!(nested._lease, PermitLease::Scoped(_)));

    let mut fifth = Box::pin(acquire("channel", "nested-full"));
    assert_pending(fifth.as_mut());
    drop(nested);
    drop(fifth.await.unwrap());
    drop(held);
    let parent = Parent {
        kind: "channel".into(),
        id: "nested-full".into(),
    };
    assert!(!registry().entries.lock().unwrap().contains_key(&parent));
}

#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
async fn parallel_nested_writes_never_exceed_four_active_writers() {
    use std::sync::atomic::{AtomicUsize, Ordering};
    let barrier = Arc::new(tokio::sync::Barrier::new(4));
    let active = Arc::new(AtomicUsize::new(0));
    let maximum = Arc::new(AtomicUsize::new(0));
    let mut tasks = tokio::task::JoinSet::new();
    for _ in 0..4 {
        let barrier = barrier.clone();
        let active = active.clone();
        let maximum = maximum.clone();
        tasks.spawn(async move {
            acquire("channel", "parallel-nested")
                .await
                .unwrap()
                .scope(async {
                    let write = async || {
                        let permit = acquire("channel", "parallel-nested").await.unwrap();
                        let count = active.fetch_add(1, Ordering::SeqCst) + 1;
                        maximum.fetch_max(count, Ordering::SeqCst);
                        assert!(count <= 4);
                        barrier.wait().await;
                        active.fetch_sub(1, Ordering::SeqCst);
                        drop(permit);
                    };
                    tokio::join!(write(), write());
                })
                .await;
        });
    }
    while let Some(task) = tasks.join_next().await {
        task.unwrap();
    }
    assert_eq!(active.load(Ordering::SeqCst), 0);
    assert_eq!(maximum.load(Ordering::SeqCst), 4);
    let parent = Parent {
        kind: "channel".into(),
        id: "parallel-nested".into(),
    };
    assert!(!registry().entries.lock().unwrap().contains_key(&parent));
}

#[tokio::test]
async fn cancelling_a_scope_releases_nested_admission_and_the_idle_entry() {
    let outer = acquire("channel", "cancel-scope").await.unwrap();
    let mut scoped = Box::pin(outer.scope(async {
        let _nested = acquire("channel", "cancel-scope").await.unwrap();
        std::future::pending::<()>().await;
    }));
    assert_pending(scoped.as_mut());
    drop(scoped);
    let parent = Parent {
        kind: "channel".into(),
        id: "cancel-scope".into(),
    };
    assert!(!registry().entries.lock().unwrap().contains_key(&parent));
}

#[tokio::test]
async fn a_scope_does_not_bypass_another_parent_limit() {
    let mut held = Vec::new();
    for _ in 0..4 {
        held.push(acquire("document", "scope-kind").await.unwrap());
    }
    acquire("channel", "scope-kind")
        .await
        .unwrap()
        .scope(async {
            let mut other = Box::pin(acquire("document", "scope-kind"));
            assert_pending(other.as_mut());
            drop(other);
        })
        .await;
    drop(held);
}
