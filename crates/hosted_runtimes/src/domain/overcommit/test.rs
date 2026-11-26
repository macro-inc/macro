use std::collections::HashSet;

use chrono::{DateTime, Duration, TimeZone, Utc};
use proptest::prelude::*;
use uuid::Uuid;

use super::*;
use crate::domain::ids::ComputerId;
use crate::domain::size::{ComputerResources, DiskGib, MemoryGib, Vcpus};

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 17, 12, 0, 0).unwrap()
}

fn policy() -> OvercommitPolicy {
    OvercommitPolicy {
        cpu_allocation_ratio: Percent::new(400),
        ram_allocation_ratio: Percent::new(150),
        reserved_vcpus: 2,
        reserved_memory_gib: 8,
        oversell_factor: 2,
        live_memory: limits(),
    }
}

fn watermarks(low: u32, high: u32, hard_ceiling: u32) -> Watermarks {
    Watermarks {
        low: Percent::new(low),
        high: Percent::new(high),
        hard_ceiling: Percent::new(hard_ceiling),
    }
}

fn limits_with(watermarks: Watermarks, start_resident_memory_mib: u64) -> LiveMemoryLimits {
    LiveMemoryLimits::new(
        watermarks,
        start_resident_memory_mib,
        Duration::minutes(15),
        Duration::minutes(2),
    )
    .unwrap()
}

fn limits() -> LiveMemoryLimits {
    limits_with(watermarks(70, 80, 90), 512)
}

/// An n2-standard-32: 32 vCPUs, 128 GiB.
fn capacity() -> HostCapacity {
    HostCapacity {
        hardware: HostHardware {
            vcpus: 32,
            memory_mib: 128 * 1024,
        },
        policy: policy(),
    }
}

fn standard() -> ComputerResources {
    ComputerResources {
        vcpus: Vcpus::new(2),
        memory_gib: MemoryGib::new(8),
        disk_gib: DiskGib::new(100),
    }
}

fn report(resident_gib: u64) -> MemoryReport {
    MemoryReport {
        resident_memory_mib: resident_gib * 1024,
        reported_at: now() - Duration::seconds(30),
    }
}

fn computer(n: u128) -> ComputerId {
    ComputerId::new_from_uuid(Uuid::from_u128(n))
}

#[test]
fn ratios_and_reserves_set_allocatable_capacity_and_units() {
    let capacity = capacity();
    assert_eq!(capacity.allocatable_vcpus(), 120);
    assert_eq!(capacity.allocatable_memory_gib(), 180);
    // Memory is scarcer: 180 / 8 = 22 units, against 120 / 4 = 30 by CPU.
    assert_eq!(capacity.awake_units(), 22);
    assert_eq!(capacity.sold_units(), 44);
}

#[test]
fn cpu_can_be_the_scarcer_resource() {
    // 16 vCPUs, none reserved, 1:1: four 4-vCPU units however much memory.
    let capacity = HostCapacity {
        hardware: HostHardware {
            vcpus: 16,
            memory_mib: 512 * 1024,
        },
        policy: OvercommitPolicy {
            cpu_allocation_ratio: Percent::new(100),
            reserved_vcpus: 0,
            ..policy()
        },
    };
    assert_eq!(capacity.awake_units(), 4);
    assert_eq!(
        admit(
            &capacity,
            AwakeAllocation {
                vcpus: 15,
                memory_gib: 0,
            },
            standard(),
            Some(report(10)),
            now()
        ),
        Err(Refusal::CpuAllocation)
    );
}

#[test]
fn a_start_is_admitted_while_allocation_and_live_memory_have_room() {
    assert_eq!(
        admit(
            &capacity(),
            AwakeAllocation {
                vcpus: 20,
                memory_gib: 160,
            },
            standard(),
            Some(report(60)),
            now(),
        ),
        Ok(())
    );
}

#[test]
fn each_limit_refuses_a_start_for_its_own_reason() {
    let awake = AwakeAllocation {
        vcpus: 20,
        memory_gib: 100,
    };
    for (awake, report, refusal) in [
        (
            AwakeAllocation {
                vcpus: 119,
                memory_gib: 0,
            },
            Some(report(10)),
            Refusal::CpuAllocation,
        ),
        (
            AwakeAllocation {
                vcpus: 0,
                memory_gib: 173,
            },
            Some(report(10)),
            Refusal::MemoryAllocation,
        ),
        (awake, None, Refusal::StaleMemoryReport),
        (
            awake,
            Some(MemoryReport {
                reported_at: now() - Duration::minutes(3),
                ..report(10)
            }),
            Refusal::StaleMemoryReport,
        ),
        // 80% of 128 GiB is 102.4 GiB.
        (awake, Some(report(103)), Refusal::HighWatermark),
    ] {
        assert_eq!(
            admit(&capacity(), awake, standard(), report, now()),
            Err(refusal),
            "{refusal:?}"
        );
    }
}

#[test]
fn a_start_that_would_cross_the_hard_ceiling_is_refused_below_the_high_watermark() {
    let capacity = HostCapacity {
        policy: OvercommitPolicy {
            live_memory: limits_with(watermarks(70, 90, 90), 4 * 1024),
            ..policy()
        },
        ..capacity()
    };
    // 90% is 115.2 GiB; 112 GiB + 4 GiB crosses it.
    assert_eq!(
        admit(
            &capacity,
            AwakeAllocation::default(),
            standard(),
            Some(report(112)),
            now()
        ),
        Err(Refusal::HardCeiling)
    );
}

#[test]
fn relief_does_nothing_under_the_high_watermark() {
    let guests = [GuestMemory {
        computer_id: computer(1),
        resident_memory_mib: 8 * 1024,
        idle_since: Some(now() - Duration::hours(5)),
    }];
    assert!(relieve(&capacity(), report(100), &guests, now()).is_empty());
}

#[test]
fn relief_hibernates_the_idlest_guests_until_under_the_low_watermark() {
    // 110 GiB resident; the low watermark is 89.6 GiB, so 20.4+ GiB must go.
    let guests = [
        GuestMemory {
            computer_id: computer(1),
            resident_memory_mib: 8 * 1024,
            idle_since: Some(now() - Duration::hours(1)),
        },
        GuestMemory {
            computer_id: computer(2),
            resident_memory_mib: 8 * 1024,
            idle_since: Some(now() - Duration::hours(3)),
        },
        GuestMemory {
            computer_id: computer(3),
            resident_memory_mib: 30 * 1024,
            idle_since: None,
        },
        GuestMemory {
            computer_id: computer(4),
            resident_memory_mib: 8 * 1024,
            idle_since: Some(now() - Duration::minutes(5)),
        },
        GuestMemory {
            computer_id: computer(5),
            resident_memory_mib: 8 * 1024,
            idle_since: Some(now() - Duration::hours(2)),
        },
    ];
    assert_eq!(
        relieve(&capacity(), report(110), &guests, now()),
        vec![computer(2), computer(5), computer(1)]
    );
}

#[test]
fn relief_never_picks_busy_or_recently_active_guests_even_short_of_the_target() {
    let guests = [
        GuestMemory {
            computer_id: computer(1),
            resident_memory_mib: 60 * 1024,
            idle_since: None,
        },
        GuestMemory {
            computer_id: computer(2),
            resident_memory_mib: 4 * 1024,
            idle_since: Some(now() - Duration::hours(1)),
        },
        GuestMemory {
            computer_id: computer(3),
            resident_memory_mib: 40 * 1024,
            idle_since: Some(now() - Duration::minutes(1)),
        },
    ];
    assert_eq!(
        relieve(&capacity(), report(120), &guests, now()),
        vec![computer(2)]
    );
}

#[test]
fn incoherent_policies_are_refused() {
    for (policy, error) in [
        (
            OvercommitPolicy {
                ram_allocation_ratio: Percent::new(0),
                ..policy()
            },
            InvalidOvercommitPolicy::ZeroAllocationRatio,
        ),
        (
            OvercommitPolicy {
                cpu_allocation_ratio: Percent::new(0),
                ..policy()
            },
            InvalidOvercommitPolicy::ZeroAllocationRatio,
        ),
        (
            OvercommitPolicy {
                oversell_factor: 0,
                ..policy()
            },
            InvalidOvercommitPolicy::ZeroOversell,
        ),
    ] {
        assert_eq!(policy.validate(), Err(error));
    }
    assert_eq!(policy().validate(), Ok(policy()));
}

#[test]
fn live_memory_limits_need_rising_watermarks_and_positive_durations() {
    let build =
        |watermarks, idle, freshness| LiveMemoryLimits::new(watermarks, 512, idle, freshness);
    let minute = Duration::minutes(1);
    for (low, high, ceiling) in [(80, 80, 90), (70, 91, 90), (70, 80, 101)] {
        assert_eq!(
            build(watermarks(low, high, ceiling), minute, minute),
            Err(InvalidOvercommitPolicy::WatermarkOrder),
            "{low} {high} {ceiling}"
        );
    }
    assert_eq!(
        build(watermarks(70, 80, 90), minute, Duration::zero()),
        Err(InvalidOvercommitPolicy::NonPositiveDuration)
    );
    assert_eq!(
        build(watermarks(70, 80, 90), Duration::zero(), minute),
        Err(InvalidOvercommitPolicy::NonPositiveDuration)
    );
    // A high watermark at the ceiling is allowed: no gap between stop and limit.
    assert!(build(watermarks(70, 90, 90), minute, minute).is_ok());
}

#[test]
fn the_agents_limits_are_the_ceiling_and_the_watermarks_of_host_memory() {
    // 90%, 70% and 80% of 128 GiB.
    assert_eq!(
        capacity().agent_limits(vec![68, 168]),
        HostAgentLimits {
            guest_memory_max_mib: 117_964,
            squeeze_above_mib: 91_750,
            squeeze_below_mib: 104_857,
            home_disk_gib: vec![68, 168],
        }
    );
}

#[test]
fn memory_ratios_are_shares_of_host_memory() {
    assert_eq!(
        capacity().memory_ratios(report(64)),
        Some(MemoryRatios {
            used: 0.5,
            low_watermark: 0.7,
            high_watermark: 0.8,
            hard_ceiling: 0.9,
        })
    );
}

fn sample(n: u128, cpu_seconds: u64) -> ActivitySample {
    ActivitySample {
        computer_id: computer(n),
        cpu_usage_microseconds: cpu_seconds * 1_000_000,
        private_memory_mib: 700,
    }
}

#[test]
fn a_guest_is_idle_from_the_first_quiet_reading_until_it_spends_cpu_again() {
    let mut tracker = ActivityTracker::default();
    let start = now();
    // First reading: unknown, so busy.
    let first = tracker.observe(&[sample(1, 100)], start);
    assert_eq!(first[0].idle_since, None);
    // 60 s later, 1 s of CPU: under 10% of a vCPU, idle since the first reading.
    let minute = start + Duration::seconds(60);
    let second = tracker.observe(&[sample(1, 101)], minute);
    assert_eq!(second[0].idle_since, Some(start));
    assert_eq!(second[0].resident_memory_mib, 700);
    // Still quiet: the idle start stands.
    let third = tracker.observe(&[sample(1, 102)], minute + Duration::seconds(60));
    assert_eq!(third[0].idle_since, Some(start));
    // 30 s of CPU in a minute: busy again.
    let busy = tracker.observe(&[sample(1, 132)], minute + Duration::seconds(120));
    assert_eq!(busy[0].idle_since, None);
}

#[test]
fn a_guest_with_a_new_process_is_busy() {
    let mut tracker = ActivityTracker::default();
    let start = now();
    tracker.observe(&[sample(1, 100)], start);
    // Its counter went back: it restarted.
    let guests = tracker.observe(&[sample(1, 5)], start + Duration::seconds(60));
    assert_eq!(guests[0].idle_since, None);
}

#[test]
fn a_guest_in_use_is_never_relieved_however_quiet() {
    let mut guests = vec![
        GuestMemory {
            computer_id: computer(1),
            resident_memory_mib: 40 * 1024,
            idle_since: Some(now() - Duration::hours(2)),
        },
        GuestMemory {
            computer_id: computer(2),
            resident_memory_mib: 4 * 1024,
            idle_since: Some(now() - Duration::hours(1)),
        },
    ];
    mark_in_use(&mut guests, &HashSet::from([computer(1)]));
    assert_eq!(
        relieve(&capacity(), report(120), &guests, now()),
        vec![computer(2)]
    );
}

#[test]
fn a_guest_missing_from_a_pass_starts_over_as_busy() {
    let mut tracker = ActivityTracker::default();
    let start = now();
    tracker.observe(&[sample(1, 100)], start);
    tracker.observe(&[], start + Duration::seconds(60));
    let back = tracker.observe(&[sample(1, 100)], start + Duration::seconds(120));
    assert_eq!(back[0].idle_since, None);
}

#[test]
fn starts_admitted_since_the_report_count_as_resident() {
    // 70 GiB measured, 1 GiB per start: twelve pending starts put the host at
    // 82 GiB, under its 102.4 GiB (80%) watermark; 33 put it at 103 GiB.
    let capacity = HostCapacity {
        policy: OvercommitPolicy {
            live_memory: limits_with(watermarks(70, 80, 90), 1024),
            ..policy()
        },
        ..capacity()
    };
    let admit_with = |pending| {
        admit(
            &capacity,
            AwakeAllocation::default(),
            standard(),
            Some(report(70).with_pending_starts(pending, &capacity.policy.live_memory)),
            now(),
        )
    };
    assert_eq!(admit_with(12), Ok(()));
    assert_eq!(admit_with(33), Err(Refusal::HighWatermark));
}

fn arbitrary_limits() -> impl Strategy<Value = LiveMemoryLimits> {
    (
        (1u32..98).prop_flat_map(|low| (Just(low), (low + 1)..=99)),
        0u64..16 * 1024,
    )
        .prop_flat_map(|((low, high), start)| {
            (high..=100).prop_map(move |ceiling| limits_with(watermarks(low, high, ceiling), start))
        })
}

fn arbitrary_policy() -> impl Strategy<Value = OvercommitPolicy> {
    (
        1u32..1000,
        1u32..400,
        0u32..16,
        0u32..64,
        1u32..8,
        arbitrary_limits(),
    )
        .prop_map(
            |(cpu, ram, reserved_vcpus, reserved_memory_gib, oversell, live_memory)| {
                OvercommitPolicy {
                    cpu_allocation_ratio: Percent::new(cpu),
                    ram_allocation_ratio: Percent::new(ram),
                    reserved_vcpus,
                    reserved_memory_gib,
                    oversell_factor: oversell,
                    live_memory,
                }
            },
        )
}

fn arbitrary_capacity() -> impl Strategy<Value = HostCapacity> {
    (arbitrary_policy(), 1u32..512, 1u64..2048 * 1024).prop_map(|(policy, vcpus, memory_mib)| {
        HostCapacity {
            hardware: HostHardware { vcpus, memory_mib },
            policy,
        }
    })
}

fn arbitrary_resources() -> impl Strategy<Value = ComputerResources> {
    (1u32..64, 1u32..256).prop_map(|(vcpus, memory_gib)| ComputerResources {
        vcpus: Vcpus::new(vcpus),
        memory_gib: MemoryGib::new(memory_gib),
        disk_gib: DiskGib::new(100),
    })
}

proptest! {
    #[test]
    fn generated_policies_are_valid(policy in arbitrary_policy()) {
        prop_assert_eq!(policy.validate(), Ok(policy));
    }

    #[test]
    fn an_admitted_start_stays_within_allocation_and_under_the_ceiling(
        capacity in arbitrary_capacity(),
        awake_vcpus in 0u64..2048,
        awake_memory_gib in 0u64..4096,
        candidate in arbitrary_resources(),
        resident_mib in 0u64..2048 * 1024,
    ) {
        let awake = AwakeAllocation { vcpus: awake_vcpus, memory_gib: awake_memory_gib };
        let report = MemoryReport { resident_memory_mib: resident_mib, reported_at: now() };
        if admit(&capacity, awake, candidate, Some(report), now()).is_ok() {
            let after = awake.with(candidate);
            prop_assert!(after.vcpus <= capacity.allocatable_vcpus());
            prop_assert!(after.memory_gib <= capacity.allocatable_memory_gib());
            prop_assert!(!capacity.under_pressure(report));
            let limits = capacity.policy.live_memory;
            prop_assert!(
                resident_mib + limits.start_resident_memory_mib()
                    <= limits.hard_ceiling().of(capacity.hardware.memory_mib)
            );
        }
    }

    #[test]
    fn raising_an_allocation_ratio_never_shrinks_capacity(
        capacity in arbitrary_capacity(),
        cpu_extra in 0u32..400,
        ram_extra in 0u32..400,
    ) {
        let raised = HostCapacity {
            policy: OvercommitPolicy {
                cpu_allocation_ratio: Percent::new(capacity.policy.cpu_allocation_ratio.get() + cpu_extra),
                ram_allocation_ratio: Percent::new(capacity.policy.ram_allocation_ratio.get() + ram_extra),
                ..capacity.policy
            },
            ..capacity
        };
        prop_assert!(raised.awake_units() >= capacity.awake_units());
        prop_assert!(raised.sold_units() >= capacity.sold_units());
    }

    #[test]
    fn relief_picks_only_idle_guests_once_and_stops_at_the_low_watermark(
        capacity in arbitrary_capacity(),
        resident_share in 0u64..=100,
        guests in proptest::collection::vec((0u64..64 * 1024, proptest::option::of(0i64..600)), 0..40),
    ) {
        let resident = capacity.hardware.memory_mib * resident_share / 100;
        let report = MemoryReport { resident_memory_mib: resident, reported_at: now() };
        let guests: Vec<GuestMemory> = guests
            .into_iter()
            .enumerate()
            .map(|(index, (resident_memory_mib, idle_minutes))| GuestMemory {
                computer_id: computer(index as u128),
                resident_memory_mib,
                idle_since: idle_minutes.map(|minutes| now() - Duration::minutes(minutes)),
            })
            .collect();
        let picked = relieve(&capacity, report, &guests, now());
        let limits = capacity.policy.live_memory;
        if !capacity.under_pressure(report) {
            prop_assert!(picked.is_empty());
        }
        let mut seen = std::collections::HashSet::new();
        let mut freed_before_last = 0u64;
        let target = limits.low_watermark().of(capacity.hardware.memory_mib);
        for (position, id) in picked.iter().enumerate() {
            prop_assert!(seen.insert(*id));
            let guest = guests.iter().find(|guest| guest.computer_id == *id).unwrap();
            let since = guest.idle_since.unwrap();
            prop_assert!(now() - since >= limits.minimum_idle());
            if position + 1 < picked.len() {
                freed_before_last += guest.resident_memory_mib;
            }
        }
        // Every pick but the last left the host at or above the target.
        prop_assert!(resident.saturating_sub(freed_before_last) >= target || picked.is_empty());
    }

    #[test]
    fn pending_starts_never_make_admission_easier(
        capacity in arbitrary_capacity(),
        candidate in arbitrary_resources(),
        resident_mib in 0u64..2048 * 1024,
        pending in 0u32..64,
        more in 0u32..64,
    ) {
        let measured = MemoryReport { resident_memory_mib: resident_mib, reported_at: now() };
        let limits = capacity.policy.live_memory;
        let fewer = admit(&capacity, AwakeAllocation::default(), candidate, Some(measured.with_pending_starts(pending, &limits)), now());
        let busier = admit(&capacity, AwakeAllocation::default(), candidate, Some(measured.with_pending_starts(pending + more, &limits)), now());
        prop_assert!(fewer.is_ok() || busier.is_err());
    }
}
