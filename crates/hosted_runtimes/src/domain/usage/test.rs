use chrono::{TimeZone, Utc};
use uuid::Uuid;

use super::*;

const GIB: u64 = 1024 * 1024 * 1024;

fn computer() -> ComputerId {
    ComputerId::new_from_uuid(Uuid::from_u128(7))
}

#[test]
fn cpu_is_the_counters_growth_as_a_share_of_the_computers_cpus() {
    let now = Utc.with_ymd_and_hms(2026, 11, 18, 12, 0, 0).unwrap();
    // 4 vCPUs; 60 s apart the counter grew by 120 CPU-seconds: 2 of 4 CPUs.
    let samples = [
        StoredSample {
            sampled_at: now - Duration::seconds(70),
            cpu_usage_microseconds: 1_000_000_000,
            memory_bytes: 2 * GIB,
        },
        StoredSample {
            sampled_at: now - Duration::seconds(10),
            cpu_usage_microseconds: 1_120_000_000,
            memory_bytes: 3 * GIB,
        },
    ];

    let usage = history(computer(), 4, &samples, now);

    assert_eq!(
        usage.latest,
        Some(UsagePoint {
            cpu_percent: Some(50.0),
            memory_bytes: 3 * GIB,
        })
    );
    assert_eq!(usage.points.len(), 96);
    assert_eq!(usage.points[95], usage.latest);
    assert!(usage.points[..95].iter().all(Option::is_none));
}

#[test]
fn a_bucket_averages_cpu_and_keeps_the_highest_memory() {
    let now = Utc.with_ymd_and_hms(2026, 11, 18, 12, 0, 0).unwrap();
    // Three readings an hour ago: 100 % of 1 vCPU for a minute, then 0 % for
    // 20 seconds. The longer measurement weighs more: 60 s of CPU in 80 s.
    let samples = [
        StoredSample {
            sampled_at: now - Duration::minutes(62),
            cpu_usage_microseconds: 0,
            memory_bytes: GIB,
        },
        StoredSample {
            sampled_at: now - Duration::minutes(61),
            cpu_usage_microseconds: 60_000_000,
            memory_bytes: 5 * GIB,
        },
        StoredSample {
            sampled_at: now - Duration::minutes(60) - Duration::seconds(40),
            cpu_usage_microseconds: 60_000_000,
            memory_bytes: 2 * GIB,
        },
    ];

    let usage = history(computer(), 1, &samples, now);

    // 60-75 minutes ago is the fifth bucket from the end.
    assert_eq!(
        usage.points[91],
        Some(UsagePoint {
            cpu_percent: Some(75.0),
            memory_bytes: 5 * GIB,
        })
    );
    assert_eq!(usage.latest, None, "an hour-old reading is not now");
}

#[test]
fn a_computers_first_reading_shows_its_memory_before_any_cpu() {
    let now = Utc.with_ymd_and_hms(2026, 11, 18, 12, 0, 0).unwrap();
    // Just bought: one reading, nothing to measure CPU against.
    let samples = [StoredSample {
        sampled_at: now - Duration::seconds(20),
        cpu_usage_microseconds: 3_000_000,
        memory_bytes: 2 * GIB,
    }];

    let usage = history(computer(), 4, &samples, now);

    let memory_only = Some(UsagePoint {
        cpu_percent: None,
        memory_bytes: 2 * GIB,
    });
    assert_eq!(usage.latest, memory_only);
    assert_eq!(usage.points[95], memory_only);
}

#[test]
fn a_restarted_computer_measures_no_cpu_across_the_restart_but_keeps_its_memory() {
    let now = Utc.with_ymd_and_hms(2026, 11, 18, 12, 0, 0).unwrap();
    // The counter starts over with the new process.
    let samples = [
        StoredSample {
            sampled_at: now - Duration::minutes(2),
            cpu_usage_microseconds: 900_000_000,
            memory_bytes: GIB,
        },
        StoredSample {
            sampled_at: now - Duration::minutes(1),
            cpu_usage_microseconds: 5_000_000,
            memory_bytes: 3 * GIB,
        },
    ];

    let usage = history(computer(), 2, &samples, now);

    let memory_only = Some(UsagePoint {
        cpu_percent: None,
        memory_bytes: 3 * GIB,
    });
    assert_eq!(usage.latest, memory_only);
    assert_eq!(usage.points[95], memory_only);
}

#[test]
fn time_asleep_is_a_gap_in_cpu_not_an_average() {
    let now = Utc.with_ymd_and_hms(2026, 11, 18, 12, 0, 0).unwrap();
    // Hibernated for three hours between two readings: the same process
    // would have had to be measured within five minutes.
    let samples = [
        StoredSample {
            sampled_at: now - Duration::hours(3),
            cpu_usage_microseconds: 10_000_000,
            memory_bytes: GIB,
        },
        StoredSample {
            sampled_at: now - Duration::seconds(30),
            cpu_usage_microseconds: 20_000_000,
            memory_bytes: 2 * GIB,
        },
    ];

    let usage = history(computer(), 2, &samples, now);

    assert_eq!(
        usage.latest,
        Some(UsagePoint {
            cpu_percent: None,
            memory_bytes: 2 * GIB,
        })
    );
    // Three hours ago is eleven steps before the last; nothing lies between.
    assert_eq!(
        usage.points[84],
        Some(UsagePoint {
            cpu_percent: None,
            memory_bytes: GIB,
        })
    );
    assert!(usage.points[85..95].iter().all(Option::is_none));
}
