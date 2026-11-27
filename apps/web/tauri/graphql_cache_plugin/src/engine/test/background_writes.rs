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

/// A background write that holds what the commit stored puts nothing older
/// back, so it lands.
#[test]
fn a_background_write_holding_what_a_commit_stored_lands() {
    block_on(async {
        let handle = spawn_handle();
        handle.write(threads(1, "thread-a", false)).await.unwrap();
        let claim = claimed_mark_seen(&handle).await;

        let noop = std::task::Waker::noop();
        let held = handle.inner.write().await;
        let mut commit = Box::pin(commit_mark_seen(&handle, claim));
        assert!(poll_once(commit.as_mut(), noop).is_pending());
        let mut fresh = Box::pin(handle.write_in_background(threads(1, "thread-a", true)));
        assert!(poll_once(fresh.as_mut(), noop).is_pending());
        drop(held);

        commit.await.unwrap();
        fresh.await.unwrap();
        assert_eq!(read_threads(&handle, 1)["isRead"], true);
    });
}

/// A command that queues while a background write waits goes first. The
/// background write then comes after the commit, so it is refused when it
/// would put back what the commit stored: the order it lands in no longer
/// decides what stays.
#[test]
fn a_commit_that_queues_behind_a_background_write_goes_first() {
    block_on(async {
        let handle = spawn_handle();
        handle.write(threads(1, "thread-a", false)).await.unwrap();
        let claim = claimed_mark_seen(&handle).await;

        let noop = std::task::Waker::noop();
        let held = handle.inner.write().await;
        let mut stale = Box::pin(handle.write_in_background(threads(1, "thread-a", false)));
        assert!(poll_once(stale.as_mut(), noop).is_pending());
        let mut commit = Box::pin(commit_mark_seen(&handle, claim));
        assert!(poll_once(commit.as_mut(), noop).is_pending());
        drop(held);

        assert!(
            poll_once(stale.as_mut(), noop).is_pending(),
            "the commit goes first"
        );
        commit.await.unwrap();
        assert_eq!(stale.await.unwrap_err(), commits::SUPERSEDED);
        assert_eq!(read_threads(&handle, 1)["isRead"], true);
    });
}

/// Background writes keep their order among themselves: the later one lands
/// last.
#[test]
fn background_writes_land_in_arrival_order() {
    for (first, second) in [(false, true), (true, false)] {
        block_on(async {
            let handle = spawn_handle();
            let noop = std::task::Waker::noop();
            let held = handle.inner.write().await;
            let mut earlier = Box::pin(handle.write_in_background(threads(1, "thread-a", first)));
            assert!(poll_once(earlier.as_mut(), noop).is_pending());
            let mut later = Box::pin(handle.write_in_background(threads(1, "thread-a", second)));
            assert!(poll_once(later.as_mut(), noop).is_pending());
            drop(held);
            assert!(poll_once(later.as_mut(), noop).is_pending());
            earlier.await.unwrap();
            later.await.unwrap();
            assert_eq!(read_threads(&handle, 1)["isRead"], second);
        });
    }
}

/// A command that queues while a background write holds the engine runs at
/// the write's next step. The write then starts its steps again from what
/// the command stored, and lands unless the command stored a different value
/// for one of its fields.
#[test]
fn a_background_write_steps_aside_for_a_command_and_starts_again() {
    for (command, landed) in [
        (threads(1, "thread-a", true), true),
        (threads(2, "thread-b", false), false),
    ] {
        block_on(async {
            let handle = spawn_handle();
            let noop = std::task::Waker::noop();
            super::test_hooks::PAUSE_STEPS.with(|pauses| pauses.set(1));
            super::test_hooks::LAST_STEPS.with(|last| last.set((0, 0)));
            let mut background = Box::pin(handle.write_in_background(threads(2, "thread-b", true)));
            assert!(
                poll_once(background.as_mut(), noop).is_pending(),
                "paused holding the engine"
            );
            let mut command = Box::pin(handle.write(command));
            assert!(poll_once(command.as_mut(), noop).is_pending());
            assert!(
                poll_once(background.as_mut(), noop).is_pending(),
                "stepped aside"
            );
            command.await.unwrap();
            let landed_or_refused = background.await;
            assert_eq!(
                super::test_hooks::LAST_STEPS.with(std::cell::Cell::get),
                (1, 1)
            );
            if landed {
                landed_or_refused.unwrap();
                assert_eq!(read_threads(&handle, 1)["isRead"], true);
                assert_eq!(read_threads(&handle, 2)["isRead"], true);
            } else {
                assert_eq!(landed_or_refused.unwrap_err(), commits::SUPERSEDED);
                assert_eq!(read_threads(&handle, 2)["isRead"], false);
            }
        });
    }
}

/// An operation torn down while a background write that registers it steps
/// aside stays torn down: the write lands without registering it.
#[test]
fn a_teardown_during_a_background_write_keeps_the_operation_torn_down() {
    for tear_down in [false, true] {
        block_on(async {
            let handle = spawn_handle();
            let noop = std::task::Waker::noop();
            super::test_hooks::PAUSE_STEPS.with(|pauses| pauses.set(1));
            let mut registering = threads(1, "thread-a", false);
            registering.registration = Some(WriteRegistration {
                op_id: "client:1".into(),
                entity_resolvers: Vec::new(),
            });
            let mut background = Box::pin(handle.write_in_background(registering));
            assert!(poll_once(background.as_mut(), noop).is_pending());
            if tear_down {
                let mut teardown = Box::pin(handle.teardown("client:1".into()));
                assert!(poll_once(teardown.as_mut(), noop).is_pending());
                assert!(poll_once(background.as_mut(), noop).is_pending());
                teardown.await.unwrap();
            }
            background.await.unwrap();
            let mut change = threads(1, "thread-a", true);
            change.origin_op_id = Some("client:2".into());
            let affected = handle.write(change).await.unwrap().affected_ops;
            let expected: &[&str] = if tear_down { &[] } else { &["client:1"] };
            assert_eq!(affected, expected);
        });
    }
}

/// A hydrate gives the engine to a command that queued while it ran, and
/// fails as superseded since the command writes: it may hold older data.
#[test]
fn a_hydrate_gives_way_to_a_command_that_queued_while_it_ran() {
    block_on(async {
        let handle = spawn_handle();
        let noop = std::task::Waker::noop();
        super::test_hooks::PAUSE_STEPS.with(|pauses| pauses.set(1));
        let page = threads(2, "thread-b", true);
        let mut hydrate = Box::pin(handle.hydrate_query(
            page.query,
            page.operation_name,
            page.variables,
            page.data,
            None,
            None,
        ));
        assert!(
            poll_once(hydrate.as_mut(), noop).is_pending(),
            "paused holding the engine"
        );
        let mut command = Box::pin(handle.write(threads(1, "thread-a", true)));
        assert!(poll_once(command.as_mut(), noop).is_pending());
        // The command queued to write, so the hydrate gives way and fails.
        let std::task::Poll::Ready(Err(error)) = poll_once(hydrate.as_mut(), noop) else {
            panic!("the hydrate gave way to the command")
        };
        assert!(error.contains("superseded"), "{error}");
        command.await.unwrap();
        assert_eq!(read_threads(&handle, 1)["isRead"], true);
    });
}

/// A command that installs a compatible schema while a hydrate gives way does
/// not write, so the hydrate goes on, normalizing its response again under
/// the new schema. The first hydrate for an account binds it, so it is not
/// staged and writes whole.
#[test]
fn a_hydrate_that_gave_way_to_a_schema_install_still_lands() {
    block_on(async {
        let handle = spawn_handle();
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("schema.json");
        let noop = std::task::Waker::noop();
        super::test_hooks::PAUSE_STEPS.with(|pauses| pauses.set(1));
        let page = threads(1, "thread-a", true);
        let mut hydrate = Box::pin(handle.hydrate_query(
            page.query,
            page.operation_name,
            page.variables,
            page.data,
            Some("user-1".into()),
            None,
        ));
        assert!(
            poll_once(hydrate.as_mut(), noop).is_pending(),
            "paused holding the engine"
        );
        let schema = cache_core::meta::bundled_schema();
        let mut install = Box::pin(handle.install_schema(&schema, &path));
        assert!(poll_once(install.as_mut(), noop).is_pending());
        assert!(
            poll_once(hydrate.as_mut(), noop).is_pending(),
            "the hydrate gave way to the install"
        );
        install.await.unwrap();
        let result = hydrate
            .await
            .expect("a schema install supersedes no hydrate");
        assert!(!result.write_result.changed.is_empty(), "the hydrate wrote");
    });
}

/// An older bundle sends no `background`: its query writes are commands, so
/// one keeps its place ahead of a commit that queues after it and lands
/// first, as before.
#[test]
fn a_write_without_the_background_flag_keeps_its_place() {
    block_on(async {
        let handle = spawn_handle();
        handle.write(threads(1, "thread-a", false)).await.unwrap();
        let claim = claimed_mark_seen(&handle).await;

        let noop = std::task::Waker::noop();
        let held = handle.inner.write().await;
        let mut write = Box::pin(handle.write(threads(1, "thread-a", false)));
        assert!(poll_once(write.as_mut(), noop).is_pending());
        let mut commit = Box::pin(commit_mark_seen(&handle, claim));
        assert!(poll_once(commit.as_mut(), noop).is_pending());
        drop(held);

        assert!(
            poll_once(commit.as_mut(), noop).is_pending(),
            "the write goes first"
        );
        write.await.unwrap();
        commit.await.unwrap();
        assert_eq!(read_threads(&handle, 1)["isRead"], true);
    });
}
