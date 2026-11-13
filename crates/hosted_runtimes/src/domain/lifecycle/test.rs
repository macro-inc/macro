mod redeploy;

use chrono::{DateTime, TimeZone, Utc};
use proptest::prelude::*;

use super::*;

mod billing;
mod comped;
mod instance_lost;
mod pool;

const HOST: HostId = HostId::new(uuid::Uuid::from_u128(
    0x0000_0000_0000_4000_8000_0000_0000_0001,
));

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 4, 12, 0, 0).unwrap()
}

fn item() -> SubscriptionItemId {
    "si_computer1".parse().unwrap()
}

fn policy() -> BillingPolicy {
    BillingPolicy::from_days(14, 7).unwrap()
}

/// A billed, powered-on computer in `phase`, for tests to adjust.
fn billed(phase: Phase) -> ComputerState {
    ComputerState {
        provision_traceparent: None,
        setup: None,
        phase,
        billing: Billing::Active {
            subscription_item: item(),
        },
        billing_changed_at: now() - Duration::days(30),
        power: Power::On,
        macrod_connected: false,
        macrod_misses: 0,
        recent_crashes: vec![],
        power_on_requested: false,
        capacity_wait: None,
        retried_by_team: false,
        failure: None,
    }
}

fn context(host_has_room: bool) -> Context {
    Context {
        host: HOST,
        enrollment_generation: crate::domain::enrollment::EnrollmentGeneration::new(0),
        now: now(),
        host_has_room,
        policy: policy(),
    }
}

#[test]
fn stopped_computer_starts_on_power_on() {
    let state = ComputerState {
        phase: Phase::Stopped,
        power: Power::Off,
        billing: Billing::Active {
            subscription_item: item(),
        },
        billing_changed_at: now() - Duration::days(3),
        macrod_connected: false,
        provision_traceparent: None,
        setup: None,
        macrod_misses: 0,
        recent_crashes: vec![],
        power_on_requested: false,
        capacity_wait: None,
        retried_by_team: false,
        failure: None,
    };

    let (next, effects) = transition(&state, &Event::PowerOn, context(true)).unwrap();

    assert_eq!(
        next,
        ComputerState {
            provision_traceparent: None,
            setup: None,
            phase: Phase::Booting,
            power: Power::On,
            billing: Billing::Active {
                subscription_item: item(),
            },
            billing_changed_at: now() - Duration::days(3),
            macrod_connected: false,
            macrod_misses: 0,
            recent_crashes: vec![],
            power_on_requested: false,
            capacity_wait: None,
            retried_by_team: false,
            failure: None,
        }
    );
    assert_eq!(
        effects,
        vec![
            Effect::Start { host: HOST },
            Effect::ScheduleTimer {
                kind: TimerKind::MacrodMissing,
                at: now() + MACROD_GRACE,
            },
        ]
    );
}

#[test]
fn a_confirmed_purchase_provisions_with_room() {
    let (state, effects) = provision(
        Billing::Active {
            subscription_item: item(),
        },
        Some(crate::domain::setup::SetupTimeline::started(
            now() - Duration::seconds(5),
        )),
        None,
        context(true),
    );

    assert_eq!(state.phase, Phase::Provisioning { start: true });
    assert_eq!(state.power, Power::On);
    assert!(!state.power_on_requested);
    assert_eq!(state.billing_changed_at, now());
    assert_eq!(
        effects,
        vec![Effect::Create {
            host: HOST,
            start: true,
            generation: crate::domain::enrollment::EnrollmentGeneration::new(1),
        }]
    );
}

#[test]
fn a_confirmed_purchase_on_a_full_host_creates_stopped_and_waits() {
    let (state, effects) = provision(
        Billing::Active {
            subscription_item: item(),
        },
        Some(crate::domain::setup::SetupTimeline::started(now())),
        None,
        context(false),
    );

    assert_eq!(state.phase, Phase::Provisioning { start: false });
    assert!(state.power_on_requested);
    assert_eq!(
        effects,
        vec![Effect::Create {
            host: HOST,
            start: false,
            generation: crate::domain::enrollment::EnrollmentGeneration::new(1),
        }]
    );
}

#[test]
fn backoff_doubles_from_its_first_delay_to_its_cap() {
    let delays: Vec<i64> = (0..8)
        .map(|attempt| backoff(CAPACITY_BACKOFF, attempt).num_seconds())
        .collect();
    assert_eq!(delays, vec![20, 40, 80, 160, 320, 600, 600, 600]);
    let restarts: Vec<i64> = (0..3)
        .map(|attempt| backoff(RESTART_BACKOFF, attempt).num_seconds())
        .collect();
    assert_eq!(restarts, vec![30, 60, 120]);
    assert_eq!(backoff(BILLING_BACKOFF, u8::MAX).num_seconds(), 3600);
}

struct Case {
    name: &'static str,
    phase: Phase,
    power: Power,
    billing: Billing,
    macrod_connected: bool,
    recent_crashes: Vec<DateTime<Utc>>,
    power_on_requested: bool,
    event: Event,
    host_has_room: bool,
    expected: Result<Expected, Rejected>,
}

struct Expected {
    phase: Phase,
    power: Power,
    billing: Billing,
    power_on_requested: bool,
    effects: Vec<Effect>,
}

fn active() -> Billing {
    Billing::Active {
        subscription_item: item(),
    }
}

fn cases() -> Vec<Case> {
    let at = now() + Duration::days(9);
    let ended = now() - Duration::days(1);
    vec![
        Case {
            name: "started instance boots",
            phase: Phase::Provisioning { start: true },
            power: Power::On,
            billing: active(),
            macrod_connected: false,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::InstanceStarted,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Booting,
                power: Power::On,
                billing: active(),
                power_on_requested: false,
                effects: vec![Effect::ScheduleTimer {
                    kind: TimerKind::MacrodMissing,
                    at: now() + MACROD_GRACE,
                }],
            }),
        },
        Case {
            name: "instance created stopped retries its power-on",
            phase: Phase::Provisioning { start: false },
            power: Power::On,
            billing: active(),
            macrod_connected: false,
            recent_crashes: vec![],
            power_on_requested: true,
            event: Event::InstanceStopped,
            host_has_room: false,
            expected: Ok(Expected {
                phase: Phase::Stopped,
                power: Power::On,
                billing: active(),
                power_on_requested: true,
                effects: vec![Effect::ScheduleTimer {
                    kind: TimerKind::PowerOnRetry,
                    at: now() + Duration::seconds(20),
                }],
            }),
        },
        Case {
            name: "macrod connecting makes it running",
            phase: Phase::Booting,
            power: Power::On,
            billing: active(),
            macrod_connected: false,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::MacrodConnected,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Running,
                power: Power::On,
                billing: active(),
                power_on_requested: false,
                effects: vec![],
            }),
        },
        Case {
            name: "macrod gone while running restarts after backoff",
            phase: Phase::Running,
            power: Power::On,
            billing: active(),
            macrod_connected: false,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::MacrodMissing {
                instance_status: None,
            },
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Crashed {
                    restarts: 1,
                    retry: Some(Retry {
                        attempt: 0,
                        next_at: now() + Duration::seconds(30),
                    }),
                },
                power: Power::On,
                billing: active(),
                power_on_requested: false,
                effects: vec![Effect::ScheduleTimer {
                    kind: TimerKind::RestartDue,
                    at: now() + Duration::seconds(30),
                }],
            }),
        },
        Case {
            name: "backoff doubles with each recent crash",
            phase: Phase::Running,
            power: Power::On,
            billing: active(),
            macrod_connected: true,
            recent_crashes: vec![now() - Duration::minutes(2)],
            power_on_requested: false,
            event: Event::VmCrashed,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Crashed {
                    restarts: 2,
                    retry: Some(Retry {
                        attempt: 1,
                        next_at: now() + Duration::seconds(60),
                    }),
                },
                power: Power::On,
                billing: active(),
                power_on_requested: false,
                effects: vec![Effect::ScheduleTimer {
                    kind: TimerKind::RestartDue,
                    at: now() + Duration::seconds(60),
                }],
            }),
        },
        Case {
            name: "third crash in the window gives up and pages",
            phase: Phase::Running,
            power: Power::On,
            billing: active(),
            macrod_connected: true,
            recent_crashes: vec![now() - Duration::minutes(10), now() - Duration::minutes(1)],
            power_on_requested: false,
            event: Event::VmCrashed,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Crashed {
                    restarts: 3,
                    retry: None,
                },
                power: Power::On,
                billing: active(),
                power_on_requested: false,
                effects: vec![Effect::PageOperator {
                    reason: "3 crashes in 15 minutes".to_owned(),
                }],
            }),
        },
        Case {
            name: "restart timer restarts once due",
            phase: Phase::Crashed {
                restarts: 1,
                retry: Some(Retry {
                    attempt: 0,
                    next_at: now(),
                }),
            },
            power: Power::On,
            billing: active(),
            macrod_connected: false,
            recent_crashes: vec![now() - Duration::minutes(1)],
            power_on_requested: false,
            event: Event::RestartDue,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Booting,
                power: Power::On,
                billing: active(),
                power_on_requested: false,
                effects: vec![
                    Effect::Restart { host: HOST },
                    Effect::ScheduleTimer {
                        kind: TimerKind::MacrodMissing,
                        at: now() + MACROD_GRACE,
                    },
                ],
            }),
        },
        Case {
            name: "a stale restart timer before the backoff changes nothing",
            phase: Phase::Crashed {
                restarts: 2,
                retry: Some(Retry {
                    attempt: 1,
                    next_at: now() + Duration::seconds(30),
                }),
            },
            power: Power::On,
            billing: active(),
            macrod_connected: false,
            recent_crashes: vec![now() - Duration::minutes(1), now()],
            power_on_requested: false,
            event: Event::RestartDue,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Crashed {
                    restarts: 2,
                    retry: Some(Retry {
                        attempt: 1,
                        next_at: now() + Duration::seconds(30),
                    }),
                },
                power: Power::On,
                billing: active(),
                power_on_requested: false,
                effects: vec![],
            }),
        },
        Case {
            name: "power off stops a running computer",
            phase: Phase::Running,
            power: Power::On,
            billing: active(),
            macrod_connected: true,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::PowerOff,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Stopping,
                power: Power::Off,
                billing: active(),
                power_on_requested: false,
                effects: vec![Effect::Stop { host: HOST }],
            }),
        },
        Case {
            name: "stop finishes",
            phase: Phase::Stopping,
            power: Power::Off,
            billing: active(),
            macrod_connected: false,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::InstanceStopped,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Stopped,
                power: Power::Off,
                billing: active(),
                power_on_requested: false,
                effects: vec![],
            }),
        },
        Case {
            name: "power on while stopping starts once stopped",
            phase: Phase::Stopping,
            power: Power::Off,
            billing: active(),
            macrod_connected: false,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::PowerOn,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Stopping,
                power: Power::On,
                billing: active(),
                power_on_requested: true,
                effects: vec![],
            }),
        },
        Case {
            name: "operator retry boots a computer that gave up",
            phase: Phase::Crashed {
                restarts: 3,
                retry: None,
            },
            power: Power::On,
            billing: active(),
            macrod_connected: false,
            recent_crashes: vec![now() - Duration::minutes(3)],
            power_on_requested: false,
            event: Event::OperatorRetry,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Booting,
                power: Power::On,
                billing: active(),
                power_on_requested: false,
                effects: vec![
                    Effect::Restart { host: HOST },
                    Effect::ScheduleTimer {
                        kind: TimerKind::MacrodMissing,
                        at: now() + MACROD_GRACE,
                    },
                ],
            }),
        },
        Case {
            name: "operator retry on a running computer is rejected",
            phase: Phase::Running,
            power: Power::On,
            billing: active(),
            macrod_connected: true,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::OperatorRetry,
            host_has_room: true,
            expected: Err(Rejected::NotFailed),
        },
        Case {
            name: "operator retry with the host full waits for room",
            phase: Phase::Crashed {
                restarts: 3,
                retry: None,
            },
            power: Power::On,
            billing: active(),
            macrod_connected: false,
            recent_crashes: vec![now() - Duration::minutes(3)],
            power_on_requested: false,
            event: Event::OperatorRetry,
            host_has_room: false,
            expected: Ok(Expected {
                phase: Phase::Stopped,
                power: Power::On,
                billing: active(),
                power_on_requested: true,
                effects: vec![Effect::ScheduleTimer {
                    kind: TimerKind::PowerOnRetry,
                    at: now() + Duration::seconds(20),
                }],
            }),
        },
        Case {
            name: "lost host gives up and pages",
            phase: Phase::Running,
            power: Power::On,
            billing: active(),
            macrod_connected: true,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::HostLost,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Crashed {
                    restarts: 0,
                    retry: None,
                },
                power: Power::On,
                billing: active(),
                power_on_requested: false,
                effects: vec![Effect::PageOperator {
                    reason: "host lost".to_owned(),
                }],
            }),
        },
        Case {
            name: "effect failure gives up and pages",
            phase: Phase::Booting,
            power: Power::On,
            billing: active(),
            macrod_connected: false,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::EffectFailed {
                failure: Failure::Create,
                reason: "create failed".to_owned(),
            },
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Crashed {
                    restarts: 0,
                    retry: None,
                },
                power: Power::On,
                billing: active(),
                power_on_requested: false,
                effects: vec![Effect::PageOperator {
                    reason: "create failed".to_owned(),
                }],
            }),
        },
        Case {
            name: "cancel removes the item at once and keeps running until the period ends",
            phase: Phase::Running,
            power: Power::On,
            billing: active(),
            macrod_connected: true,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::CancelAtPeriodEnd { at },
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Running,
                power: Power::On,
                billing: Billing::EndsAt { at },
                power_on_requested: false,
                effects: vec![
                    Effect::RemoveBillingItem {
                        subscription_item: item(),
                    },
                    Effect::ScheduleTimer {
                        kind: TimerKind::BillingEnds,
                        at,
                    },
                ],
            }),
        },
        Case {
            name: "the period end stops and starts retention without touching billing",
            phase: Phase::Running,
            power: Power::On,
            billing: Billing::EndsAt { at: now() },
            macrod_connected: true,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::BillingEnds,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Stopping,
                power: Power::Off,
                billing: Billing::EndsAt { at: now() },
                power_on_requested: false,
                effects: vec![
                    Effect::Stop { host: HOST },
                    Effect::ScheduleTimer {
                        kind: TimerKind::RetentionExpired,
                        at: now() + Duration::days(14),
                    },
                ],
            }),
        },
        Case {
            name: "the period end after an undo is ignored",
            phase: Phase::Running,
            power: Power::On,
            billing: active(),
            macrod_connected: true,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::BillingEnds,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Running,
                power: Power::On,
                billing: active(),
                power_on_requested: false,
                effects: vec![],
            }),
        },
        Case {
            name: "undo before the period ends bills the re-added item",
            phase: Phase::Running,
            power: Power::On,
            billing: Billing::EndsAt { at },
            macrod_connected: true,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::UndoCancel {
                subscription_item: "si_readded".parse().unwrap(),
            },
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Running,
                power: Power::On,
                billing: Billing::Active {
                    subscription_item: "si_readded".parse().unwrap(),
                },
                power_on_requested: false,
                effects: vec![],
            }),
        },
        Case {
            name: "undo after the period ended is rejected",
            phase: Phase::Stopped,
            power: Power::Off,
            billing: Billing::EndsAt { at: ended },
            macrod_connected: false,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::UndoCancel {
                subscription_item: "si_readded".parse().unwrap(),
            },
            host_has_room: true,
            expected: Err(Rejected::BillingEnded),
        },
        Case {
            name: "undo of a billed computer is rejected",
            phase: Phase::Running,
            power: Power::On,
            billing: active(),
            macrod_connected: true,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::UndoCancel {
                subscription_item: "si_readded".parse().unwrap(),
            },
            host_has_room: true,
            expected: Err(Rejected::NotCanceled),
        },
        Case {
            name: "cancel twice is rejected",
            phase: Phase::Running,
            power: Power::On,
            billing: Billing::EndsAt { at },
            macrod_connected: true,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::CancelAtPeriodEnd { at },
            host_has_room: true,
            expected: Err(Rejected::AlreadyCanceled),
        },
        Case {
            name: "a computer whose billing ended cannot be powered on",
            phase: Phase::Stopped,
            power: Power::Off,
            billing: Billing::EndsAt { at: ended },
            macrod_connected: false,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::PowerOn,
            host_has_room: true,
            expected: Err(Rejected::BillingEnded),
        },
        Case {
            name: "retention end destroys",
            phase: Phase::Stopped,
            power: Power::Off,
            billing: Billing::EndsAt {
                at: now() - Duration::days(14),
            },
            macrod_connected: false,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::RetentionExpired,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Destroying,
                power: Power::Off,
                billing: Billing::EndsAt {
                    at: now() - Duration::days(14),
                },
                power_on_requested: false,
                effects: vec![Effect::Destroy { host: HOST }, Effect::RevokeHarness],
            }),
        },
        Case {
            name: "a retention timer of a restored computer is ignored",
            phase: Phase::Stopped,
            power: Power::Off,
            billing: active(),
            macrod_connected: false,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::RetentionExpired,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Stopped,
                power: Power::Off,
                billing: active(),
                power_on_requested: false,
                effects: vec![],
            }),
        },
        Case {
            name: "release now removes the item and destroys",
            phase: Phase::Running,
            power: Power::On,
            billing: active(),
            macrod_connected: true,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::ReleaseNow,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Destroying,
                power: Power::On,
                billing: Billing::EndsAt { at: now() },
                power_on_requested: false,
                effects: vec![
                    Effect::RemoveBillingItem {
                        subscription_item: item(),
                    },
                    Effect::Destroy { host: HOST },
                    Effect::RevokeHarness,
                ],
            }),
        },
        Case {
            name: "release now of a canceled computer does not remove the item twice",
            phase: Phase::Running,
            power: Power::On,
            billing: Billing::EndsAt { at },
            macrod_connected: true,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::ReleaseNow,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Destroying,
                power: Power::On,
                billing: Billing::EndsAt { at: now() },
                power_on_requested: false,
                effects: vec![Effect::Destroy { host: HOST }, Effect::RevokeHarness],
            }),
        },
        Case {
            name: "a released computer rejects requests",
            phase: Phase::Destroying,
            power: Power::Off,
            billing: active(),
            macrod_connected: false,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::PowerOn,
            host_has_room: true,
            expected: Err(Rejected::Released),
        },
        Case {
            name: "a released computer ignores observations",
            phase: Phase::Destroying,
            power: Power::Off,
            billing: active(),
            macrod_connected: false,
            recent_crashes: vec![],
            power_on_requested: false,
            event: Event::VmCrashed,
            host_has_room: true,
            expected: Ok(Expected {
                phase: Phase::Destroying,
                power: Power::Off,
                billing: active(),
                power_on_requested: false,
                effects: vec![],
            }),
        },
    ]
}

#[test]
fn transitions() {
    check(cases());
}

fn check(cases: Vec<Case>) {
    for case in cases {
        let state = ComputerState {
            provision_traceparent: None,
            setup: None,
            phase: case.phase,
            power: case.power,
            billing: case.billing,
            billing_changed_at: now() - Duration::days(30),
            macrod_connected: case.macrod_connected,
            macrod_misses: 0,
            recent_crashes: case.recent_crashes,
            power_on_requested: case.power_on_requested,
            capacity_wait: None,
            retried_by_team: false,
            failure: None,
        };

        let outcome = transition(&state, &case.event, context(case.host_has_room));

        match (outcome, case.expected) {
            (Ok((next, effects)), Ok(expected)) => {
                assert_eq!(next.phase, expected.phase, "{}: phase", case.name);
                assert_eq!(next.power, expected.power, "{}: power", case.name);
                assert_eq!(next.billing, expected.billing, "{}: billing", case.name);
                assert_eq!(
                    next.power_on_requested, expected.power_on_requested,
                    "{}: power_on_requested",
                    case.name
                );
                assert_eq!(effects, expected.effects, "{}: effects", case.name);
            }
            (Err(rejected), Err(expected)) => assert_eq!(rejected, expected, "{}", case.name),
            (Ok(_), Err(expected)) => panic!("{}: expected {expected:?}", case.name),
            (Err(rejected), Ok(_)) => panic!("{}: rejected with {rejected:?}", case.name),
        }
    }
}

fn any_event() -> impl Strategy<Value = Event> {
    prop_oneof![
        Just(Event::InstanceStarted),
        Just(Event::InstanceStopped),
        Just(Event::MacrodConnected),
        Just(Event::MacrodDisconnected),
        Just(Event::MacrodMissing {
            instance_status: None
        }),
        Just(Event::MacrodMissing {
            instance_status: Some(InstanceStatus::Running)
        }),
        Just(Event::MacrodMissing {
            instance_status: Some(InstanceStatus::Stopped)
        }),
        Just(Event::VmCrashed),
        Just(Event::InstanceLost),
        Just(Event::RestartDue),
        Just(Event::HostLost),
        Just(Event::PowerOn),
        Just(Event::PowerOff),
        Just(Event::PowerOnRetry),
        Just(Event::CapacityChanged),
        (1i64..60).prop_map(|days| Event::CancelAtPeriodEnd {
            at: now() + Duration::days(days)
        }),
        Just(Event::UndoCancel {
            subscription_item: "si_readded".parse().unwrap()
        }),
        Just(Event::Restore {
            billing: Billing::Active {
                subscription_item: "si_restored".parse().unwrap()
            }
        }),
        Just(Event::BillingEnds),
        Just(Event::PastDueGrace),
        Just(Event::ReleaseNow),
        Just(Event::RetentionExpired),
        Just(Event::OperatorRetry),
        Just(Event::EffectFailed {
            failure: Failure::Create,
            reason: "boom".to_owned()
        }),
    ]
}

/// One host of `capacity` units with computers of the given sizes, driven
/// the way the applier drives them: room is computed from the others.
struct Fleet {
    capacity: u32,
    computers: Vec<(u32, ComputerState)>,
}

impl Fleet {
    fn awake_units(&self) -> u32 {
        self.computers
            .iter()
            .filter(|(_, state)| state.is_awake())
            .map(|(units, _)| units)
            .sum()
    }

    fn apply(&mut self, index: usize, event: &Event, at: DateTime<Utc>) -> Vec<Effect> {
        let (units, state) = &self.computers[index];
        let others = self.awake_units() - if state.is_awake() { *units } else { 0 };
        let context = Context {
            host: HOST,
            enrollment_generation: crate::domain::enrollment::EnrollmentGeneration::new(0),
            now: at,
            host_has_room: others + units <= self.capacity,
            policy: policy(),
        };
        match transition(state, event, context) {
            Ok((next, effects)) => {
                self.computers[index].1 = next;
                effects
            }
            Err(_) => Vec::new(),
        }
    }
}

proptest! {
    #[test]
    fn invariants(
        sizes in proptest::collection::vec(prop_oneof![Just(1u32), Just(2), Just(4)], 1..5),
        steps in proptest::collection::vec((0usize..5, any_event(), 0i64..(60 * 24 * 3)), 1..200),
    ) {
        let mut fleet = Fleet {
            capacity: 4,
            computers: sizes
                .iter()
                .map(|units| {
                    let (state, _) = provision(
                        active(),
                        Some(crate::domain::setup::SetupTimeline::started(now())),
                        None,
                        Context {
                            host: HOST,
                            enrollment_generation: crate::domain::enrollment::EnrollmentGeneration::new(0),
                            now: now(),
                            host_has_room: false,
                            policy: policy(),
                        },
                    );
                    (*units, state)
                })
                .collect(),
        };
        let mut at = now();
        let mut removed = std::collections::HashSet::new();

        for (index, event, minutes) in steps {
            let index = index % fleet.computers.len();
            at += Duration::minutes(minutes);
            let before = fleet.computers[index].1.clone();
            let effects = fleet.apply(index, &event, at);
            let after = fleet.computers[index].1.clone();
            // Undo and restore bill an item again; it may be removed again later.
            if let Some(rebilled) = after.billing.subscription_item()
                && before.billing.subscription_item() != Some(rebilled)
            {
                removed.remove(&(index, rebilled.clone()));
            }

            for effect in &effects {
                if let Effect::RemoveBillingItem { subscription_item } = effect {
                    prop_assert_eq!(Some(subscription_item), before.billing.subscription_item(), "only the billed item is removed");
                    prop_assert!(removed.insert((index, subscription_item.clone())), "an item is removed once");
                    prop_assert!(after.billing.subscription_item().is_none(), "a removed item no longer bills");
                }
            }
            if before.phase == Phase::Destroying {
                prop_assert_eq!(&after, &before);
                prop_assert!(effects.is_empty());
            }
            if after.phase == Phase::Destroying && before.phase != Phase::Destroying {
                prop_assert!(effects.contains(&Effect::Destroy { host: HOST }), "destroying always destroys the guest and its volume");
                prop_assert!(effects.contains(&Effect::RevokeHarness));
            }
            if effects.iter().any(|effect| matches!(effect, Effect::Start { .. })) {
                prop_assert_eq!(&before.phase, &Phase::Stopped, "start begins from a stopped computer");
            }
            if after.power == Power::Off {
                prop_assert_ne!(&after.phase, &Phase::Running, "declared off but running");
            }
            if after.phase == Phase::Destroying {
                prop_assert!(after.billing.subscription_item().is_none(), "a released computer is not billed");
            }
            prop_assert!(fleet.awake_units() <= fleet.capacity);
        }
    }
}

mod generation;

mod capacity;

/// A computer that gave up, as a team or an operator retries it.
fn gave_up() -> ComputerState {
    billed(Phase::Crashed {
        restarts: 3,
        retry: None,
    })
}

#[test]
fn a_team_retry_that_gives_up_again_is_logged_not_paged() {
    let (retried, _) = transition(&gave_up(), &Event::TeamRetry, context(true)).unwrap();
    assert!(retried.retried_by_team);

    let (again, effects) = transition(
        &retried,
        &Event::EffectFailed {
            failure: Failure::Create,
            reason: "create failed".to_owned(),
        },
        context(true),
    )
    .unwrap();

    assert_eq!(
        again.phase,
        Phase::Crashed {
            restarts: 0,
            retry: None,
        }
    );
    assert_eq!(effects, vec![]);
}

#[test]
fn a_give_up_records_why_and_a_retry_clears_it() {
    let (failed, _) = transition(&billed(Phase::Running), &Event::HostLost, context(true)).unwrap();
    assert_eq!(failed.failure, Some(Failure::HostLost));

    let (retried, _) = transition(&failed, &Event::TeamRetry, context(true)).unwrap();
    assert_eq!(retried.failure, None);
}

#[test]
fn a_boot_after_a_team_retry_pages_the_next_give_up_again() {
    let (retried, _) = transition(&gave_up(), &Event::TeamRetry, context(true)).unwrap();
    let (running, _) = transition(&retried, &Event::MacrodConnected, context(true)).unwrap();
    assert_eq!(running.phase, Phase::Running);
    assert!(!running.retried_by_team);

    let (_, effects) = transition(&running, &Event::HostLost, context(true)).unwrap();

    assert_eq!(
        effects,
        vec![Effect::PageOperator {
            reason: "host lost".to_owned(),
        }]
    );
}

#[test]
fn an_operator_retry_still_pages_a_later_give_up() {
    let (retried, _) = transition(&gave_up(), &Event::OperatorRetry, context(true)).unwrap();
    assert!(!retried.retried_by_team);
}

#[test]
fn a_state_row_written_before_team_retries_still_decodes() {
    let mut row = serde_json::to_value(billed(Phase::Running)).unwrap();
    row.as_object_mut().unwrap().remove("retried_by_team");

    let state: ComputerState = serde_json::from_value(row).unwrap();

    assert!(!state.retried_by_team);
}

#[test]
fn a_team_retry_of_a_powered_off_computer_leaves_nothing_to_unpage() {
    let mut off = gave_up();
    off.power = Power::Off;

    let (stopped, _) = transition(&off, &Event::TeamRetry, context(true)).unwrap();

    // It does not boot, so nothing would clear the mark before a later
    // give-up, which must page.
    assert_eq!(stopped.phase, Phase::Stopped);
    assert!(!stopped.retried_by_team);
}
