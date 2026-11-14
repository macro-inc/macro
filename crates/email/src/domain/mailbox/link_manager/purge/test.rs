use super::*;
use fakes::*;

mod events;
mod fakes;

#[test]
fn default_pacing_sizes_batches_and_bounds_the_wal_rate() {
    let pacing = PurgePacing::default();
    assert_eq!(pacing.messages.get(), 500);
    assert_eq!(pacing.threads.get(), 2_000);
    assert_eq!(pacing.contacts.get(), 1_000);
    assert_eq!(pacing.pause, Duration::from_secs(2));
    assert_eq!(pacing.wal_budget.get(), 16 * 1024 * 1024);
    assert_eq!(pacing.max_pause, Duration::from_secs(30));
}

/// Two full message batches then an empty one, with no threads or contacts left after.
fn two_full_message_batches() -> (LinkPurgeService<Fake>, Fake) {
    let (service, fake) = service();
    {
        let mut state = fake.0.lock().unwrap();
        state
            .messages
            .push_back(vec![message(1, 10), message(2, 20)]);
        state
            .messages
            .push_back(vec![message(3, 30), message(4, 40)]);
    }
    (service, fake)
}

fn budgeted(pause: Duration, bytes_per_second: u64, max_pause: Duration) -> PurgePacing {
    PurgePacing {
        wal_budget: NonZeroU64::new(bytes_per_second).unwrap(),
        max_pause,
        ..pacing(pause)
    }
}

#[tokio::test(start_paused = true)]
async fn a_batch_over_the_wal_budget_waits_until_the_rate_is_back_within_it() {
    let (service, fake) = two_full_message_batches();
    // Each batch writes 10 MB at a 1 MB/s budget, so each waits 10 s from its start: the
    // 2 s pause, then the 8 s it was still early. The next read sees no new WAL.
    fake.0.lock().unwrap().wal = [0, 10_000_000, 10_000_000, 10_000_000].map(Some).into();
    let before = tokio::time::Instant::now();
    service
        .purge_link(
            LINK,
            budgeted(Duration::from_secs(2), 1_000_000, Duration::from_secs(60)),
        )
        .await
        .unwrap();
    // The second batch started at 10 MB and wrote nothing, so it waits only the pause.
    assert_eq!(
        tokio::time::Instant::now() - before,
        Duration::from_secs(12)
    );
}

#[tokio::test(start_paused = true)]
async fn the_wait_after_a_batch_stops_at_max_pause() {
    let (service, fake) = two_full_message_batches();
    // Other work keeps the server writing 100 MB between every read.
    fake.0.lock().unwrap().wal = (0..20).map(|n| Some(n * 100_000_000)).collect();
    let before = tokio::time::Instant::now();
    service
        .purge_link(
            LINK,
            budgeted(Duration::from_secs(1), 1_000_000, Duration::from_secs(5)),
        )
        .await
        .unwrap();
    assert_eq!(
        tokio::time::Instant::now() - before,
        Duration::from_secs(10)
    );
}

#[tokio::test(start_paused = true)]
async fn an_unreadable_wal_position_leaves_only_the_fixed_pause() {
    for wal in [vec![None], vec![Some(0), None]] {
        let (service, fake) = two_full_message_batches();
        fake.0.lock().unwrap().wal = wal.into();
        let before = tokio::time::Instant::now();
        let summary = service
            .purge_link(
                LINK,
                budgeted(Duration::from_secs(2), 1, Duration::from_secs(60)),
            )
            .await
            .unwrap();
        assert_eq!(summary.messages, 4);
        assert_eq!(
            tokio::time::Instant::now() - before,
            Duration::from_secs(2) + Duration::from_secs(2)
        );
    }
}

#[tokio::test]
async fn empty_message_batch_commits_without_child_deletes_or_a_cursor() {
    let (service, fake) = service();
    let batch = service
        .purge_message_batch(LINK, Uuid::nil(), limit(2))
        .await
        .unwrap();
    assert_eq!(
        (batch.messages, batch.threads, batch.next_cursor),
        (0, 0, None)
    );
    assert_eq!(
        fake.calls(),
        [
            Call::Begin(LINK),
            Call::Messages(Uuid::nil(), 2),
            Call::Commit
        ]
    );
}

#[tokio::test]
async fn full_batches_exclude_only_the_last_thread_and_deduplicate_in_input_order() {
    for full in [false, true] {
        let (service, fake) = service();
        fake.0.lock().unwrap().messages.push_back(vec![
            message(1, 10),
            message(2, 10),
            message(3, 20),
            message(4, 20),
        ]);
        let size = if full { 4 } else { 5 };
        let batch = service
            .purge_message_batch(LINK, Uuid::nil(), limit(size))
            .await
            .unwrap();
        let finished = if full {
            vec![id(10)]
        } else {
            vec![id(10), id(20)]
        };
        assert_eq!(batch.next_cursor, full.then_some(id(20)));
        assert_eq!((batch.messages, batch.threads), (4, finished.len() as u64));
        assert_eq!(fake.calls(), message_calls(size, &[1, 2, 3, 4], &finished));
    }
}

#[tokio::test]
async fn a_full_single_thread_batch_defers_thread_and_history_deletion() {
    let (service, fake) = service();
    fake.0
        .lock()
        .unwrap()
        .messages
        .push_back(vec![message(1, 10), message(2, 10)]);
    let batch = service
        .purge_message_batch(LINK, id(9), limit(2))
        .await
        .unwrap();
    assert_eq!(
        (batch.messages, batch.threads, batch.next_cursor),
        (2, 0, Some(id(10)))
    );
    let mut expected = message_calls(2, &[1, 2], &[]);
    expected[1] = Call::Messages(id(9), 2);
    assert_eq!(fake.calls(), expected);
}

#[tokio::test(start_paused = true)]
async fn all_phases_keep_cursors_order_counts_and_one_pause_per_full_batch() {
    let (service, fake) = service();
    {
        let mut state = fake.0.lock().unwrap();
        state
            .messages
            .push_back(vec![message(1, 10), message(2, 20)]);
        state.messages.push_back(vec![message(3, 20)]);
        state.threads.push_back(vec![id(30), id(40)]);
        state.threads.push_back(vec![]);
        state
            .contacts
            .push_back(vec![contact(50, "a"), contact(60, "b")]);
        state.contacts.push_back(vec![contact(70, "c")]);
    }
    let pause = Duration::from_millis(17);
    let before = tokio::time::Instant::now();
    let summary = service.purge_link(LINK, pacing(pause)).await.unwrap();
    assert_eq!(
        summary,
        PurgeSummary {
            messages: 3,
            threads: 4,
            contacts: 3,
            link_deleted: true
        }
    );
    assert_eq!(tokio::time::Instant::now() - before, pause * 3);
    let calls = fake.calls();
    assert_eq!(calls.first(), Some(&Call::Mark(LINK)));
    let phases: Vec<_> = calls
        .iter()
        .filter_map(|call| match call {
            Call::Messages(..) => Some("messages"),
            Call::Threads(..) => Some("threads"),
            Call::Contacts(..) => Some("contacts"),
            Call::Marked(..) => Some("link"),
            _ => None,
        })
        .collect();
    assert_eq!(
        phases,
        [
            "messages", "messages", "threads", "threads", "contacts", "contacts", "link"
        ]
    );
    assert_eq!(
        calls
            .iter()
            .filter(|call| matches!(call, Call::Messages(..)))
            .cloned()
            .collect::<Vec<_>>(),
        [Call::Messages(Uuid::nil(), 2), Call::Messages(id(20), 2)]
    );
    assert_eq!(
        calls
            .iter()
            .filter(|call| matches!(call, Call::Contacts(..)))
            .cloned()
            .collect::<Vec<_>>(),
        [
            Call::Contacts(String::new(), 2),
            Call::Contacts("b".into(), 2)
        ]
    );
    assert_eq!(
        calls
            .iter()
            .filter(|call| matches!(call, Call::Threads(..)))
            .cloned()
            .collect::<Vec<_>>(),
        [Call::Threads(2), Call::Threads(2)]
    );
    assert_eq!(
        calls
            .iter()
            .filter(|call| matches!(call, Call::Commit))
            .count(),
        7
    );
    assert_eq!(
        &calls[calls.len() - 3..],
        [Call::Begin(LINK), Call::Marked(LINK), Call::Commit]
    );
}

#[tokio::test(start_paused = true)]
async fn exact_multiples_include_a_final_empty_batch_and_count_only_actual_rows() {
    let (service, fake) = service();
    {
        let mut state = fake.0.lock().unwrap();
        state
            .messages
            .push_back(vec![message(1, 10), message(2, 10)]);
        state.threads.push_back(vec![id(10), id(20)]);
        state
            .contacts
            .push_back(vec![contact(30, "a"), contact(40, "b")]);
        state.row_counts.insert("messages", 1);
        state.row_counts.insert("thread_rows", 1);
        state.row_counts.insert("contact_rows", 1);
        state.row_counts.insert("marked", 0);
    }
    let before = tokio::time::Instant::now();
    let pause = Duration::from_millis(9);
    let summary = service.purge_link(LINK, pacing(pause)).await.unwrap();
    assert_eq!(
        summary,
        PurgeSummary {
            messages: 1,
            threads: 1,
            contacts: 2,
            link_deleted: false
        }
    );
    // Contact DELETE still runs for the empty scan; its returned count is the fact used.
    assert_eq!(tokio::time::Instant::now() - before, pause * 3);
    assert_eq!(
        fake.calls()
            .iter()
            .filter(|call| matches!(call, Call::Messages(..)))
            .count(),
        2
    );
    assert_eq!(
        fake.calls()
            .iter()
            .filter(|call| matches!(call, Call::Threads(..)))
            .count(),
        2
    );
    assert_eq!(
        fake.calls()
            .iter()
            .filter(|call| matches!(call, Call::Contacts(..)))
            .count(),
        2
    );
}

#[tokio::test]
async fn every_persistence_failure_stops_at_that_operation_and_preserves_the_error() {
    let (service, baseline) = seeded_service();
    service
        .purge_link(LINK, pacing(Duration::ZERO))
        .await
        .unwrap();
    let expected = baseline.calls();
    for (point, occurrence) in [
        ("mark", 1),
        ("begin", 1),
        ("begin", 2),
        ("begin", 3),
        ("begin", 4),
        ("select_messages", 1),
        ("labels", 1),
        ("recipients", 1),
        ("files", 1),
        ("attachments", 1),
        ("scheduled", 1),
        ("messages", 1),
        ("history", 1),
        ("history", 2),
        ("thread_rows", 1),
        ("thread_rows", 2),
        ("select_threads", 1),
        ("select_contacts", 1),
        ("contact_rows", 1),
        ("marked", 1),
        ("commit", 1),
        ("commit", 2),
        ("commit", 3),
        ("commit", 4),
    ] {
        let (service, fake) = seeded_service();
        fake.0.lock().unwrap().failure = Some((point, occurrence));
        let error = service
            .purge_link(LINK, pacing(Duration::ZERO))
            .await
            .unwrap_err();
        let error = error
            .downcast_ref::<Failure>()
            .expect("original error type");
        assert_eq!((error.0, error.1), (point, occurrence));
        let calls = fake.calls();
        let meaningful: Vec<_> = calls
            .iter()
            .filter(|call| !matches!(call, Call::Rollback))
            .cloned()
            .collect();
        assert_eq!(
            meaningful,
            expected[..meaningful.len()],
            "{point} #{occurrence}"
        );
        assert_eq!(fake.0.lock().unwrap().counts[point], occurrence);
    }
}

#[tokio::test]
async fn any_positive_link_delete_count_means_this_call_removed_the_link() {
    for (count, deleted) in [(0, false), (1, true), (2, true)] {
        let (service, fake) = service();
        fake.0.lock().unwrap().row_counts.insert("marked", count);
        assert_eq!(
            service
                .purge_link(LINK, pacing(Duration::ZERO))
                .await
                .unwrap()
                .link_deleted,
            deleted
        );
    }
}
