use super::*;

const TOPIC: &str = "macro.email";

fn at(partition: i32, offset: i64) -> RecordPosition {
    RecordPosition {
        topic: TOPIC,
        partition,
        offset,
    }
}

fn any_partition(_: &str, _: i32) -> bool {
    true
}

#[test]
fn a_stop_rewinds_to_the_first_queued_record_even_after_later_ones_finish() {
    let mut ledger = OffsetLedger::default();
    for offset in 10..=12 {
        ledger.received(at(0, offset));
    }
    ledger.started(at(0, 12));
    ledger.done(at(0, 12));
    ledger.started(at(0, 11));
    ledger.done(at(0, 11));

    assert_eq!(ledger.rewind_points(any_partition), [at(0, 10)]);

    ledger.started(at(0, 10));
    ledger.done(at(0, 10));
    assert!(ledger.rewind_points(any_partition).is_empty());
}

#[test]
fn a_record_a_worker_started_is_not_rewound_to() {
    let mut ledger = OffsetLedger::default();
    for offset in [20, 21, 22] {
        ledger.received(at(0, offset));
    }
    ledger.report(WorkerReport::Started(at(0, 20)));

    assert_eq!(
        ledger.rewind_points(any_partition),
        [at(0, 21)],
        "offset 20 hung or died with its worker; 21 and 22 were still queued"
    );
    assert_eq!(ledger.started_unfinished(), [at(0, 20)]);
    assert_eq!(ledger.queued(), [at(0, 21), at(0, 22)]);
}

#[test]
fn only_partitions_still_assigned_are_rewound() {
    let mut ledger = OffsetLedger::default();
    ledger.received(at(0, 5));
    ledger.received(at(1, 7));

    assert_eq!(
        ledger.rewind_points(|topic, partition| topic == TOPIC && partition == 1),
        [at(1, 7)]
    );
}

#[test]
fn a_record_delivered_twice_stays_open_until_both_deliveries_finish() {
    let mut ledger = OffsetLedger::default();
    ledger.received(at(0, 3));
    ledger.received(at(0, 3));
    ledger.started(at(0, 3));

    assert_eq!(
        ledger.rewind_points(any_partition),
        [at(0, 3)],
        "the second delivery is still queued"
    );

    ledger.done(at(0, 3));
    ledger.started(at(0, 3));
    ledger.done(at(0, 3));
    assert!(ledger.queued().is_empty());
    assert!(ledger.started_unfinished().is_empty());
}

#[test]
fn reports_for_unknown_records_change_nothing() {
    let mut ledger = OffsetLedger::default();
    ledger.done(at(0, 1));
    ledger.started(at(0, 1));
    ledger.received(at(0, 2));
    ledger.done(at(0, 1));

    assert_eq!(ledger.rewind_points(any_partition), [at(0, 2)]);
}

#[test]
fn positions_read_as_topic_partition_and_offset() {
    assert_eq!(at(3, 42).to_string(), "macro.email/3@42");
}
