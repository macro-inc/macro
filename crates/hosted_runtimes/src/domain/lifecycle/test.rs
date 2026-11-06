mod redeploy;

use chrono::{DateTime, TimeZone, Utc};
use proptest::prelude::*;

use super::*;

mod comped;
mod instance_lost;
mod payment;

const HOST: HostId = HostId::new(uuid::Uuid::from_u128(
    0x0000_0000_0000_4000_8000_0000_0000_0001,
));

fn now() -> DateTime<Utc> {
    Utc.with_ymd_and_hms(2026, 11, 4, 12, 0, 0).unwrap()
}

#[test]
fn suspended_computer_with_saved_state_resumes_on_prompt() {
    let state = ComputerState {
        phase: Phase::Suspended {
            host: HOST,
            saved_state: true,
        },
        power: Power::On,
        billing: Billing::Active,
        payment: PaymentOutcome::Paid,
        comp_reason: None,
        macrod_connected: false,
        macrod_misses: 0,
        recent_crashes: vec![],
        wake_requested: false,
        capacity_wait: None,
    };

    let (next, effects) = transition(
        &state,
        &Event::PromptArrived,
        Context {
            enrollment_generation: crate::domain::persona_credentials::EnrollmentGeneration::new(0),
            now: now(),
            host_has_room: true,
        },
    );

    assert_eq!(
        next,
        ComputerState {
            phase: Phase::Booting { host: HOST },
            power: Power::On,
            billing: Billing::Active,
            payment: PaymentOutcome::Paid,
            comp_reason: None,
            macrod_connected: false,
            macrod_misses: 0,
            recent_crashes: vec![],
            wake_requested: false,
            capacity_wait: None,
        }
    );
    assert_eq!(
        effects,
        vec![
            Effect::Resume { host: HOST },
            Effect::ScheduleTimer {
                kind: TimerKind::MacrodMissing,
                at: now() + MACROD_GRACE,
            },
        ]
    );
}

struct Case {
    name: &'static str,
    phase: Phase,
    power: Power,
    billing: Billing,
    macrod_connected: bool,
    recent_crashes: Vec<DateTime<Utc>>,
    wake_requested: bool,
    event: Event,
    host_has_room: bool,
    expected_phase: Phase,
    expected_power: Power,
    expected_billing: Billing,
    expected_wake_requested: bool,
    expected_effects: Vec<Effect>,
}

fn cases() -> Vec<Case> {
    let at = now() + Duration::days(9);
    vec![
        Case {
            name: "payment with room creates and starts",
            phase: Phase::PendingPayment {
                host: HOST,
                since: now(),
            },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::PaymentConfirmed,
            host_has_room: true,
            expected_phase: Phase::Provisioning {
                host: HOST,
                start: true,
            },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![Effect::Create {
                host: HOST,
                start: true,
                generation: crate::domain::persona_credentials::EnrollmentGeneration::new(1),
            }],
        },
        Case {
            name: "payment on a full host creates stopped and waits to wake",
            phase: Phase::PendingPayment {
                host: HOST,
                since: now(),
            },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::PaymentConfirmed,
            host_has_room: false,
            expected_phase: Phase::Provisioning {
                host: HOST,
                start: false,
            },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: true,
            expected_effects: vec![Effect::Create {
                host: HOST,
                start: false,
                generation: crate::domain::persona_credentials::EnrollmentGeneration::new(1),
            }],
        },
        Case {
            name: "failed purchase releases capacity but keeps a visible row",
            phase: Phase::PendingPayment {
                host: HOST,
                since: now(),
            },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::PurchaseFailed,
            host_has_room: true,
            expected_phase: Phase::PaymentFailed,
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![],
        },
        Case {
            name: "failed payment ignores confirmation",
            phase: Phase::PaymentFailed,
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::PaymentConfirmed,
            host_has_room: true,
            expected_phase: Phase::PaymentFailed,
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![],
        },
        Case {
            name: "failed payment ignores power on",
            phase: Phase::PaymentFailed,
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::PowerOn,
            host_has_room: true,
            expected_phase: Phase::PaymentFailed,
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![],
        },
        Case {
            name: "failed payment can be cleared without billing",
            phase: Phase::PaymentFailed,
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::ReleaseNow,
            host_has_room: true,
            expected_phase: Phase::Destroyed,
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![],
        },
        Case {
            name: "started instance boots",
            phase: Phase::Provisioning {
                host: HOST,
                start: true,
            },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::InstanceStarted,
            host_has_room: true,
            expected_phase: Phase::Booting { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![Effect::ScheduleTimer {
                kind: TimerKind::MacrodMissing,
                at: now() + MACROD_GRACE,
            }],
        },
        Case {
            name: "instance created stopped retries its wake",
            phase: Phase::Provisioning {
                host: HOST,
                start: false,
            },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: true,
            event: Event::InstanceStopped,
            host_has_room: false,
            expected_phase: Phase::Stopped { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: true,
            expected_effects: vec![Effect::ScheduleTimer {
                kind: TimerKind::WakeRetry,
                at: now() + WAKE_RETRY,
            }],
        },
        Case {
            name: "macrod connecting makes it running",
            phase: Phase::Booting { host: HOST },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: true,
            event: Event::MacrodConnected,
            host_has_room: true,
            expected_phase: Phase::Running { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![],
        },
        Case {
            name: "idle sessions freeze and schedule a suspend",
            phase: Phase::Running { host: HOST },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: true,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::SessionsIdle,
            host_has_room: true,
            expected_phase: Phase::Frozen { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![
                Effect::Freeze { host: HOST },
                Effect::ScheduleTimer {
                    kind: TimerKind::SuspendDue,
                    at: now() + SUSPEND_AFTER,
                },
            ],
        },
        Case {
            name: "prompt unfreezes",
            phase: Phase::Frozen { host: HOST },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: true,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::PromptArrived,
            host_has_room: false,
            expected_phase: Phase::Running { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![Effect::Unfreeze { host: HOST }],
        },
        Case {
            name: "frozen long enough suspends",
            phase: Phase::Frozen { host: HOST },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: true,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::SuspendDue,
            host_has_room: true,
            expected_phase: Phase::Suspended {
                host: HOST,
                saved_state: false,
            },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![Effect::Suspend { host: HOST }],
        },
        Case {
            name: "prompt before the snapshot finishes waits for it",
            phase: Phase::Suspended {
                host: HOST,
                saved_state: false,
            },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::PromptArrived,
            host_has_room: true,
            expected_phase: Phase::Suspended {
                host: HOST,
                saved_state: false,
            },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: true,
            expected_effects: vec![],
        },
        Case {
            name: "snapshot saved with a waiting prompt resumes",
            phase: Phase::Suspended {
                host: HOST,
                saved_state: false,
            },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: true,
            event: Event::SnapshotSaved,
            host_has_room: true,
            expected_phase: Phase::Booting { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![
                Effect::Resume { host: HOST },
                Effect::ScheduleTimer {
                    kind: TimerKind::MacrodMissing,
                    at: now() + MACROD_GRACE,
                },
            ],
        },
        Case {
            name: "prompt on a full host makes room and retries",
            phase: Phase::Suspended {
                host: HOST,
                saved_state: true,
            },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::PromptArrived,
            host_has_room: false,
            expected_phase: Phase::Suspended {
                host: HOST,
                saved_state: true,
            },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: true,
            expected_effects: vec![
                Effect::MakeRoom { host: HOST },
                Effect::ScheduleTimer {
                    kind: TimerKind::WakeRetry,
                    at: now() + WAKE_RETRY,
                },
            ],
        },
        Case {
            name: "macrod gone while running restarts after backoff",
            phase: Phase::Running { host: HOST },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::MacrodMissing {
                instance_status: None,
            },
            host_has_room: true,
            expected_phase: Phase::Restarting { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![Effect::ScheduleTimer {
                kind: TimerKind::RestartDue,
                at: now() + RESTART_BACKOFF,
            }],
        },
        Case {
            name: "backoff doubles with each recent crash",
            phase: Phase::Running { host: HOST },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: true,
            recent_crashes: vec![now() - Duration::minutes(2)],
            wake_requested: false,
            event: Event::VmCrashed,
            host_has_room: true,
            expected_phase: Phase::Restarting { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![Effect::ScheduleTimer {
                kind: TimerKind::RestartDue,
                at: now() + RESTART_BACKOFF * 2,
            }],
        },
        Case {
            name: "third crash in the window fails and pages",
            phase: Phase::Booting { host: HOST },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![now() - Duration::minutes(10), now() - Duration::minutes(1)],
            wake_requested: false,
            event: Event::VmCrashed,
            host_has_room: true,
            expected_phase: Phase::Failed { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![Effect::PageOperator {
                reason: "3 crashes in 15 minutes".to_owned(),
            }],
        },
        Case {
            name: "restart timer restarts",
            phase: Phase::Restarting { host: HOST },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![now() - Duration::minutes(1)],
            wake_requested: false,
            event: Event::RestartDue,
            host_has_room: true,
            expected_phase: Phase::Booting { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![
                Effect::Restart { host: HOST },
                Effect::ScheduleTimer {
                    kind: TimerKind::MacrodMissing,
                    at: now() + MACROD_GRACE,
                },
            ],
        },
        Case {
            name: "power off stops a running computer",
            phase: Phase::Running { host: HOST },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: true,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::PowerOff,
            host_has_room: true,
            expected_phase: Phase::Stopping { host: HOST },
            expected_power: Power::Off,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![Effect::Stop { host: HOST }],
        },
        Case {
            name: "power off keeps a suspended computer's state as stopped",
            phase: Phase::Suspended {
                host: HOST,
                saved_state: true,
            },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: true,
            event: Event::PowerOff,
            host_has_room: true,
            expected_phase: Phase::Stopped { host: HOST },
            expected_power: Power::Off,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![],
        },
        Case {
            name: "stop finishes",
            phase: Phase::Stopping { host: HOST },
            power: Power::Off,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::InstanceStopped,
            host_has_room: true,
            expected_phase: Phase::Stopped { host: HOST },
            expected_power: Power::Off,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![],
        },
        Case {
            name: "prompt does not wake a computer turned off",
            phase: Phase::Stopped { host: HOST },
            power: Power::Off,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::PromptArrived,
            host_has_room: true,
            expected_phase: Phase::Stopped { host: HOST },
            expected_power: Power::Off,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![],
        },
        Case {
            name: "power on starts a stopped computer",
            phase: Phase::Stopped { host: HOST },
            power: Power::Off,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::PowerOn,
            host_has_room: true,
            expected_phase: Phase::Booting { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![
                Effect::Start { host: HOST },
                Effect::ScheduleTimer {
                    kind: TimerKind::MacrodMissing,
                    at: now() + MACROD_GRACE,
                },
            ],
        },
        Case {
            name: "power on while stopping wakes once stopped",
            phase: Phase::Stopping { host: HOST },
            power: Power::Off,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::PowerOn,
            host_has_room: true,
            expected_phase: Phase::Stopping { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: true,
            expected_effects: vec![],
        },
        Case {
            name: "operator retry boots a failed computer",
            phase: Phase::Failed { host: HOST },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![now() - Duration::minutes(3)],
            wake_requested: false,
            event: Event::OperatorRetry,
            host_has_room: true,
            expected_phase: Phase::Booting { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![
                Effect::Restart { host: HOST },
                Effect::ScheduleTimer {
                    kind: TimerKind::MacrodMissing,
                    at: now() + MACROD_GRACE,
                },
            ],
        },
        Case {
            name: "operator retry on a running computer is ignored",
            phase: Phase::Running { host: HOST },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: true,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::OperatorRetry,
            host_has_room: true,
            expected_phase: Phase::Running { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![],
        },
        Case {
            name: "operator retry with the host full waits for room",
            phase: Phase::Failed { host: HOST },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![now() - Duration::minutes(3)],
            wake_requested: false,
            event: Event::OperatorRetry,
            host_has_room: false,
            expected_phase: Phase::Stopped { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: true,
            expected_effects: vec![
                Effect::MakeRoom { host: HOST },
                Effect::ScheduleTimer {
                    kind: TimerKind::WakeRetry,
                    at: now() + WAKE_RETRY,
                },
            ],
        },
        Case {
            name: "lost host fails and pages",
            phase: Phase::Running { host: HOST },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: true,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::HostLost,
            host_has_room: true,
            expected_phase: Phase::Failed { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![Effect::PageOperator {
                reason: "host lost".to_owned(),
            }],
        },
        Case {
            name: "cancel at period end schedules the end",
            phase: Phase::Running { host: HOST },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: true,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::CancelAtPeriodEnd { at },
            host_has_room: true,
            expected_phase: Phase::Running { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::CancelAtPeriodEnd { at },
            expected_wake_requested: false,
            expected_effects: vec![Effect::ScheduleTimer {
                kind: TimerKind::PeriodEnded,
                at,
            }],
        },
        Case {
            name: "undo keeps billing",
            phase: Phase::Running { host: HOST },
            power: Power::On,
            billing: Billing::CancelAtPeriodEnd { at },
            macrod_connected: true,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::UndoCancel,
            host_has_room: true,
            expected_phase: Phase::Running { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![],
        },
        Case {
            name: "period end removes the item, stops and retains",
            phase: Phase::Running { host: HOST },
            power: Power::On,
            billing: Billing::CancelAtPeriodEnd { at: now() },
            macrod_connected: true,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::PeriodEnded,
            host_has_room: true,
            expected_phase: Phase::Stopping { host: HOST },
            expected_power: Power::Off,
            expected_billing: Billing::Canceled {
                retained_until: now() + RETENTION,
            },
            expected_wake_requested: false,
            expected_effects: vec![
                Effect::RemoveBillingItem,
                Effect::Stop { host: HOST },
                Effect::ScheduleTimer {
                    kind: TimerKind::RetentionExpired,
                    at: now() + RETENTION,
                },
            ],
        },
        Case {
            name: "period end after undo is ignored",
            phase: Phase::Running { host: HOST },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: true,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::PeriodEnded,
            host_has_room: true,
            expected_phase: Phase::Running { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![],
        },
        Case {
            name: "subscription canceled elsewhere stops and retains without touching billing",
            phase: Phase::Stopped { host: HOST },
            power: Power::Off,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::SubscriptionCanceled,
            host_has_room: true,
            expected_phase: Phase::Stopped { host: HOST },
            expected_power: Power::Off,
            expected_billing: Billing::Canceled {
                retained_until: now() + RETENTION,
            },
            expected_wake_requested: false,
            expected_effects: vec![Effect::ScheduleTimer {
                kind: TimerKind::RetentionExpired,
                at: now() + RETENTION,
            }],
        },
        Case {
            name: "a canceled computer cannot be powered on",
            phase: Phase::Stopped { host: HOST },
            power: Power::Off,
            billing: Billing::Canceled {
                retained_until: now() + RETENTION,
            },
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::PowerOn,
            host_has_room: true,
            expected_phase: Phase::Stopped { host: HOST },
            expected_power: Power::Off,
            expected_billing: Billing::Canceled {
                retained_until: now() + RETENTION,
            },
            expected_wake_requested: false,
            expected_effects: vec![],
        },
        Case {
            name: "retention end destroys",
            phase: Phase::Stopped { host: HOST },
            power: Power::Off,
            billing: Billing::Canceled {
                retained_until: now(),
            },
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::RetentionExpired,
            host_has_room: true,
            expected_phase: Phase::Destroyed,
            expected_power: Power::Off,
            expected_billing: Billing::Canceled {
                retained_until: now(),
            },
            expected_wake_requested: false,
            expected_effects: vec![Effect::Destroy { host: HOST }, Effect::RevokeHarness],
        },
        Case {
            name: "release now stops billing and destroys",
            phase: Phase::Frozen { host: HOST },
            power: Power::On,
            billing: Billing::CancelAtPeriodEnd { at },
            macrod_connected: true,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::ReleaseNow,
            host_has_room: true,
            expected_phase: Phase::Destroyed,
            expected_power: Power::On,
            expected_billing: Billing::CancelAtPeriodEnd { at },
            expected_wake_requested: false,
            expected_effects: vec![
                Effect::RemoveBillingItem,
                Effect::Destroy { host: HOST },
                Effect::RevokeHarness,
            ],
        },
        Case {
            name: "release now of a canceled computer only destroys",
            phase: Phase::Stopped { host: HOST },
            power: Power::Off,
            billing: Billing::Canceled { retained_until: at },
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::ReleaseNow,
            host_has_room: true,
            expected_phase: Phase::Destroyed,
            expected_power: Power::Off,
            expected_billing: Billing::Canceled { retained_until: at },
            expected_wake_requested: false,
            expected_effects: vec![Effect::Destroy { host: HOST }, Effect::RevokeHarness],
        },
        Case {
            name: "effect failure fails and pages",
            phase: Phase::Provisioning {
                host: HOST,
                start: true,
            },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::EffectFailed {
                reason: "image missing".to_owned(),
            },
            host_has_room: true,
            expected_phase: Phase::Failed { host: HOST },
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![Effect::PageOperator {
                reason: "image missing".to_owned(),
            }],
        },
        Case {
            name: "destroyed ignores everything",
            phase: Phase::Destroyed,
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: vec![],
            wake_requested: false,
            event: Event::PowerOn,
            host_has_room: true,
            expected_phase: Phase::Destroyed,
            expected_power: Power::On,
            expected_billing: Billing::Active,
            expected_wake_requested: false,
            expected_effects: vec![],
        },
    ]
}

#[test]
fn transitions() {
    for case in cases() {
        let payment = match case.phase {
            Phase::PendingPayment { .. } => PaymentOutcome::Pending,
            Phase::PaymentFailed => PaymentOutcome::Unbilled,
            _ => PaymentOutcome::Paid,
        };
        let state = ComputerState {
            payment,
            comp_reason: None,
            phase: case.phase,
            power: case.power,
            billing: case.billing,
            macrod_connected: case.macrod_connected,
            macrod_misses: 0,
            recent_crashes: case.recent_crashes,
            wake_requested: case.wake_requested,
            capacity_wait: None,
        };

        let (next, effects) = transition(
            &state,
            &case.event,
            Context {
                enrollment_generation:
                    crate::domain::persona_credentials::EnrollmentGeneration::new(0),
                now: now(),
                host_has_room: case.host_has_room,
            },
        );

        assert_eq!(next.phase, case.expected_phase, "{}: phase", case.name);
        assert_eq!(next.power, case.expected_power, "{}: power", case.name);
        assert_eq!(
            next.billing, case.expected_billing,
            "{}: billing",
            case.name
        );
        assert_eq!(
            next.wake_requested, case.expected_wake_requested,
            "{}: wake_requested",
            case.name
        );
        assert_eq!(effects, case.expected_effects, "{}: effects", case.name);
    }
}

fn any_event() -> impl Strategy<Value = Event> {
    prop_oneof![
        Just(Event::PaymentConfirmed),
        Just(Event::Comped {
            reason: "internal team".to_owned()
        }),
        Just(Event::PurchaseFailed),
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
        Just(Event::SessionsIdle),
        Just(Event::PromptArrived),
        Just(Event::SuspendDue),
        Just(Event::SnapshotSaved),
        Just(Event::VmCrashed),
        Just(Event::InstanceLost),
        Just(Event::RestartDue),
        Just(Event::HostLost),
        Just(Event::PowerOn),
        Just(Event::PowerOff),
        Just(Event::WakeRetry),
        Just(Event::CapacityChanged),
        Just(Event::RoomUnavailable),
        (1i64..60).prop_map(|days| Event::CancelAtPeriodEnd {
            at: now() + Duration::days(days)
        }),
        Just(Event::UndoCancel),
        Just(Event::PeriodEnded),
        Just(Event::SubscriptionCanceled),
        Just(Event::ReleaseNow),
        Just(Event::RetentionExpired),
        Just(Event::OperatorRetry),
        Just(Event::EffectFailed {
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
            enrollment_generation: crate::domain::persona_credentials::EnrollmentGeneration::new(0),
            now: at,
            host_has_room: others + units <= self.capacity,
        };
        let (next, effects) = transition(state, event, context);
        self.computers[index].1 = next;
        effects
    }
}

proptest! {
    #[test]
    fn invariants(
        sizes in proptest::collection::vec(prop_oneof![Just(1u32), Just(2), Just(4)], 1..5),
        // External subscription cancellation already removed the item upstream;
        // this simulation models removals through our own billing effects.
        steps in proptest::collection::vec((0usize..5, any_event().prop_filter("own billing removals", |event| *event != Event::SubscriptionCanceled), 0i64..120, any::<bool>()), 1..200),
    ) {
        let mut fleet = Fleet {
            capacity: 4,
            computers: sizes
                .iter()
                .map(|units| (*units, ComputerState::reserved(HOST, now())))
                .collect(),
        };
        let mut at = now();

        let mut charged = std::collections::HashSet::new();
        let mut removed = std::collections::HashSet::new();
        let mut lost_writes = std::collections::HashSet::new();
        for (index, mut event, minutes, write_lost) in steps {
            let index = index % fleet.computers.len();
            at += Duration::minutes(minutes);
            let before = fleet.computers[index].1.clone();
            // A confirmation worker replays the same successful Stripe operation.
            if matches!(before.phase, Phase::PendingPayment { .. }) {
                if lost_writes.contains(&index) {
                    event = Event::PaymentConfirmed;
                }
                if event == Event::PaymentConfirmed {
                    charged.insert(index);
                    if write_lost {
                        lost_writes.insert(index);
                        for charged_id in &charged {
                            let phase = &fleet.computers[*charged_id].1.phase;
                            prop_assert_ne!(phase, &Phase::PaymentFailed);
                            prop_assert!(*phase != Phase::Destroyed || removed.contains(charged_id));
                        }
                        continue;
                    }
                    lost_writes.remove(&index);
                }
            }
            let effects = fleet.apply(index, &event, at);
            if effects.contains(&Effect::RemoveBillingItem) {
                removed.insert(index);
            }
            for charged_id in &charged {
                let phase = &fleet.computers[*charged_id].1.phase;
                prop_assert_ne!(phase, &Phase::PaymentFailed);
                prop_assert!(*phase != Phase::Destroyed || removed.contains(charged_id));
            }
            let after = &fleet.computers[index].1;

            if before.payment == PaymentOutcome::Paid {
                prop_assert_eq!(after.payment, PaymentOutcome::Paid, "paid is permanent");
            }
            if before.payment != PaymentOutcome::Pending {
                prop_assert_eq!(after.payment, before.payment, "resolved payment never changes");
            }
            if after.payment == PaymentOutcome::Unbilled && before.payment != PaymentOutcome::Unbilled {
                prop_assert_eq!(before.payment, PaymentOutcome::Pending);
                prop_assert!(matches!(before.phase, Phase::PendingPayment { .. }), "unbilled starts in pending payment");
                prop_assert_eq!(&event, &Event::PurchaseFailed);
            }
            for (computer_index, (_, state)) in fleet.computers.iter().enumerate() {
                if state.payment == PaymentOutcome::Comped {
                    prop_assert!(!charged.contains(&computer_index), "comped computer was charged");
                    prop_assert!(!removed.contains(&computer_index), "comped computer emitted a billing removal");
                    prop_assert!(state.comp_reason.is_some());
                }
                if state.payment == PaymentOutcome::Unbilled {
                    prop_assert!(!removed.contains(&computer_index), "unbilled computer emitted a billing removal");
                }
            }

            if before.phase == Phase::Destroyed {
                prop_assert_eq!(&after.phase, &Phase::Destroyed);
                prop_assert!(effects.is_empty());
            }
            if after.is_awake() {
                prop_assert_eq!(after.host(), Some(HOST));
            }
            if effects.iter().any(|effect| matches!(effect, Effect::Resume { .. })) {
                prop_assert!(
                    matches!(before.phase, Phase::Suspended { host: HOST, .. }),
                    "resume starts from a suspended computer on its host"
                );
                prop_assert!(
                    matches!(before.phase, Phase::Suspended { saved_state: true, .. })
                        || event == Event::SnapshotSaved,
                    "resume requires a completed snapshot"
                );
            }
            if after.power == Power::Off {
                prop_assert!(!matches!(after.phase, Phase::Running { .. }), "declared off but running");
            }
            if matches!(before.billing, Billing::Canceled { .. }) && event == Event::RetentionExpired {
                prop_assert_eq!(&after.phase, &Phase::Destroyed);
            }
            prop_assert!(fleet.awake_units() <= fleet.capacity);
        }
        for index in lost_writes {
            fleet.apply(index, &Event::PaymentConfirmed, at);
            prop_assert!(matches!(fleet.computers[index].1.phase, Phase::Provisioning { .. }), "confirmation recovers a lost write");
        }

    }
}

mod generation;

mod capacity;
