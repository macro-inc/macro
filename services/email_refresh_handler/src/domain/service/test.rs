use std::sync::{Arc, Mutex};

use uuid::Uuid;

use super::*;

#[derive(Debug, PartialEq, Eq)]
enum Call {
    Unused(i32),
    Inactive(i32),
    DeleteUnused(Uuid),
    DeleteInactive(Uuid),
}

type Calls = Arc<Mutex<Vec<Call>>>;

struct Repository {
    calls: Calls,
    unused: Result<Vec<Uuid>, &'static str>,
    inactive: Result<Vec<Uuid>, &'static str>,
}

impl LinkRepository for Repository {
    type Error = &'static str;

    async fn fetch_refresh_link_ids(&self, _current_hour: i32) -> Result<Vec<Uuid>, Self::Error> {
        panic!("unexpected refresh query");
    }

    async fn fetch_health_check_link_ids(
        &self,
        _interval_hours: i32,
        _bucket: i32,
    ) -> Result<Vec<Uuid>, Self::Error> {
        panic!("unexpected health query");
    }

    async fn fetch_unused_link_ids(&self, days: i32) -> Result<Vec<Uuid>, Self::Error> {
        self.calls.lock().unwrap().push(Call::Unused(days));
        self.unused.clone()
    }

    async fn fetch_inactive_link_ids(&self, days: i32) -> Result<Vec<Uuid>, Self::Error> {
        self.calls.lock().unwrap().push(Call::Inactive(days));
        self.inactive.clone()
    }
}

struct Queue {
    calls: Calls,
    attempts: Mutex<usize>,
    failures: Vec<usize>,
}

impl LinkManagerQueue for Queue {
    type Error = &'static str;

    async fn enqueue_link_manager_notification(
        &self,
        notification: LinkManagerMessage,
    ) -> Result<(), Self::Error> {
        let call = match notification {
            LinkManagerMessage::DeleteLink {
                link_id,
                deletion_reason: DeletionReason::Unused,
            } => Call::DeleteUnused(link_id),
            LinkManagerMessage::DeleteLink {
                link_id,
                deletion_reason: DeletionReason::Inactive,
            } => Call::DeleteInactive(link_id),
            _ => panic!("unexpected notification"),
        };
        self.calls.lock().unwrap().push(call);
        let mut attempts = self.attempts.lock().unwrap();
        *attempts += 1;
        if self.failures.contains(&*attempts) {
            Err("synthetic queue failure")
        } else {
            Ok(())
        }
    }
}

fn config() -> MaintenanceConfig {
    MaintenanceConfig {
        is_production: false,
        delete_unused_after_days: 30,
        delete_inactive_after_days: 60,
        health_poll_interval_hours: 0,
    }
}

fn service(
    config: MaintenanceConfig,
    unused: Result<Vec<Uuid>, &'static str>,
    inactive: Result<Vec<Uuid>, &'static str>,
    failures: &[usize],
) -> (LinkMaintenance<Repository, Queue>, Calls) {
    let calls = Calls::default();
    (
        LinkMaintenance::new(
            Repository {
                calls: Arc::clone(&calls),
                unused,
                inactive,
            },
            Queue {
                calls: Arc::clone(&calls),
                attempts: Mutex::new(0),
                failures: failures.to_vec(),
            },
            config,
        ),
        calls,
    )
}

#[tokio::test]
async fn deletion_reads_both_groups_before_sending_unused_then_inactive_in_result_order() {
    let first = Uuid::from_u128(3);
    let second = Uuid::from_u128(1);
    let third = Uuid::from_u128(2);
    let (service, calls) = service(config(), Ok(vec![first, second]), Ok(vec![third]), &[]);
    service.send_delete_messages().await.unwrap();
    assert_eq!(
        *calls.lock().unwrap(),
        [
            Call::Unused(30),
            Call::Inactive(60),
            Call::DeleteUnused(first),
            Call::DeleteUnused(second),
            Call::DeleteInactive(third)
        ]
    );
}

#[tokio::test]
async fn empty_deletion_lists_still_read_both_groups() {
    let (service, calls) = service(config(), Ok(vec![]), Ok(vec![]), &[]);
    service.send_delete_messages().await.unwrap();
    assert_eq!(
        *calls.lock().unwrap(),
        [Call::Unused(30), Call::Inactive(60)]
    );
}

#[tokio::test]
async fn unused_query_failure_still_reads_and_sends_inactive() {
    let id = Uuid::from_u128(1);
    let (service, calls) = service(config(), Err("query failed"), Ok(vec![id]), &[]);
    service.send_delete_messages().await.unwrap();
    assert_eq!(
        *calls.lock().unwrap(),
        [
            Call::Unused(30),
            Call::Inactive(60),
            Call::DeleteInactive(id)
        ]
    );
}

#[tokio::test]
async fn inactive_query_failure_keeps_unused_sends() {
    let id = Uuid::from_u128(1);
    let (service, calls) = service(config(), Ok(vec![id]), Err("query failed"), &[]);
    service.send_delete_messages().await.unwrap();
    assert_eq!(
        *calls.lock().unwrap(),
        [Call::Unused(30), Call::Inactive(60), Call::DeleteUnused(id)]
    );
}

#[tokio::test]
async fn both_deletion_query_failures_finish_successfully() {
    let (service, calls) = service(config(), Err("query failed"), Err("query failed"), &[]);
    service.send_delete_messages().await.unwrap();
    assert_eq!(
        *calls.lock().unwrap(),
        [Call::Unused(30), Call::Inactive(60)]
    );
}

#[tokio::test]
async fn failed_delete_sends_do_not_stop_remaining_ids_or_the_other_group() {
    let unused = Uuid::from_u128(1);
    let inactive = Uuid::from_u128(2);
    for failures in [vec![1], vec![2], vec![1, 2, 3, 4]] {
        let (service, calls) = service(
            config(),
            Ok(vec![unused, unused]),
            Ok(vec![inactive, inactive]),
            &failures,
        );
        service.send_delete_messages().await.unwrap();
        assert_eq!(
            *calls.lock().unwrap(),
            [
                Call::Unused(30),
                Call::Inactive(60),
                Call::DeleteUnused(unused),
                Call::DeleteUnused(unused),
                Call::DeleteInactive(inactive),
                Call::DeleteInactive(inactive)
            ]
        );
    }
}

#[tokio::test]
async fn deletion_days_keep_the_unchecked_signed_cast() {
    for days in [0, i32::MAX as u32, 2_147_483_648, u32::MAX] {
        let config = MaintenanceConfig {
            delete_unused_after_days: days,
            delete_inactive_after_days: days,
            ..config()
        };
        let (service, calls) = service(config, Ok(vec![]), Ok(vec![]), &[]);
        service.send_delete_messages().await.unwrap();
        assert_eq!(
            *calls.lock().unwrap(),
            [Call::Unused(days as i32), Call::Inactive(days as i32)]
        );
    }
}

#[tokio::test]
async fn nonpositive_signed_health_intervals_return_before_clock_or_repository_access() {
    for health_poll_interval_hours in [0, 2_147_483_648, u32::MAX] {
        let config = MaintenanceConfig {
            health_poll_interval_hours,
            ..config()
        };
        let (service, calls) = service(config, Ok(vec![]), Ok(vec![]), &[]);
        service.send_health_check_messages().await.unwrap();
        assert!(calls.lock().unwrap().is_empty());
    }
}

#[tokio::test]
async fn repeated_deletion_runs_repeat_queries_and_sends() {
    let id = Uuid::from_u128(1);
    let (service, calls) = service(config(), Ok(vec![id]), Ok(vec![]), &[]);
    service.send_delete_messages().await.unwrap();
    service.send_delete_messages().await.unwrap();
    assert_eq!(
        *calls.lock().unwrap(),
        [
            Call::Unused(30),
            Call::Inactive(60),
            Call::DeleteUnused(id),
            Call::Unused(30),
            Call::Inactive(60),
            Call::DeleteUnused(id)
        ]
    );
}
