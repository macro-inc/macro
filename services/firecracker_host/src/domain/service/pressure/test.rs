use std::time::{Duration, Instant};

use firecracker_host_api::{Action, ComputerId, HostLimits, Usage};
use uuid::Uuid;

use super::super::SwapPlacement;
use super::super::test::{FakeMachines, FakeStore, computer_id, create_request, host_with};
use super::{SQUEEZE_AFTER, SqueezeView, SqueezeWindow, Squeezed, squeeze_candidate};
use crate::domain::activity::ActivitySettings;
use crate::domain::health::HealthCheck;
use crate::domain::ports::GuestSwap;

const GIB: u64 = 1024 * 1024 * 1024;
const WINDOW: SqueezeWindow = SqueezeWindow {
    above_bytes: 90 * GIB,
    below_bytes: 102 * GIB,
};

fn view(id: u128, quiet_minutes: u64, squeezed: bool) -> SqueezeView {
    SqueezeView {
        computer_id: ComputerId::new_from_uuid(Uuid::from_u128(id)),
        quiet_for: Duration::from_secs(quiet_minutes * 60),
        squeezed,
    }
}

#[test]
fn the_squeeze_runs_only_inside_the_window_on_the_quietest_unsqueezed_computer() {
    let computers = [
        view(1, 45, false),
        view(2, 240, true),
        view(3, 90, false),
        view(4, 29, false),
    ];
    let quietest = ComputerId::new_from_uuid(Uuid::from_u128(3));
    assert_eq!(
        squeeze_candidate(95 * GIB, WINDOW, &computers),
        Some(quietest)
    );
    assert_eq!(
        squeeze_candidate(90 * GIB, WINDOW, &computers),
        None,
        "at the low watermark"
    );
    assert_eq!(
        squeeze_candidate(102 * GIB, WINDOW, &computers),
        None,
        "hibernation's turn"
    );
    assert_eq!(
        squeeze_candidate(95 * GIB, WINDOW, &[view(4, 29, false)]),
        None,
        "quiet less than 30 min"
    );
}

fn usage(cpu_seconds: u64) -> Usage {
    Usage {
        resident_memory_bytes: 600 * 1024 * 1024,
        private_memory_bytes: 0,
        swap_bytes: Some(0),
        cpu_usage_microseconds: cpu_seconds * 1_000_000,
    }
}

#[tokio::test]
async fn cpu_weight_follows_activity() {
    let machines = FakeMachines::default();
    let host = host_with(FakeStore::default(), machines, 2).await;
    host.service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();
    host.machines
        .usage
        .lock()
        .unwrap()
        .insert(computer_id(), usage(0));
    let settings = ActivitySettings::default();
    let mut now = Instant::now();
    let weight = || {
        host.machines
            .weights
            .lock()
            .unwrap()
            .get(&computer_id())
            .copied()
    };

    host.service.activity_pass(now, &settings);
    assert_eq!(weight(), Some(1000), "just started: active");

    // Quiet for 11 minutes.
    for _ in 0..66 {
        now += Duration::from_secs(10);
        host.service.activity_pass(now, &settings);
    }
    assert_eq!(weight(), Some(20));

    // A burst: 5 s of CPU in 10 s.
    host.machines
        .usage
        .lock()
        .unwrap()
        .insert(computer_id(), usage(5));
    now += Duration::from_secs(10);
    host.service.activity_pass(now, &settings);
    assert_eq!(weight(), Some(1000));
}

#[tokio::test]
async fn an_idle_computer_is_squeezed_once_until_it_is_busy_again() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 2).await;
    host.service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();
    host.machines
        .usage
        .lock()
        .unwrap()
        .insert(computer_id(), usage(0));
    *host.probe.0.lock().unwrap() = 95 * GIB;
    let settings = ActivitySettings::default();
    let start = Instant::now();
    host.service.activity_pass(start, &settings);

    let early = start + SQUEEZE_AFTER - Duration::from_secs(1);
    host.service.activity_pass(early, &settings);
    assert_eq!(host.service.squeeze_once(WINDOW, early).await, None);

    let late = start + SQUEEZE_AFTER;
    host.service.activity_pass(late, &settings);
    assert_eq!(
        host.service.squeeze_once(WINDOW, late).await,
        Some(Squeezed {
            computer_id: computer_id(),
            reclaimed_bytes: 300 * 1024 * 1024,
        })
    );
    assert_eq!(host.service.squeeze_once(WINDOW, late).await, None);

    // Busy again: squeezable once it has been quiet for long enough again.
    host.machines
        .usage
        .lock()
        .unwrap()
        .insert(computer_id(), usage(10));
    let busy = late + Duration::from_secs(10);
    host.service.activity_pass(busy, &settings);
    let quiet_again = busy + SQUEEZE_AFTER;
    host.service.activity_pass(quiet_again, &settings);
    assert!(
        host.service
            .squeeze_once(WINDOW, quiet_again)
            .await
            .is_some()
    );
    assert_eq!(host.machines.reclaims.lock().unwrap().len(), 2);
}

#[tokio::test]
async fn a_stopped_computer_is_no_longer_tracked() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 2).await;
    host.service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();
    host.machines
        .usage
        .lock()
        .unwrap()
        .insert(computer_id(), usage(0));
    *host.probe.0.lock().unwrap() = 95 * GIB;
    let settings = ActivitySettings::default();
    let start = Instant::now();
    host.service.activity_pass(start, &settings);
    host.service
        .power(computer_id(), Action::Stop)
        .await
        .unwrap();

    let late = start + SQUEEZE_AFTER;
    host.service.activity_pass(late, &settings);
    assert_eq!(host.service.squeeze_once(WINDOW, late).await, None);
    assert!(host.machines.reclaims.lock().unwrap().is_empty());
}

#[tokio::test]
async fn the_window_comes_from_the_host_limits_and_needs_swap() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 1).await;
    assert_eq!(host.service.squeeze_window(), None);
    let swap_check = |host: &super::super::test::Host| {
        host.service
            .service_checks()
            .into_iter()
            .find(|check| check.check == HealthCheck::Swap)
            .unwrap()
            .healthy
    };
    assert!(swap_check(&host), "no squeeze asked: no swap needed");

    host.service
        .set_host_limits(HostLimits {
            guest_memory_max_bytes: 115 * GIB,
            squeeze_above_bytes: Some(90 * GIB),
            squeeze_below_bytes: Some(102 * GIB),
            home_disk_gib: vec![20],
        })
        .await
        .unwrap();

    assert_eq!(host.service.squeeze_window(), Some(WINDOW));
    assert!(!swap_check(&host), "the fake host has no swap");
}

#[tokio::test]
async fn a_disk_swap_device_fails_the_swap_check_and_stops_the_squeeze() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 2).await;
    host.service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();
    host.machines
        .usage
        .lock()
        .unwrap()
        .insert(computer_id(), usage(0));
    *host.probe.0.lock().unwrap() = 95 * GIB;
    *host.probe.1.lock().unwrap() = SwapPlacement::Disk { devices: 1 };
    let settings = ActivitySettings::default();
    let start = Instant::now();
    host.service.activity_pass(start, &settings);
    let late = start + SQUEEZE_AFTER;
    host.service.activity_pass(late, &settings);

    assert_eq!(host.service.squeeze_once(WINDOW, late).await, None);
    assert!(host.machines.reclaims.lock().unwrap().is_empty());
    let swap = host
        .service
        .service_checks()
        .into_iter()
        .find(|check| check.check == HealthCheck::Swap)
        .unwrap();
    assert!(
        !swap.healthy,
        "no squeeze asked, but a disk swap device is active"
    );
}

#[tokio::test]
async fn vms_may_swap_only_while_all_swap_is_in_ram_and_the_limit_is_applied_on_change() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 1).await;
    let writes = || host.machines.guest_swap.lock().unwrap().clone();

    host.service.guard_guest_swap().await;
    host.service.guard_guest_swap().await;
    assert_eq!(
        writes(),
        [GuestSwap::Allowed],
        "zram only: allowed, written once"
    );

    *host.probe.1.lock().unwrap() = SwapPlacement::Disk { devices: 1 };
    host.service.guard_guest_swap().await;
    assert_eq!(
        writes(),
        [GuestSwap::Allowed, GuestSwap::Off],
        "a disk swap device: none"
    );

    *host.probe.1.lock().unwrap() = SwapPlacement::Unknown;
    host.service.guard_guest_swap().await;
    assert_eq!(
        writes(),
        [GuestSwap::Allowed, GuestSwap::Off],
        "unreadable stays none"
    );

    *host.probe.1.lock().unwrap() = SwapPlacement::RamOnly;
    host.service.guard_guest_swap().await;
    assert_eq!(
        writes(),
        [GuestSwap::Allowed, GuestSwap::Off, GuestSwap::Allowed],
        "back to zram only"
    );
}

#[tokio::test]
async fn an_unreadable_swap_list_fails_the_swap_check_and_stops_the_squeeze() {
    let host = host_with(FakeStore::default(), FakeMachines::default(), 2).await;
    host.service
        .create(computer_id(), create_request(1, true))
        .await
        .unwrap();
    host.machines
        .usage
        .lock()
        .unwrap()
        .insert(computer_id(), usage(0));
    *host.probe.0.lock().unwrap() = 95 * GIB;
    *host.probe.1.lock().unwrap() = SwapPlacement::Unknown;
    let settings = ActivitySettings::default();
    let start = Instant::now();
    host.service.activity_pass(start, &settings);
    let late = start + SQUEEZE_AFTER;
    host.service.activity_pass(late, &settings);

    assert_eq!(host.service.squeeze_once(WINDOW, late).await, None);
    let swap = host
        .service
        .service_checks()
        .into_iter()
        .find(|check| check.check == HealthCheck::Swap)
        .unwrap();
    assert!(!swap.healthy);
    assert!(
        swap.detail
            .as_deref()
            .unwrap_or_default()
            .contains("unreadable"),
        "{swap:?}"
    );
}
