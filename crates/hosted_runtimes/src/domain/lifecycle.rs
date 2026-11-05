//! The pure lifecycle: `transition(state, event, context) -> (state, effects)`.
//!
//! No I/O. The event applier locks a computer's row, runs [`transition`],
//! and writes the new state plus its effects (an outbox) in one transaction.
//! Effect workers carry the effects out and report back with events.

use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::models::SubscriptionItem;

#[cfg(test)]
mod test;

/// Delay before the outbox resolves a purchase whose normal path did not finish.
pub const PAYMENT_CONFIRM_DELAY: Duration = Duration::minutes(2);
/// Frozen this long without a prompt, a computer saves its RAM and suspends.
pub const SUSPEND_AFTER: Duration = Duration::minutes(30);
/// macrod may be gone this long while awake before we treat it as a crash.
pub const MACROD_GRACE: Duration = Duration::minutes(3);
/// Crashes inside this window count toward [`MAX_CRASHES`].
pub const CRASH_WINDOW: Duration = Duration::minutes(15);
/// This many crashes inside [`CRASH_WINDOW`] moves a computer to Failed.
pub const MAX_CRASHES: usize = 3;
/// A canceled computer's disk is kept this long before it is destroyed.
pub const RETENTION: Duration = Duration::days(14);
/// How soon a wake blocked by full host capacity is retried.
pub const WAKE_RETRY: Duration = Duration::seconds(20);
/// First restart backoff after a crash; doubles per recent crash.
pub const RESTART_BACKOFF: Duration = Duration::seconds(30);

/// Opaque id of a fleet host.
pub type HostId = Uuid;

/// Where a computer is and what it is doing, as last observed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum Phase {
    /// Purchase in flight: units held on `host`, payment not yet confirmed.
    PendingPayment {
        host: HostId,
        since: DateTime<Utc>,
    },
    /// Payment was definitely refused; no capacity or billing item is held.
    PaymentFailed,
    /// Paid; the instance is being created on `host`, started when `start`
    /// (a full host creates it stopped and wakes it later).
    Provisioning {
        host: HostId,
        start: bool,
    },
    /// The VM is starting (first boot, resume or restart); macrod not yet connected.
    Booting {
        host: HostId,
    },
    Running {
        host: HostId,
    },
    /// Crashed; restarts when the backoff timer fires.
    Restarting {
        host: HostId,
    },
    /// Paused in RAM; wakes in milliseconds.
    Frozen {
        host: HostId,
    },
    /// RAM written to disk (`saved_state` once the snapshot finished); takes no host RAM.
    Suspended {
        host: HostId,
        saved_state: bool,
    },
    Stopping {
        host: HostId,
    },
    Stopped {
        host: HostId,
    },
    /// Gave up restarting; an operator retries.
    Failed {
        host: HostId,
    },
    Destroyed,
}

/// Whether the team wants the computer on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Power {
    On,
    Off,
}

/// Where the computer's billing stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "billing", rename_all = "snake_case")]
pub enum Billing {
    Active,
    /// Billing stops at `at` (the current period end); undo is allowed until then.
    CancelAtPeriodEnd {
        at: DateTime<Utc>,
    },
    /// No longer billed; the disk is kept until `retained_until`.
    Canceled {
        retained_until: DateTime<Utc>,
    },
}

/// Everything the lifecycle knows about one computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComputerState {
    pub phase: Phase,
    pub power: Power,
    pub billing: Billing,
    pub macrod_connected: bool,
    /// Crash times inside the current [`CRASH_WINDOW`].
    pub recent_crashes: Vec<DateTime<Utc>>,
    /// A prompt or power-on is waiting for the computer to wake.
    pub wake_requested: bool,
}

impl ComputerState {
    /// A fresh purchase holding units on `host`.
    pub fn reserved(host: HostId, now: DateTime<Utc>) -> Self {
        Self {
            phase: Phase::PendingPayment { host, since: now },
            power: Power::On,
            billing: Billing::Active,
            macrod_connected: false,
            recent_crashes: Vec::new(),
            wake_requested: false,
        }
    }

    /// The host this computer lives on, while it holds capacity.
    pub fn host(&self) -> Option<HostId> {
        match self.phase {
            Phase::PendingPayment { host, .. }
            | Phase::Provisioning { host, .. }
            | Phase::Booting { host }
            | Phase::Restarting { host }
            | Phase::Running { host }
            | Phase::Frozen { host }
            | Phase::Suspended { host, .. }
            | Phase::Stopping { host }
            | Phase::Stopped { host }
            | Phase::Failed { host } => Some(host),
            Phase::PaymentFailed | Phase::Destroyed => None,
        }
    }

    /// Whether the computer counts against sold capacity.
    pub fn holds_units(&self) -> bool {
        !matches!(self.phase, Phase::PaymentFailed | Phase::Destroyed)
    }

    /// Whether the computer holds host RAM, i.e. counts against awake capacity.
    pub fn is_awake(&self) -> bool {
        matches!(
            self.phase,
            Phase::Provisioning { start: true, .. }
                | Phase::Booting { .. }
                | Phase::Restarting { .. }
                | Phase::Running { .. }
                | Phase::Frozen { .. }
                | Phase::Stopping { .. }
        )
    }
}

/// Something that happened to a computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
    PaymentConfirmed,
    /// The purchase was definitely refused by billing.
    PurchaseFailed,
    /// The fleet finished creating the instance and started it.
    InstanceStarted,
    /// The fleet finished stopping the instance (or created it stopped).
    InstanceStopped,
    MacrodConnected,
    MacrodDisconnected,
    /// Timer: macrod has been gone for [`MACROD_GRACE`].
    MacrodMissing,
    SessionsIdle,
    PromptArrived,
    /// Timer: frozen for [`SUSPEND_AFTER`].
    SuspendDue,
    SnapshotSaved,
    VmCrashed,
    /// Timer: the backoff after a crash elapsed.
    RestartDue,
    HostLost,
    PowerOn,
    PowerOff,
    /// Timer: retry a wake that found the host full.
    WakeRetry,
    CancelAtPeriodEnd {
        at: DateTime<Utc>,
    },
    UndoCancel,
    /// Timer: the billing period of a cancel-at-period-end ended.
    PeriodEnded,
    /// Billing removed the item outside our timer (webhook).
    SubscriptionCanceled,
    /// Release now: stop billing and destroy immediately.
    ReleaseNow,
    RetentionExpired,
    OperatorRetry,
    /// A fleet effect failed after its retries; an operator looks.
    EffectFailed {
        reason: String,
    },
}

/// Timers a computer can have pending; at most one of each kind.
#[derive(
    Debug,
    Clone,
    Copy,
    PartialEq,
    Eq,
    Hash,
    Serialize,
    Deserialize,
    strum::AsRefStr,
    strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum TimerKind {
    MacrodMissing,
    SuspendDue,
    RestartDue,
    WakeRetry,
    PeriodEnded,
    RetentionExpired,
}

impl TimerKind {
    /// The event a timer delivers when it fires.
    pub fn event(self) -> Event {
        match self {
            Self::MacrodMissing => Event::MacrodMissing,
            Self::SuspendDue => Event::SuspendDue,
            Self::RestartDue => Event::RestartDue,
            Self::WakeRetry => Event::WakeRetry,
            Self::PeriodEnded => Event::PeriodEnded,
            Self::RetentionExpired => Event::RetentionExpired,
        }
    }
}

/// Something the lifecycle wants done.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "effect", rename_all = "snake_case")]
pub enum Effect {
    /// Resolve a pending purchase with its original idempotency key and items.
    ConfirmPayment {
        extra_items: Vec<SubscriptionItem>,
    },
    /// Create the instance from the base image with its enrollment; start it when `start`.
    Create {
        host: HostId,
        start: bool,
    },
    Start {
        host: HostId,
    },
    Freeze {
        host: HostId,
    },
    Unfreeze {
        host: HostId,
    },
    /// Stateful stop: save RAM to disk.
    Suspend {
        host: HostId,
    },
    /// Start from saved state.
    Resume {
        host: HostId,
    },
    Stop {
        host: HostId,
    },
    /// Force-stop and start.
    Restart {
        host: HostId,
    },
    Destroy {
        host: HostId,
    },
    /// Suspend the coldest idle awake computer on `host` to free units.
    MakeRoom {
        host: HostId,
    },
    /// Remove this computer's item from the team subscription.
    RemoveBillingItem,
    /// Delete the computer's harness and its credential.
    RevokeHarness,
    /// Fire `kind` at `at`, replacing a pending timer of that kind. Timers
    /// need no cancel: a timer that fires in a state it no longer applies to
    /// is ignored by [`transition`].
    ScheduleTimer {
        kind: TimerKind,
        at: DateTime<Utc>,
    },
    PageOperator {
        reason: String,
    },
}

impl Effect {
    /// Which worker carries the effect out. Billing runs where Stripe lives.
    pub fn worker(&self) -> EffectWorker {
        match self {
            Self::ConfirmPayment { .. } | Self::RemoveBillingItem => EffectWorker::Billing,
            Self::ScheduleTimer { .. } => EffectWorker::Timers,
            _ => EffectWorker::Fleet,
        }
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::AsRefStr, strum::EnumString,
)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum EffectWorker {
    Fleet,
    Billing,
    Timers,
}

/// Facts the applier gathers under the host lock before a transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Context {
    pub now: DateTime<Utc>,
    /// Whether the computer's host has awake units free for it to wake.
    pub host_has_room: bool,
}

/// Apply one event. Events that do not apply in the current state are
/// ignored (no state change, no effects), so redelivery and stale timers are
/// harmless.
pub fn transition(
    state: &ComputerState,
    event: &Event,
    context: Context,
) -> (ComputerState, Vec<Effect>) {
    let mut next = state.clone();
    let mut effects = Vec::new();
    let now = context.now;

    if state.phase == Phase::PaymentFailed {
        if *event == Event::ReleaseNow {
            next.phase = Phase::Destroyed;
        }
        return (next, effects);
    }

    let Some(host) = state.host() else {
        return (next, effects);
    };

    if let Phase::PendingPayment { .. } = state.phase {
        match event {
            Event::PaymentConfirmed => {
                let start = state.power == Power::On && context.host_has_room;
                next.phase = Phase::Provisioning { host, start };
                next.wake_requested = state.power == Power::On && !start;
                effects.push(Effect::Create { host, start });
            }
            Event::PurchaseFailed => {
                next.phase = Phase::PaymentFailed;
            }
            _ => {}
        }
        return (next, effects);
    }

    match event {
        Event::PaymentConfirmed | Event::PurchaseFailed => {}

        Event::InstanceStarted => {
            if let Phase::Provisioning { start: true, .. } = state.phase {
                if state.power == Power::On {
                    boot(&mut next, &mut effects, host, now, None);
                } else {
                    stop(&mut next, &mut effects, host);
                }
            }
        }

        Event::InstanceStopped => {
            if matches!(
                state.phase,
                Phase::Provisioning { .. } | Phase::Stopping { .. }
            ) {
                next.phase = Phase::Stopped { host };
                next.macrod_connected = false;
                if state.power == Power::On && state.wake_requested {
                    effects.push(Effect::ScheduleTimer {
                        kind: TimerKind::WakeRetry,
                        at: now + WAKE_RETRY,
                    });
                }
            }
        }

        Event::MacrodConnected => {
            next.macrod_connected = true;
            if let Phase::Booting { .. } = state.phase {
                if state.power == Power::On {
                    next.phase = Phase::Running { host };
                    next.wake_requested = false;
                } else {
                    stop(&mut next, &mut effects, host);
                }
            }
        }

        Event::MacrodDisconnected => {
            next.macrod_connected = false;
            if let Phase::Running { .. } = state.phase {
                effects.push(Effect::ScheduleTimer {
                    kind: TimerKind::MacrodMissing,
                    at: now + MACROD_GRACE,
                });
            }
        }

        Event::MacrodMissing => {
            let gone = !state.macrod_connected
                && matches!(state.phase, Phase::Booting { .. } | Phase::Running { .. });
            if gone {
                crash(&mut next, &mut effects, host, now);
            }
        }

        Event::VmCrashed => match state.phase {
            Phase::Booting { .. } | Phase::Running { .. } | Phase::Frozen { .. } => {
                crash(&mut next, &mut effects, host, now);
            }
            Phase::Stopping { .. } => {
                next.phase = Phase::Stopped { host };
                next.macrod_connected = false;
            }
            _ => {}
        },

        Event::RestartDue => {
            if let Phase::Restarting { .. } = state.phase {
                boot(
                    &mut next,
                    &mut effects,
                    host,
                    now,
                    Some(Effect::Restart { host }),
                );
            }
        }

        Event::SessionsIdle => {
            if let Phase::Running { .. } = state.phase {
                next.phase = Phase::Frozen { host };
                effects.push(Effect::Freeze { host });
                effects.push(Effect::ScheduleTimer {
                    kind: TimerKind::SuspendDue,
                    at: now + SUSPEND_AFTER,
                });
            }
        }

        Event::SuspendDue => {
            if let Phase::Frozen { .. } = state.phase {
                next.phase = Phase::Suspended {
                    host,
                    saved_state: false,
                };
                next.macrod_connected = false;
                effects.push(Effect::Suspend { host });
            }
        }

        Event::SnapshotSaved => {
            if let Phase::Suspended { .. } = state.phase {
                next.phase = Phase::Suspended {
                    host,
                    saved_state: true,
                };
                if state.wake_requested && state.power == Power::On {
                    wake(&mut next, &mut effects, host, context);
                }
            }
        }

        Event::PromptArrived => {
            if state.power == Power::On {
                if let Phase::Frozen { .. } = state.phase {
                    next.phase = Phase::Running { host };
                    effects.push(Effect::Unfreeze { host });
                    if !state.macrod_connected {
                        effects.push(Effect::ScheduleTimer {
                            kind: TimerKind::MacrodMissing,
                            at: now + MACROD_GRACE,
                        });
                    }
                } else {
                    wake(&mut next, &mut effects, host, context);
                }
            }
        }

        Event::WakeRetry => {
            if state.power == Power::On && state.wake_requested {
                wake(&mut next, &mut effects, host, context);
            }
        }

        Event::PowerOn => {
            if !matches!(state.billing, Billing::Canceled { .. }) {
                next.power = Power::On;
                wake(&mut next, &mut effects, host, context);
            }
        }

        Event::PowerOff => {
            next.power = Power::Off;
            power_down(&mut next, &mut effects, host);
        }

        Event::OperatorRetry => {
            if let Phase::Failed { .. } = state.phase {
                next.recent_crashes.clear();
                if state.power == Power::On {
                    if context.host_has_room {
                        boot(
                            &mut next,
                            &mut effects,
                            host,
                            now,
                            Some(Effect::Restart { host }),
                        );
                    } else {
                        next.phase = Phase::Stopped { host };
                        next.wake_requested = true;
                        make_room(&mut effects, host, now);
                    }
                } else {
                    next.phase = Phase::Stopped { host };
                    effects.push(Effect::Stop { host });
                }
            }
        }

        Event::HostLost => {
            if !matches!(state.phase, Phase::Failed { .. }) {
                fail(&mut next, &mut effects, host, "host lost".to_owned());
            }
        }

        Event::EffectFailed { reason } => {
            if !matches!(state.phase, Phase::Failed { .. }) {
                fail(&mut next, &mut effects, host, reason.clone());
            }
        }

        Event::CancelAtPeriodEnd { at } => {
            if state.billing == Billing::Active {
                next.billing = Billing::CancelAtPeriodEnd { at: *at };
                effects.push(Effect::ScheduleTimer {
                    kind: TimerKind::PeriodEnded,
                    at: *at,
                });
            }
        }

        Event::UndoCancel => {
            if let Billing::CancelAtPeriodEnd { .. } = state.billing {
                next.billing = Billing::Active;
            }
        }

        Event::PeriodEnded => {
            if let Billing::CancelAtPeriodEnd { .. } = state.billing {
                effects.push(Effect::RemoveBillingItem);
                cancel(&mut next, &mut effects, host, now);
            }
        }

        Event::SubscriptionCanceled => {
            if !matches!(state.billing, Billing::Canceled { .. }) {
                cancel(&mut next, &mut effects, host, now);
            }
        }

        Event::ReleaseNow => {
            if !matches!(state.billing, Billing::Canceled { .. }) {
                effects.push(Effect::RemoveBillingItem);
            }
            destroy(&mut next, &mut effects, host);
        }

        Event::RetentionExpired => {
            if let Billing::Canceled { .. } = state.billing {
                destroy(&mut next, &mut effects, host);
            }
        }
    }

    (next, effects)
}

/// Enter Booting, optionally with the effect that starts the VM, and arm the
/// timer that treats a macrod that never connects as a crash.
fn boot(
    next: &mut ComputerState,
    effects: &mut Vec<Effect>,
    host: HostId,
    now: DateTime<Utc>,
    start: Option<Effect>,
) {
    next.phase = Phase::Booting { host };
    next.wake_requested = false;
    next.macrod_connected = false;
    effects.extend(start);
    effects.push(Effect::ScheduleTimer {
        kind: TimerKind::MacrodMissing,
        at: now + MACROD_GRACE,
    });
}

/// Wake a stopped or suspended computer when the host has room; otherwise
/// ask for room and retry. Awake computers need nothing.
fn wake(next: &mut ComputerState, effects: &mut Vec<Effect>, host: HostId, context: Context) {
    let start = match next.phase {
        Phase::Stopped { .. } => Effect::Start { host },
        Phase::Suspended {
            saved_state: true, ..
        } => Effect::Resume { host },
        Phase::Suspended {
            saved_state: false, ..
        }
        | Phase::Stopping { .. } => {
            next.wake_requested = true;
            return;
        }
        _ => return,
    };

    if context.host_has_room {
        boot(next, effects, host, context.now, Some(start));
    } else {
        next.wake_requested = true;
        make_room(effects, host, context.now);
    }
}

fn make_room(effects: &mut Vec<Effect>, host: HostId, now: DateTime<Utc>) {
    effects.push(Effect::MakeRoom { host });
    effects.push(Effect::ScheduleTimer {
        kind: TimerKind::WakeRetry,
        at: now + WAKE_RETRY,
    });
}

/// Restart with exponential backoff, or give up after [`MAX_CRASHES`].
fn crash(next: &mut ComputerState, effects: &mut Vec<Effect>, host: HostId, now: DateTime<Utc>) {
    next.recent_crashes.retain(|at| now - *at < CRASH_WINDOW);
    next.recent_crashes.push(now);
    next.macrod_connected = false;

    let crashes = next.recent_crashes.len();
    if crashes >= MAX_CRASHES {
        fail(
            next,
            effects,
            host,
            format!(
                "{crashes} crashes in {} minutes",
                CRASH_WINDOW.num_minutes()
            ),
        );
        return;
    }

    next.phase = Phase::Restarting { host };
    let doublings = u32::try_from(crashes - 1).unwrap_or(u32::MAX).min(8);
    effects.push(Effect::ScheduleTimer {
        kind: TimerKind::RestartDue,
        at: now + RESTART_BACKOFF * 2_i32.pow(doublings),
    });
}

fn fail(next: &mut ComputerState, effects: &mut Vec<Effect>, host: HostId, reason: String) {
    next.phase = Phase::Failed { host };
    next.wake_requested = false;
    next.macrod_connected = false;
    effects.push(Effect::PageOperator { reason });
}

fn stop(next: &mut ComputerState, effects: &mut Vec<Effect>, host: HostId) {
    next.phase = Phase::Stopping { host };
    effects.push(Effect::Stop { host });
}

/// Bring the computer to rest after the team turned it off.
fn power_down(next: &mut ComputerState, effects: &mut Vec<Effect>, host: HostId) {
    next.wake_requested = false;
    match next.phase {
        Phase::Booting { .. }
        | Phase::Running { .. }
        | Phase::Frozen { .. }
        | Phase::Restarting { .. } => stop(next, effects, host),
        // A failed instance holds no units; stop whatever is left of it.
        Phase::Failed { .. } => {
            next.phase = Phase::Stopped { host };
            effects.push(Effect::Stop { host });
        }
        Phase::Suspended { .. } => {
            next.phase = Phase::Stopped { host };
            next.macrod_connected = false;
        }
        Phase::PendingPayment { .. }
        | Phase::Provisioning { .. }
        | Phase::Stopping { .. }
        | Phase::Stopped { .. }
        | Phase::PaymentFailed
        | Phase::Destroyed => {}
    }
}

/// Billing ended: turn off and keep the disk for [`RETENTION`].
fn cancel(next: &mut ComputerState, effects: &mut Vec<Effect>, host: HostId, now: DateTime<Utc>) {
    let retained_until = now + RETENTION;
    next.billing = Billing::Canceled { retained_until };
    next.power = Power::Off;
    power_down(next, effects, host);
    effects.push(Effect::ScheduleTimer {
        kind: TimerKind::RetentionExpired,
        at: retained_until,
    });
}

fn destroy(next: &mut ComputerState, effects: &mut Vec<Effect>, host: HostId) {
    next.phase = Phase::Destroyed;
    next.wake_requested = false;
    next.macrod_connected = false;
    effects.push(Effect::Destroy { host });
    effects.push(Effect::RevokeHarness);
}
