use super::*;
use email_api_client::domain::models::{EmailApiError, ThreadListPage};
use models_email::service::thread::{ListThreadsPayload, ThreadSummary};

fn listing(priority: bool) -> BackfillPubsubMessage {
    input(BackfillOperation::ListThreads(scope(ListThreadsPayload {
        next_page_token: None,
        priority_pass: priority,
        refresh_existing: true,
    })))
}
fn page(ids: &[&str], next: Option<&str>) -> ThreadListPage {
    ThreadListPage {
        threads: ids
            .iter()
            .map(|id| ThreadSummary {
                provider_id: id.to_string(),
            })
            .collect(),
        next_page_token: next.map(str::to_owned),
    }
}

#[tokio::test]
async fn normal_listing_counts_before_sending_and_carries_the_next_page_last() {
    let (svc, f) = setup();
    {
        let mut s = f.0.lock().unwrap();
        let job = s.job.as_mut().unwrap();
        job.total_threads = 700;
        job.threads_retrieved_count = 100;
        s.import
            .pages
            .push_back(Ok(page(&["a", "b"], Some("next"))));
    }
    assert!(matches!(
        svc.process(&listing(false)).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        [
            "job",
            "link",
            "list_threads",
            "retrieved",
            "enqueue",
            "enqueue",
            "enqueue"
        ]
    );
    let state = f.0.lock().unwrap();
    assert_eq!(state.import.retrieved, [2]);
    assert_eq!(state.import.list_calls, [(500, None, vec![])]);
    let ops = state
        .sent
        .iter()
        .map(|(m, _)| &m.backfill_operation)
        .collect::<Vec<_>>();
    assert!(
        matches!(ops[0],BackfillOperation::BackfillThread(p) if p.payload.thread_provider_id=="a" && p.payload.refresh_existing)
    );
    assert!(
        matches!(ops[1],BackfillOperation::BackfillThread(p) if p.payload.thread_provider_id=="b")
    );
    assert!(
        matches!(ops[2],BackfillOperation::ListThreads(p) if p.payload.next_page_token.as_deref()==Some("next") && !p.payload.priority_pass && p.payload.refresh_existing)
    );
}

#[tokio::test]
async fn normal_listing_uses_remaining_budget_and_preserves_zero_and_negative_casts() {
    for (total, retrieved, limit) in [(10, 3, 7), (0, 0, 0), (0, 1, u32::MAX)] {
        let (svc, f) = setup();
        {
            let mut s = f.0.lock().unwrap();
            let j = s.job.as_mut().unwrap();
            j.total_threads = total;
            j.threads_retrieved_count = retrieved;
        }
        assert!(matches!(
            svc.process(&listing(false)).await,
            BackfillDisposition::DoneDelete
        ));
        assert_eq!(f.0.lock().unwrap().import.list_calls[0].0, limit);
    }
}

#[tokio::test]
async fn empty_first_listing_completes_and_cleans_up_but_later_empty_pages_do_not() {
    for (retrieved, next, tail) in [
        (0, None, vec!["completed_job", "delete_listing"]),
        (1, None, vec![]),
        (0, Some("next"), vec!["enqueue"]),
    ] {
        let (svc, f) = setup();
        {
            let mut s = f.0.lock().unwrap();
            s.job.as_mut().unwrap().threads_retrieved_count = retrieved;
            s.import.pages.push_back(Ok(page(&[], next)));
        }
        assert!(matches!(
            svc.process(&listing(false)).await,
            BackfillDisposition::DoneDelete
        ));
        let mut expected = vec!["job", "link", "list_threads", "retrieved"];
        expected.extend(tail);
        assert_eq!(f.calls(), expected);
    }
}

#[tokio::test]
async fn listing_provider_count_send_and_completion_failures_stop_at_their_boundary() {
    for (fault, reason, retry) in [
        ("list_threads", FailureReason::GmailApiFailed, true),
        ("retrieved", FailureReason::DatabaseQueryFailed, true),
        ("enqueue", FailureReason::SqsEnqueueFailed, false),
    ] {
        let (svc, f) = setup();
        f.fail(fault);
        f.0.lock()
            .unwrap()
            .import
            .pages
            .push_back(Ok(page(&["a"], None)));
        failure(svc.process(&listing(false)).await, retry, reason);
        assert!(!f.calls().contains(&"completed_job"));
    }
    let (svc, f) = setup();
    f.0.lock()
        .unwrap()
        .job
        .as_mut()
        .unwrap()
        .threads_retrieved_count = 0;
    f.fail("completed_job");
    failure(
        svc.process(&listing(false)).await,
        true,
        FailureReason::DatabaseQueryFailed,
    );
    assert!(!f.calls().contains(&"delete_listing"));
    let (svc, f) = setup();
    f.0.lock()
        .unwrap()
        .job
        .as_mut()
        .unwrap()
        .threads_retrieved_count = 0;
    f.fail("delete_listing");
    assert!(matches!(
        svc.process(&listing(false)).await,
        BackfillDisposition::DoneDelete
    ));
    assert!(f.calls().contains(&"delete_listing"));
}

#[tokio::test]
async fn next_page_send_failure_keeps_already_enqueued_threads() {
    let (svc, f) = setup();
    {
        let mut s = f.0.lock().unwrap();
        s.import.pages.push_back(Ok(page(&["a"], Some("next"))));
        s.import.fail_at.insert("enqueue", 2);
    }
    failure(
        svc.process(&listing(false)).await,
        false,
        FailureReason::SqsEnqueueFailed,
    );
    assert_eq!(f.0.lock().unwrap().sent.len(), 1);
}

#[tokio::test]
async fn priority_bumps_total_before_sends_and_ignores_provider_pagination() {
    let (mut svc, f) = setup();
    svc.contacts_sync = false;
    {
        let mut s = f.0.lock().unwrap();
        s.job.as_mut().unwrap().total_threads = 300;
        s.import
            .pages
            .push_back(Ok(page(&["a", "b"], Some("ignored"))));
    }
    assert!(matches!(
        svc.process(&listing(true)).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        [
            "job",
            "link",
            "list_threads",
            "add_total",
            "enqueue",
            "enqueue",
            "enqueue"
        ]
    );
    let s = f.0.lock().unwrap();
    assert_eq!(s.import.totals, [2]);
    assert!(s.import.retrieved.is_empty());
    assert_eq!(
        s.import.list_calls,
        [(200, None, vec!["CATEGORY_PERSONAL".into()])]
    );
    assert!(
        matches!(&s.sent[0].0.backfill_operation,BackfillOperation::BackfillThread(p) if !p.payload.refresh_existing)
    );
    assert!(
        matches!(&s.sent[2].0.backfill_operation,BackfillOperation::ListThreads(p) if p.payload.next_page_token.is_none() && !p.payload.priority_pass && p.payload.refresh_existing)
    );
}

#[tokio::test]
async fn priority_nonpositive_budget_skips_provider_but_always_hands_off() {
    for total in [0, -1] {
        let (mut svc, f) = setup();
        svc.contacts_sync = false;
        f.0.lock().unwrap().job.as_mut().unwrap().total_threads = total;
        assert!(matches!(
            svc.process(&listing(true)).await,
            BackfillDisposition::DoneDelete
        ));
        assert_eq!(f.calls(), ["job", "link", "enqueue"]);
    }
    let (mut svc, f) = setup();
    svc.contacts_sync = false;
    assert!(matches!(
        svc.process(&listing(true)).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(f.calls(), ["job", "link", "list_threads", "enqueue"]);
}

#[tokio::test]
async fn priority_provider_and_budget_failure_are_retryable_but_send_failure_is_terminal() {
    for (fault, reason, retry) in [
        ("list_threads", FailureReason::GmailApiFailed, true),
        ("add_total", FailureReason::RedisQueryFailed, true),
        ("enqueue", FailureReason::SqsEnqueueFailed, false),
    ] {
        let (svc, f) = setup();
        f.fail(fault);
        f.0.lock()
            .unwrap()
            .import
            .pages
            .push_back(Ok(page(&["a"], None)));
        failure(svc.process(&listing(true)).await, retry, reason);
        assert!(!f.calls().contains(&"list_sent"));
    }
}

#[tokio::test]
async fn priority_seeds_sent_messages_before_normal_handoff_and_preserves_their_order() {
    let (svc, f) = setup();
    f.0.lock().unwrap().import.sent_ids = vec!["m1".into(), "m2".into()];
    assert!(matches!(
        svc.process(&listing(true)).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        [
            "job",
            "link",
            "list_threads",
            "list_sent",
            "enqueue",
            "enqueue",
            "enqueue"
        ]
    );
    let s = f.0.lock().unwrap();
    assert!(
        matches!(&s.sent[0].0.backfill_operation,BackfillOperation::SeedSentContact(p) if p.payload.message_provider_id=="m1")
    );
    assert!(
        matches!(&s.sent[1].0.backfill_operation,BackfillOperation::SeedSentContact(p) if p.payload.message_provider_id=="m2")
    );
    assert!(matches!(
        &s.sent[2].0.backfill_operation,
        BackfillOperation::ListThreads(_)
    ));
}

#[tokio::test]
async fn failed_contact_seed_listing_or_send_does_not_retry_the_priority_budget() {
    let (svc, f) = setup();
    f.fail("list_sent");
    assert!(matches!(
        svc.process(&listing(true)).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(f.calls().last(), Some(&"enqueue"));
    let (svc, f) = setup();
    {
        let mut s = f.0.lock().unwrap();
        s.import.sent_ids = vec!["m1".into(), "m2".into()];
        s.import.fail_at.insert("enqueue", 1);
    }
    assert!(matches!(
        svc.process(&listing(true)).await,
        BackfillDisposition::DoneDelete
    ));
    assert_eq!(
        f.calls(),
        [
            "job",
            "link",
            "list_threads",
            "list_sent",
            "enqueue",
            "enqueue"
        ]
    );
    assert_eq!(f.0.lock().unwrap().sent.len(), 1);
}

#[tokio::test]
async fn priority_normal_handoff_failure_is_terminal_even_with_no_threads() {
    let (mut svc, f) = setup();
    svc.contacts_sync = false;
    f.fail("enqueue");
    failure(
        svc.process(&listing(true)).await,
        false,
        FailureReason::SqsEnqueueFailed,
    );
}

#[tokio::test]
async fn priority_provider_rate_limit_keeps_the_original_cooldown() {
    let (svc, f) = setup();
    f.0.lock()
        .unwrap()
        .import
        .pages
        .push_back(Err(EmailApiError::RateLimited {
            retry_after: Some(Duration::from_secs(77)),
            origin: email_api_client::domain::models::RateLimitOrigin::Local,
        }));
    let BackfillDisposition::Defer { retry_after, .. } = svc.process(&listing(true)).await else {
        panic!("deferred")
    };
    assert_eq!(retry_after, Some(Duration::from_secs(77)));
    assert!(!f.calls().contains(&"add_total"));
}
