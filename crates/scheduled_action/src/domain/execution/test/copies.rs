//! A copy's runs, which read its steps from its parent's definition.

use super::*;

#[tokio::test]
async fn a_copy_runs_its_definition_as_its_parent_holds_it_when_the_copy_runs() {
    let mut parent = action();
    parent.task = json!({
        "steps": [{ "type": "agent", "model": "test", "instructions": "List what is due" }],
        "sub_routines": [{
            "name": "remind",
            "title": "Remind me",
            "steps": [{ "type": "agent", "model": "test", "instructions": "Remind me" }],
        }],
    });
    let mut copy = action();
    copy.task = json!({ "sub_routine": "remind" });
    copy.sub_routine = Some(crate::domain::models::SubRoutine {
        parent_id: parent.id.unwrap(),
        created_by_run_id: generate_uuid_v7(),
        key: None,
        paused_by_parent: false,
    });
    let repo = Repo::default();
    *repo.parent.lock().unwrap() = Some(parent.clone());
    let executor = executor(repo, Runner::default());
    executor.runner.finish.cancel();

    executor.execute_action(copy.clone()).await.unwrap();
    while executor.repo.releases.load(Ordering::SeqCst) < 1 {
        tokio::task::yield_now().await;
    }
    // The parent's definition is edited; the copy, unchanged, runs again.
    parent.task["sub_routines"][0]["steps"][0]["instructions"] = json!("Remind me, with the date");
    *executor.repo.parent.lock().unwrap() = Some(parent);
    executor.execute_action(copy).await.unwrap();
    drain(&executor).await;

    let instructions: Vec<_> = executor
        .runner
        .programs
        .lock()
        .unwrap()
        .iter()
        .map(|steps| steps[0]["instructions"].clone())
        .collect();
    assert_eq!(
        instructions,
        [json!("Remind me"), json!("Remind me, with the date")]
    );
    let records = executor.repo.records.lock().unwrap();
    assert_eq!(records.len(), 2);
    assert!(records.iter().all(|record| record.is_success));
}

#[tokio::test]
async fn a_copy_whose_parent_is_gone_fails_without_running() {
    let mut copy = action();
    copy.task = json!({ "sub_routine": "remind" });
    copy.sub_routine = Some(crate::domain::models::SubRoutine {
        parent_id: generate_uuid_v7(),
        created_by_run_id: generate_uuid_v7(),
        key: None,
        paused_by_parent: false,
    });
    let executor = executor(Repo::default(), Runner::default());

    assert!(executor.execute_action(copy).await.is_err());
    drain(&executor).await;
    assert_eq!(executor.runner.calls.load(Ordering::SeqCst), 0);
    assert_eq!(executor.repo.releases.load(Ordering::SeqCst), 1);
}

/// The outcomes a span recorded while `body` ran with it.
fn outcomes_of(body: impl FnOnce(tracing::Span)) -> Vec<String> {
    let (spans, guard) = Spans::capture();
    body(tracing::info_span!("read", outcome = tracing::field::Empty));
    drop(guard);
    spans.outcomes("read")
}

#[test]
fn a_dropped_read_ends_its_span_interrupted_once() {
    assert_eq!(
        outcomes_of(|span| drop(OutcomeOnce::new(span, "interrupted"))),
        ["interrupted"]
    );
    assert_eq!(
        outcomes_of(|span| OutcomeOnce::new(span, "interrupted").record("resolved")),
        ["resolved"]
    );
}

/// A copy's run stopped while it reads its parent drops the read, which
/// ends the read's span `interrupted`; nothing runs.
#[tokio::test]
async fn a_copy_stopped_while_reading_its_parent_records_the_read_interrupted() {
    let mut parent = action();
    parent.task = json!({
        "steps": [{ "type": "agent", "model": "test", "instructions": "List what is due" }],
        "sub_routines": [{
            "name": "remind",
            "title": "Remind me",
            "steps": [{ "type": "agent", "model": "test", "instructions": "Remind me" }],
        }],
    });
    let mut copy = action();
    copy.task = json!({ "sub_routine": "remind" });
    copy.sub_routine = Some(crate::domain::models::SubRoutine {
        parent_id: parent.id.unwrap(),
        created_by_run_id: generate_uuid_v7(),
        key: None,
        paused_by_parent: false,
    });
    let repo = Repo::default();
    *repo.parent.lock().unwrap() = Some(parent);
    repo.stall_parent_read.store(true, Ordering::SeqCst);
    let executor = executor(repo, Runner::default());
    let (spans, _spans) = Spans::capture();

    let stop = async {
        // A copy that never reads its parent fails here rather than hanging.
        tokio::time::timeout(
            std::time::Duration::from_secs(10),
            executor.repo.parent_read_stalled.notified(),
        )
        .await
        .expect("the copy never read its parent");
        executor.cancellation.cancel();
    };
    let _ = tokio::join!(executor.execute_action(copy), stop);
    drain(&executor).await;

    // The stalled read ran inside the read's span (the run reads the
    // routine again afterwards, under its own span), and that span is the
    // run's.
    assert_eq!(
        spans.parents("test.parent_read")[0],
        Some("routine.copy.read_definition")
    );
    assert_eq!(
        spans.parents("routine.copy.read_definition"),
        [Some("routine.execute")]
    );
    assert_eq!(
        spans.outcomes("routine.copy.read_definition"),
        ["interrupted"]
    );
    assert_eq!(spans.outcomes("routine.execute"), ["interrupted"]);
    assert_eq!(executor.runner.calls.load(Ordering::SeqCst), 0);
}
