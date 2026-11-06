use super::*;
use std::sync::Arc;
use tokio::sync::{Notify, oneshot};

#[derive(Default)]
pub(super) struct FleetGate {
    entered: Notify,
    release: Notify,
    active: AtomicU32,
}

struct ActiveCall<'a>(&'a AtomicU32);

impl Drop for ActiveCall<'_> {
    fn drop(&mut self) {
        self.0.fetch_sub(1, Ordering::SeqCst);
    }
}

impl FleetGate {
    pub(super) async fn wait(&self) {
        self.active.fetch_add(1, Ordering::SeqCst);
        let _active = ActiveCall(&self.active);
        self.entered.notify_one();
        self.release.notified().await;
    }
}

#[tokio::test(start_paused = true)]
async fn shutdown_drains_active_effect_and_returns_queued_leases() {
    for finish_during_drain in [true, false] {
        let gate = Arc::new(FleetGate::default());
        let operator = Arc::new(
            operator(FakeFleet {
                start_gate: Some(Arc::clone(&gate)),
                ..Default::default()
            })
            .await,
        );
        *operator.repo.effects.lock().unwrap() = vec![
            PendingEffect {
                id: 1,
                computer_id: ComputerId::new_from_uuid(Uuid::from_u128(1)),
                effect: Effect::Start { host: HOST },
                attempts: 0,
            },
            PendingEffect {
                id: 2,
                computer_id: ComputerId::new_from_uuid(Uuid::from_u128(2)),
                effect: Effect::Start { host: HOST },
                attempts: 0,
            },
        ];
        let (stop, stopped) = oneshot::channel();
        let task = {
            let operator = Arc::clone(&operator);
            tokio::spawn(async move {
                operator
                    .run_fleet_effects_until(async {
                        stopped.await.unwrap();
                    })
                    .await
            })
        };
        gate.entered.notified().await;
        assert!(
            operator
                .repo
                .lease_effects(EffectWorker::Fleet, 16, now(), now() + EFFECT_LEASE)
                .await
                .unwrap()
                .is_empty()
        );
        stop.send(()).unwrap();
        if finish_during_drain {
            gate.release.notify_one();
        }
        assert_eq!(task.await.unwrap().unwrap(), 1);
        assert_eq!(gate.active.load(Ordering::SeqCst), 0);
        assert_eq!(operator.fleet.calls.lock().unwrap().len(), 1);
        let available = operator
            .repo
            .lease_effects(EffectWorker::Fleet, 16, now(), now() + EFFECT_LEASE)
            .await
            .unwrap();
        let ids: Vec<i64> = available.iter().map(|effect| effect.id).collect();
        assert_eq!(
            ids,
            if finish_during_drain {
                vec![2]
            } else {
                vec![1, 2]
            }
        );
    }
}

#[tokio::test(start_paused = true)]
async fn fleet_call_timeout_ends_before_lease_expiry_and_records_retry() {
    let gate = Arc::new(FleetGate::default());
    let operator = Arc::new(
        operator(FakeFleet {
            start_gate: Some(Arc::clone(&gate)),
            ..Default::default()
        })
        .await,
    );
    operator.repo.effects.lock().unwrap().push(PendingEffect {
        id: 1,
        computer_id: ComputerId::new_from_uuid(Uuid::from_u128(1)),
        effect: Effect::Start { host: HOST },
        attempts: 0,
    });
    let started = tokio::time::Instant::now();
    let task = {
        let operator = Arc::clone(&operator);
        tokio::spawn(async move { operator.run_fleet_effects().await })
    };
    gate.entered.notified().await;
    assert_eq!(task.await.unwrap().unwrap(), 1);
    assert_eq!(gate.active.load(Ordering::SeqCst), 0);
    assert_eq!(operator.repo.effects.lock().unwrap()[0].attempts, 1);
    assert!(started.elapsed() < EFFECT_LEASE.to_std().unwrap());
    assert_eq!(
        operator
            .repo
            .lease_effects(
                EffectWorker::Fleet,
                16,
                now() + Duration::seconds(10),
                now() + EFFECT_LEASE
            )
            .await
            .unwrap()
            .len(),
        1
    );
}

#[tokio::test]
async fn shutdown_before_a_pass_does_not_lease() {
    let operator = operator(FakeFleet::default()).await;
    operator.repo.effects.lock().unwrap().push(PendingEffect {
        id: 1,
        computer_id: ComputerId::new_from_uuid(Uuid::from_u128(1)),
        effect: Effect::Start { host: HOST },
        attempts: 0,
    });
    assert_eq!(
        operator
            .run_fleet_effects_until(std::future::ready(()))
            .await
            .unwrap(),
        0
    );
    assert!(operator.repo.effect_run_after.lock().unwrap().is_empty());
    assert!(operator.fleet.calls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn timer_delivery_consults_fleet_before_applying_missing_macrod() {
    for observed in [
        Some(InstanceStatus::Running),
        Some(InstanceStatus::Stopped),
        None,
    ] {
        let operator = operator(FakeFleet::default()).await;
        let id = paid_computer(&operator).await;
        operator.run_fleet_effects().await.unwrap();
        if let Some(status) = observed {
            operator
                .fleet
                .instances
                .lock()
                .unwrap()
                .push(FleetInstance {
                    computer_id: id,
                    status,
                    control_plane_id: operator.fleet.control_plane_id().clone(),
                    created_at: Some(now()),
                });
        }
        operator
            .repo
            .timers
            .lock()
            .unwrap()
            .push(crate::domain::ports::DueTimer {
                computer_id: id,
                kind: TimerKind::MacrodMissing,
                fire_at: now(),
            });
        operator.fire_timers().await.unwrap();
        let state = operator.repo.get(id).await.unwrap().unwrap().state;
        assert_eq!(
            state.phase,
            if observed == Some(InstanceStatus::Running) {
                Phase::Booting { host: HOST }
            } else {
                Phase::Restarting { host: HOST }
            }
        );
        assert!(operator.repo.events.lock().unwrap().contains(&(
            id,
            Event::MacrodMissing {
                instance_status: observed
            }
        )));
    }
}

#[tokio::test]
async fn replayed_crash_recovery_starts_idempotently_and_keeps_completion_on_failure() {
    let operator = operator(FakeFleet::default()).await;
    let id = paid_computer(&operator).await;
    operator.run_fleet_effects().await.unwrap();
    operator.repo.effects.lock().unwrap().clear();
    operator.repo.effects.lock().unwrap().push(PendingEffect {
        id: 30,
        computer_id: id,
        effect: Effect::Restart { host: HOST },
        attempts: 0,
    });
    operator.run_fleet_effects().await.unwrap();
    assert_eq!(
        *operator.fleet.calls.lock().unwrap(),
        vec![format!("start {id}")]
    );

    operator.repo.effects.lock().unwrap().push(PendingEffect {
        id: 31,
        computer_id: id,
        effect: Effect::Create {
            host: HOST,
            start: true,
            generation: EnrollmentGeneration::new(1),
        },
        attempts: 0,
    });
    operator.repo.fail_next_apply.store(true, Ordering::SeqCst);
    assert!(operator.run_fleet_effects().await.is_err());
    assert!(
        operator
            .repo
            .effects
            .lock()
            .unwrap()
            .iter()
            .any(|pending| pending.id == 31)
    );
}

#[tokio::test]
async fn daemon_restart_effect_is_ignored_after_reconnection() {
    for reconnected in [false, true] {
        let operator = operator(FakeFleet::default()).await;
        let id = paid_computer(&operator).await;
        operator.run_fleet_effects().await.unwrap();
        operator
            .repo
            .computers
            .lock()
            .unwrap()
            .get_mut(&id)
            .unwrap()
            .state
            .macrod_misses = crate::domain::lifecycle::MAX_MACROD_MISSES;
        if reconnected {
            operator.macrod_connected(HARNESS).await.unwrap();
        }
        operator.fleet.calls.lock().unwrap().clear();
        operator.repo.effects.lock().unwrap().push(PendingEffect {
            id: 30,
            computer_id: id,
            effect: Effect::RestartMacrod { host: HOST },
            attempts: 0,
        });
        operator.run_fleet_effects().await.unwrap();
        assert_eq!(
            *operator.fleet.calls.lock().unwrap(),
            if reconnected {
                vec![]
            } else {
                vec![format!("restart_macrod {id}")]
            }
        );
    }
}
