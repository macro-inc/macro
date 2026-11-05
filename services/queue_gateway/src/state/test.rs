use super::*;

const T0: u64 = 1_000_000;

fn envelope(id: &str) -> Envelope {
    Envelope {
        message_id: id.to_owned(),
        body: format!("body-{id}"),
        attributes: None,
        group: None,
        dedup: None,
        traceparent: None,
        sent_ms: T0,
        not_before_ms: 0,
    }
}

fn grouped(id: &str, group: &str) -> Envelope {
    Envelope {
        group: Some(group.to_owned()),
        ..envelope(id)
    }
}

fn at(offset: i64) -> Position {
    Position {
        partition: 0,
        offset,
    }
}

fn queue() -> QueueState {
    QueueState::new("work".into(), Settings::default())
}

fn ids(deliveries: &[Delivery]) -> Vec<String> {
    deliveries
        .iter()
        .map(|d| d.envelope.message_id.clone())
        .collect()
}

#[test]
fn a_received_message_is_invisible_until_its_timeout_then_redelivered() {
    let mut q = queue();
    q.ingest(at(0), envelope("a"));

    let first = q.receive(10, 30, T0);
    assert_eq!(ids(&first), ["a"]);
    assert_eq!(first[0].receive_count, 1);
    assert!(q.receive(10, 30, T0 + 1).is_empty());

    assert!(q.expire(T0 + 29_000).is_empty());
    assert!(q.receive(10, 30, T0 + 29_000).is_empty());

    q.expire(T0 + 30_000);
    let again = q.receive(10, 30, T0 + 30_000);
    assert_eq!(ids(&again), ["a"]);
    assert_eq!(again[0].receive_count, 2);
    assert_eq!(again[0].first_received_ms, T0);
}

#[test]
fn offsets_commit_only_when_everything_before_them_is_done() {
    let mut q = queue();
    for offset in 0..3 {
        q.ingest(at(offset), envelope(&offset.to_string()));
    }
    let d = q.receive(3, 30, T0);

    // Out of order: offset 1 is done, but 0 is not, so nothing can commit.
    assert_eq!(q.delete(&d[1].receipt_handle), None);
    assert_eq!(
        q.delete(&d[0].receipt_handle),
        Some(Commit {
            partition: 0,
            next_offset: 2
        })
    );
    assert_eq!(
        q.delete(&d[2].receipt_handle),
        Some(Commit {
            partition: 0,
            next_offset: 3
        })
    );
}

#[test]
fn a_stale_receipt_handle_does_not_delete_the_redelivered_message() {
    let mut q = queue();
    q.ingest(at(0), envelope("a"));
    let first = q.receive(1, 30, T0);
    q.expire(T0 + 30_000);
    let second = q.receive(1, 30, T0 + 30_000);

    assert_eq!(q.delete(&first[0].receipt_handle), None);
    assert_eq!(q.depth(T0 + 30_000).in_flight, 1);
    assert!(q.delete(&second[0].receipt_handle).is_some());
    assert_eq!(q.depth(T0 + 30_000).in_flight, 0);
}

#[test]
fn changing_visibility_extends_or_ends_the_timeout() {
    let mut q = queue();
    q.ingest(at(0), envelope("a"));
    let handle = q.receive(1, 30, T0)[0].receipt_handle.clone();

    assert!(q.change_visibility(&handle, 120, T0));
    q.expire(T0 + 60_000);
    assert!(q.receive(1, 30, T0 + 60_000).is_empty());

    assert!(q.change_visibility(&handle, 0, T0 + 60_000));
    q.expire(T0 + 60_000);
    assert_eq!(ids(&q.receive(1, 30, T0 + 60_000)), ["a"]);
    assert!(!q.change_visibility("gone", 10, T0));
}

#[test]
fn a_message_out_of_receives_is_moved_to_its_dead_letter_queue() {
    let settings = Settings {
        redrive: Some(Redrive {
            dead_letter_queue: "work-dlq".into(),
            max_receive_count: 2,
        }),
        ..Settings::default()
    };
    let mut q = QueueState::new("work".into(), settings);
    q.ingest(at(0), envelope("a"));

    q.receive(1, 30, T0);
    assert!(q.expire(T0 + 30_000).is_empty());
    q.receive(1, 30, T0 + 30_000);
    let dead = q.expire(T0 + 60_000);
    assert_eq!(dead.len(), 1);
    assert_eq!(dead[0].queue, "work-dlq");
    assert!(q.receive(1, 30, T0 + 60_000).is_empty());

    // The offset stays uncommitted until the dead-letter queue has the message.
    assert_eq!(
        q.dead_lettered(dead[0].position),
        Some(Commit {
            partition: 0,
            next_offset: 1
        })
    );
}

#[test]
fn a_fifo_group_delivers_one_at_a_time_in_order() {
    let mut q = QueueState::new("work.fifo".into(), Settings::default());
    q.ingest(at(0), grouped("a1", "a"));
    q.ingest(at(1), grouped("a2", "a"));
    q.ingest(at(2), grouped("b1", "b"));

    let first = q.receive(10, 30, T0);
    assert_eq!(ids(&first), ["a1", "b1"]);
    assert!(q.receive(10, 30, T0).is_empty());

    q.delete(&first[0].receipt_handle);
    assert_eq!(ids(&q.receive(10, 30, T0)), ["a2"]);
}

#[test]
fn a_fifo_group_keeps_order_across_redelivery() {
    let mut q = QueueState::new("work.fifo".into(), Settings::default());
    q.ingest(at(0), grouped("a1", "a"));
    q.ingest(at(1), grouped("a2", "a"));

    q.receive(10, 30, T0);
    q.expire(T0 + 30_000);
    assert_eq!(ids(&q.receive(10, 30, T0 + 30_000)), ["a1"]);
}

#[test]
fn a_standard_queue_ignores_groups() {
    let mut q = queue();
    q.ingest(at(0), grouped("a1", "a"));
    q.ingest(at(1), grouped("a2", "a"));
    assert_eq!(ids(&q.receive(10, 30, T0)), ["a1", "a2"]);
}

#[test]
fn a_delayed_message_waits_for_its_due_time() {
    let mut q = queue();
    q.ingest(
        at(0),
        Envelope {
            not_before_ms: T0 + 5_000,
            ..envelope("later")
        },
    );
    q.ingest(at(1), envelope("now"));

    assert_eq!(ids(&q.receive(10, 30, T0)), ["now"]);
    assert_eq!(q.depth(T0).delayed, 1);
    assert_eq!(ids(&q.receive(10, 30, T0 + 5_000)), ["later"]);
}

#[test]
fn a_deduplication_id_suppresses_repeats_within_its_window() {
    let mut q = QueueState::new("work.fifo".into(), Settings::default());
    assert!(q.first_send("x", T0));
    assert!(!q.first_send("x", T0 + 1_000));
    assert!(q.first_send("x", T0 + DEDUP_WINDOW_MS));
}

#[test]
fn purging_discards_ready_and_in_flight_messages_and_commits_past_them() {
    let mut q = queue();
    q.ingest(at(0), envelope("a"));
    q.ingest(at(1), envelope("b"));
    let held = q.receive(1, 30, T0);

    let commits = q.purge();
    assert_eq!(commits.iter().map(|c| c.next_offset).max(), Some(2));
    assert_eq!(q.depth(T0), Depth::default());

    // Nothing comes back, and the old handle is stale.
    q.expire(T0 + 60_000);
    assert!(q.receive(10, 30, T0 + 60_000).is_empty());
    assert_eq!(q.delete(&held[0].receipt_handle), None);
}
