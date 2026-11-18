use super::*;
use crate::inbound::kafka_consumer::offsets::RecordPosition;

const TOPIC: &str = "macro.email";
const T0: i64 = 1_700_000_000_000;
const SECOND: i64 = 1_000;

fn reading(partition: i32, position: Option<i64>, high_watermark: Option<i64>) -> PartitionReading {
    PartitionReading {
        topic: TOPIC,
        partition,
        position,
        high_watermark,
    }
}

fn at(partition: i32, offset: i64) -> RecordPosition {
    RecordPosition {
        topic: TOPIC,
        partition,
        offset,
    }
}

/// Samples `readings` at `now_ms` and returns each partition's age.
fn sample(
    sampler: &mut BacklogSampler,
    now_ms: i64,
    readings: &[PartitionReading],
    ledger: &OffsetLedger,
) -> Vec<(i32, u64)> {
    sampler.sample(now_ms, Instant::now(), readings, ledger);
    sampler
        .ages
        .fresh(Instant::now())
        .into_iter()
        .map(|(_, partition, age_ms)| (partition, age_ms))
        .collect()
}

#[test]
fn a_caught_up_partition_reads_zero() {
    let ages = PendingAges::default();
    let mut sampler = BacklogSampler::new(ages);

    let readings = [reading(0, Some(40), Some(40))];
    assert_eq!(
        sample(&mut sampler, T0, &readings, &OffsetLedger::default()),
        [(0, 0)]
    );
}

#[test]
fn an_unfinished_record_ages_from_its_broker_timestamp_while_the_consumer_is_stalled() {
    let mut sampler = BacklogSampler::new(PendingAges::default());
    let mut ledger = OffsetLedger::default();
    ledger.received(at(0, 5), Some(T0 - 42 * SECOND));
    ledger.received(at(0, 6), Some(T0 - 41 * SECOND));
    let readings = [reading(0, Some(7), Some(9))];

    assert_eq!(sample(&mut sampler, T0, &readings, &ledger), [(0, 42_000)]);
    assert_eq!(
        sample(&mut sampler, T0 + 10 * SECOND, &readings, &ledger),
        [(0, 52_000)],
        "nothing moves, so the age keeps rising"
    );

    ledger.started(at(0, 5));
    ledger.finished(at(0, 5));
    assert_eq!(
        sample(&mut sampler, T0 + 20 * SECOND, &readings, &ledger),
        [(0, 61_000)]
    );
}

#[test]
fn a_record_not_yet_received_ages_from_the_first_sample_that_saw_it() {
    let mut sampler = BacklogSampler::new(PendingAges::default());
    let ledger = OffsetLedger::default();

    assert_eq!(
        sample(&mut sampler, T0, &[reading(0, Some(10), Some(10))], &ledger),
        [(0, 0)]
    );
    // Offsets 10 and 11 arrive and wait in the prefetch queue behind other
    // partitions' records.
    let behind = [reading(0, Some(10), Some(12))];
    assert_eq!(
        sample(&mut sampler, T0 + 10 * SECOND, &behind, &ledger),
        [(0, 0)]
    );
    assert_eq!(
        sample(&mut sampler, T0 + 20 * SECOND, &behind, &ledger),
        [(0, 10_000)]
    );
    // 10 was received and finished, so 11 is next; 12 to 14 arrive.
    assert_eq!(
        sample(
            &mut sampler,
            T0 + 30 * SECOND,
            &[reading(0, Some(11), Some(15))],
            &ledger
        ),
        [(0, 20_000)]
    );
    assert_eq!(
        sample(
            &mut sampler,
            T0 + 40 * SECOND,
            &[reading(0, Some(12), Some(15))],
            &ledger
        ),
        [(0, 10_000)],
        "the watermark first passed 12 at the T0 + 30 s sample"
    );
    assert_eq!(
        sample(
            &mut sampler,
            T0 + 50 * SECOND,
            &[reading(0, Some(15), Some(15))],
            &ledger
        ),
        [(0, 0)]
    );
}

#[test]
fn before_its_first_record_a_partition_counts_from_its_first_sample() {
    let mut sampler = BacklogSampler::new(PendingAges::default());
    let ledger = OffsetLedger::default();

    assert_eq!(
        sample(&mut sampler, T0, &[reading(0, None, Some(100))], &ledger),
        [(0, 0)]
    );
    let arrived = [reading(0, None, Some(103))];
    assert_eq!(
        sample(&mut sampler, T0 + 10 * SECOND, &arrived, &ledger),
        [(0, 0)]
    );
    assert_eq!(
        sample(&mut sampler, T0 + 30 * SECOND, &arrived, &ledger),
        [(0, 20_000)]
    );
    assert_eq!(
        sample(
            &mut sampler,
            T0 + 40 * SECOND,
            &[reading(0, None, None)],
            &ledger
        ),
        [(0, 30_000)],
        "a partition without a fetched watermark keeps what it saw"
    );
}

#[test]
fn a_partition_with_nothing_known_reads_zero() {
    let mut sampler = BacklogSampler::new(PendingAges::default());

    assert_eq!(
        sample(
            &mut sampler,
            T0,
            &[reading(0, None, None)],
            &OffsetLedger::default()
        ),
        [(0, 0)]
    );
}

#[test]
fn revoked_partitions_and_a_dropped_sampler_stop_reporting() {
    let ages = PendingAges::default();
    let mut sampler = BacklogSampler::new(ages.clone());
    let ledger = OffsetLedger::default();

    assert_eq!(
        sample(
            &mut sampler,
            T0,
            &[reading(0, Some(1), Some(1)), reading(1, Some(1), Some(1))],
            &ledger
        ),
        [(0, 0), (1, 0)]
    );
    assert_eq!(
        sample(
            &mut sampler,
            T0 + 10 * SECOND,
            &[reading(1, Some(1), Some(1))],
            &ledger
        ),
        [(1, 0)]
    );

    drop(sampler);
    assert!(ages.fresh(Instant::now()).is_empty());
}

#[test]
fn a_long_stall_keeps_its_history_bounded_and_never_reads_younger_than_it_is() {
    let mut sampler = BacklogSampler::new(PendingAges::default());
    let ledger = OffsetLedger::default();
    let samples = 3 * HISTORY_LIMIT as i64;

    // The position stays at 0 while one record arrives per sample.
    for sample_index in 0..samples {
        sampler.sample(
            T0 + sample_index * 10 * SECOND,
            Instant::now(),
            &[reading(0, Some(0), Some(sample_index + 1))],
            &ledger,
        );
    }
    let history = &sampler.partitions[&(TOPIC, 0)];
    assert!(history.seen.len() <= HISTORY_LIMIT);
    let now = T0 + samples * 10 * SECOND;

    // Record `offset` arrived at the sample with index `offset`.
    for offset in [0, 1, 500, samples - 1] {
        let age = sample(
            &mut sampler,
            now,
            &[reading(0, Some(offset), Some(samples))],
            &ledger,
        );
        let truth = u64::try_from(now - (T0 + offset * 10 * SECOND)).expect("positive age");
        assert!(age[0].1 >= truth, "offset {offset}: {} < {truth}", age[0].1);
        assert!(
            age[0].1 - truth <= 80 * 10 * 1_000,
            "offset {offset}: off by more than the thinned gap"
        );
    }
}
