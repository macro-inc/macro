use super::*;

const THREADS: &str = r#"query Threads($input: SoupInput!) {
    user { id soup(input: $input) { nextCursor items {
        __typename id ... on GraphqlSoupEmailThread { isRead }
    } } }
}"#;

const MARK_SEEN: &str = "mutation Read($input: MarkEmailThreadSeenInput!) { markEmailThreadSeen(input: $input) { id isRead } }";

fn threads(limit: u32, id: &str, read: bool) -> WriteRequest {
    let serde_json::Value::Object(variables) = serde_json::json!({"input": {"limit": limit}})
    else {
        unreachable!()
    };
    WriteRequest {
        origin_op_id: None,
        registration: None,
        query: THREADS.into(),
        operation_name: Some("Threads".into()),
        variables,
        data: serde_json::json!({"user": {"id": "user-1", "soup": {"nextCursor": null, "items": [
            {"__typename": "GraphqlSoupEmailThread", "id": id, "isRead": read}
        ]}}}),
        identity: None,
    }
}

fn read_threads(handle: &EngineHandle, limit: u32) -> serde_json::Value {
    let request = threads(limit, "", false);
    let ReadResultWire::Hit { data } = block_on(handle.read(
        None,
        request.query,
        request.operation_name,
        request.variables,
        Vec::new(),
    ))
    .unwrap() else {
        panic!("expected hit")
    };
    data["user"]["soup"]["items"][0].clone()
}

/// Marks `thread-a` seen through the mutation queue, up to its claim.
async fn claimed_mark_seen(handle: &EngineHandle) -> (String, String) {
    let serde_json::Value::Object(variables) =
        serde_json::json!({"input": {"threadId": "thread-a"}})
    else {
        unreachable!()
    };
    let enqueued = handle
        .enqueue_optimistic_mutation(
            None,
            "00000000-0000-4000-8000-000000000001".into(),
            MARK_SEEN.into(),
            Some("Read".into()),
            variables,
            serde_json::json!({"markEmailThreadSeen": {"id": "thread-a", "isRead": true}}),
            vec![],
            vec![],
            vec![],
            0,
            "runner".into(),
            10,
            1_000,
            None,
            vec![],
        )
        .await
        .unwrap();
    let InitialMutationClaimWire::Claimed { mutation } = enqueued.initial_claim else {
        panic!("the queue head is claimed")
    };
    (enqueued.transaction_id, mutation.lease_generation)
}

fn commit_mark_seen(
    handle: &EngineHandle,
    (transaction, lease): (String, String),
) -> impl std::future::Future<Output = Result<CommitOptimisticWriteResultWire, String>> + '_ {
    let serde_json::Value::Object(variables) =
        serde_json::json!({"input": {"threadId": "thread-a"}})
    else {
        unreachable!()
    };
    handle.commit_optimistic_write(
        transaction,
        "runner".into(),
        lease,
        MARK_SEEN.into(),
        Some("Read".into()),
        variables,
        serde_json::json!({"markEmailThreadSeen": {"id": "thread-a", "isRead": true}}),
    )
}

/// A query response fetched before a mutation can reach the engine after the
/// mutation's commit was queued and before the webview hears it settled. Run
/// in the background, it is refused when its turn comes after that commit
/// changed one of its records, so the committed value stays; one for other
/// records lands, and a foreground write is never refused.
#[test]
fn a_background_write_after_a_commit_cannot_put_back_what_the_commit_changed() {
    block_on(async {
        let handle = spawn_handle();
        handle.write(threads(1, "thread-a", false)).await.unwrap();
        handle.write(threads(2, "thread-b", false)).await.unwrap();
        let claim = claimed_mark_seen(&handle).await;

        let noop = std::task::Waker::noop();
        let held = handle.inner.write().await;
        let mut commit = Box::pin(commit_mark_seen(&handle, claim));
        assert!(poll_once(commit.as_mut(), noop).is_pending());
        let mut stale = Box::pin(handle.write_in_background(threads(1, "thread-a", false)));
        assert!(poll_once(stale.as_mut(), noop).is_pending());
        let mut other = Box::pin(handle.write_in_background(threads(2, "thread-b", true)));
        assert!(poll_once(other.as_mut(), noop).is_pending());
        drop(held);

        assert!(matches!(
            commit.await.unwrap(),
            CommitOptimisticWriteResultWire::Committed { .. }
        ));
        let stale = stale.await;
        other.await.unwrap();
        assert_eq!(
            read_threads(&handle, 1)["isRead"],
            true,
            "the commit's value stays"
        );
        assert_eq!(stale.unwrap_err(), commits::SUPERSEDED);
        assert_eq!(
            read_threads(&handle, 2)["isRead"],
            true,
            "other records land"
        );

        // Arriving after the commit settled, the webview has checked it.
        handle
            .write_in_background(threads(1, "thread-a", false))
            .await
            .unwrap();
        assert_eq!(read_threads(&handle, 1)["isRead"], false);
    });
}

/// The same race with a foreground write: it keeps today's order and lands.
#[test]
fn a_foreground_write_after_a_commit_still_lands() {
    block_on(async {
        let handle = spawn_handle();
        handle.write(threads(1, "thread-a", false)).await.unwrap();
        let claim = claimed_mark_seen(&handle).await;

        let noop = std::task::Waker::noop();
        let held = handle.inner.write().await;
        let mut commit = Box::pin(commit_mark_seen(&handle, claim));
        assert!(poll_once(commit.as_mut(), noop).is_pending());
        let mut write = Box::pin(handle.write(threads(1, "thread-a", false)));
        assert!(poll_once(write.as_mut(), noop).is_pending());
        drop(held);

        commit.await.unwrap();
        write.await.unwrap();
        assert_eq!(read_threads(&handle, 1)["isRead"], false);
    });
}
