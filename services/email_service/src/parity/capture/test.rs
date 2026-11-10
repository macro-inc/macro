use super::*;

#[tokio::test]
async fn only_exact_timing_events_are_excluded_and_counted() {
    if !crate::parity::process_per_test() {
        return;
    }
    let _guard = exclusive_lab().await;
    let (recording, span) = start();
    tracing::dispatcher::with_default(&dispatch(), || {
        let _entered = span.enter();
        tracing::warn!(target: "macro_tower_layers", "slow http request");
        tracing::warn!(target: "macro_tower_layers", "tokio runtime starvation detected");
        tracing::warn!(target: "macro_tower_layers", "another warning");
        tracing::warn!(target: "another_target", "slow http request");
    });
    stop();
    let (_, logs, _, sidecar, _) = recording.lock().expect("recording mutex").sections();
    let logs = logs.as_array().expect("log array");
    assert_eq!(logs.len(), 2);
    assert_eq!(logs[0]["message"], "another warning");
    assert_eq!(logs[1]["message"], "slow http request");
    for event in sidecar["excluded_timing_events"]
        .as_array()
        .expect("counts")
    {
        assert_eq!(event["count"], 1);
    }
}

#[tokio::test]
async fn dropped_spans_keep_exported_children_and_log_ancestry() {
    if !crate::parity::process_per_test() {
        return;
    }
    let _guard = exclusive_lab().await;
    let (recording, root) = start();
    tracing::dispatcher::with_default(&dispatch(), || {
        let _root = root.enter();
        let parent = tracing::info_span!("kept parent");
        let _parent = parent.enter();
        let hidden = tracing::debug_span!("hidden parent");
        let _hidden = hidden.enter();
        let child = tracing::warn_span!("kept child");
        let _child = child.enter();
        tracing::warn!("visible event");
    });
    stop();
    let (spans, logs, _, _, full) = recording.lock().expect("recording mutex").sections();
    assert_eq!(spans.as_array().expect("spans").len(), 2);
    assert_eq!(spans[1]["parent"], 0);
    assert_eq!(logs[0]["span"], json!(["kept parent", "kept child"]));
    assert_eq!(full.as_array().expect("full spans").len(), 3);
}

#[tokio::test]
async fn concurrent_test_runtimes_do_not_enter_the_active_step() {
    if !crate::parity::process_per_test() {
        return;
    }
    let _guard = exclusive_lab().await;
    let (recording, _) = start();
    std::thread::spawn(|| {
        tokio::runtime::Builder::new_current_thread()
            .build()
            .expect("unrelated runtime")
            .block_on(async {
                let _span = tracing::info_span!("unrelated test").entered();
            });
    })
    .join()
    .expect("unrelated test thread");
    stop();
    assert!(recording.lock().expect("recording").spans.is_empty());
}

#[tokio::test]
async fn background_drain_waits_for_the_last_request_span_owner() {
    if !crate::parity::process_per_test() {
        return;
    }
    let _guard = exclusive_lab().await;
    let (recording, root) = start();
    let span = tracing::dispatcher::with_default(&dispatch(), || {
        let _entered = root.enter();
        tracing::info_span!("http.request")
    });
    let (release, released) = tokio::sync::oneshot::channel();
    let task = tokio::spawn(async move {
        released.await.expect("release background work");
        drop(span);
    });
    assert_eq!(recording.lock().expect("recording").open_requests, 1);
    release.send(()).expect("background receiver");
    drain(&recording).await;
    task.await.expect("background task");
    stop();
    assert_eq!(recording.lock().expect("recording").open_requests, 0);
}

#[tokio::test]
async fn debug_events_are_coverage_only() {
    if !crate::parity::process_per_test() {
        return;
    }
    let _guard = exclusive_lab().await;
    let (recording, root) = start();
    tracing::dispatcher::with_default(&dispatch(), || {
        let _root = root.enter();
        tracing::debug!(target: "email_service::pubsub::inbox_sync::coverage", "debug branch");
        tracing::debug!(target: "third_party_debug", "elapsed 123 microseconds");
    });
    stop();
    let (_, logs, _, sidecar, _) = recording.lock().expect("recording").sections();
    assert!(logs.as_array().expect("logs").is_empty());
    assert!(
        !sidecar["callsites"]
            .as_array()
            .expect("callsites")
            .iter()
            .any(|entry| entry[1] == "third_party_debug")
    );
    assert!(
        sidecar["callsites"]
            .as_array()
            .expect("callsites")
            .contains(&json!([
                "event",
                "email_service::pubsub::inbox_sync::coverage",
                "debug branch"
            ]))
    );
}
