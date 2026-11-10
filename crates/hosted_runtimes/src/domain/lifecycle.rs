//! The pure lifecycle: `transition(state, event, context) -> (state, effects)`.
//!
//! No I/O. The event applier locks a computer's row, runs [`transition`],
//! and writes the new state plus its effects (an outbox) in one transaction.
//! Effect workers carry the effects out and report back with events.

pub use crate::domain::ids::HostId;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::domain::enrollment::EnrollmentGeneration;
use crate::domain::image::GuestImage;
use crate::domain::models::SubscriptionItem;

mod capacity;
pub use capacity::CapacityWait;
use capacity::{power_on, wait_for_room};

#[cfg(test)]
mod test;

/// Delay before the outbox resolves a purchase whose normal path did not finish.
pub const PAYMENT_CONFIRM_DELAY: Duration = Duration::minutes(2);
/// Grace between fleet-backed checks of a missing macrod.
pub const MACROD_GRACE: Duration = Duration::minutes(3);
/// Consecutive missing connections on a running guest before restarting macrod.
pub const MAX_MACROD_MISSES: u8 = 3;
/// Crashes inside this window count toward [`MAX_CRASHES`].
pub const CRASH_WINDOW: Duration = Duration::minutes(15);
/// This many crashes inside [`CRASH_WINDOW`] moves a computer to Failed.
pub const MAX_CRASHES: usize = 3;
/// A canceled computer's disk is kept this long before it is destroyed.
pub const RETENTION: Duration = Duration::days(14);
/// How soon a power-on blocked by full host capacity is retried.
pub const POWER_ON_RETRY: Duration = Duration::seconds(20);
/// Maximum interval between capacity checks for a waiting computer.
pub const MAX_POWER_ON_RETRY: Duration = Duration::minutes(10);
/// First restart backoff after a crash; doubles per recent crash.
pub const RESTART_BACKOFF: Duration = Duration::seconds(30);
/// How long before a cancel-at-period-end's period ends its billing item is
/// removed. Stripe drafts the renewal invoice at the period boundary, so a
/// removal racing it would bill the team one more period without a credit.
pub const BILLING_STOP_LEAD: Duration = Duration::hours(1);

/// Where a computer is and what it is doing, as last observed.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum Phase {
    /// Purchase in flight: units held on `host`, payment not yet confirmed.
    PendingPayment {
        /// Host holding the computer.
        host: HostId,
        /// Time the purchase began.
        since: DateTime<Utc>,
    },
    /// Payment was definitely refused; no capacity or billing item is held.
    PaymentFailed,
    /// Purchase confirmed; the instance is created on `host`, started when `start`
    /// (a full host creates it stopped and starts it later).
    Provisioning {
        /// Host holding the computer.
        host: HostId,
        /// Whether creation should also start the guest.
        start: bool,
    },
    /// The VM is starting (first boot, power on or restart); macrod not yet connected.
    Booting {
        /// Host holding the computer.
        host: HostId,
    },
    /// Guest is running.
    Running {
        /// Host holding the computer.
        host: HostId,
    },
    /// Crashed; restarts when the backoff timer fires.
    Restarting {
        /// Host holding the computer.
        host: HostId,
    },
    /// Guest is shutting down.
    Stopping {
        /// Host holding the computer.
        host: HostId,
    },
    /// The root disk is being rebuilt from another image, keeping the data
    /// disk; the guest starts again afterwards when `start`.
    Updating {
        /// Host holding the computer.
        host: HostId,
        /// Whether the guest was running and starts after the rebuild.
        start: bool,
    },
    /// Guest is powered off.
    Stopped {
        /// Host holding the computer.
        host: HostId,
    },
    /// Gave up restarting; an operator retries.
    Failed {
        /// Host holding the computer.
        host: HostId,
    },
    /// Guest and its retained disk have been deleted.
    Destroyed,
}

/// Whether the team wants the computer on.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Power {
    /// Keep the guest powered on.
    On,
    /// Keep the guest powered off.
    Off,
}

/// Where the computer's billing stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "billing", rename_all = "snake_case")]
pub enum Billing {
    /// Billing remains active.
    Active,
    /// Billing stops at `at` (the current period end); undo is allowed until then.
    CancelAtPeriodEnd {
        /// Time the operation takes effect.
        at: DateTime<Utc>,
    },
    /// The billing item is already removed, ahead of the renewal; the
    /// computer keeps running until `at`, the end of the period paid for.
    BillingStopped {
        /// End of the paid period.
        at: DateTime<Utc>,
    },
    /// No longer billed; the disk is kept until `retained_until`.
    Canceled {
        /// Deadline for retaining the guest disk.
        retained_until: DateTime<Utc>,
    },
}

/// The purchase outcome, latched after payment or comp confirmation.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum PaymentOutcome {
    /// The purchase has not resolved.
    Pending,
    /// Payment was confirmed; this remains true after release.
    Paid,
    /// The purchase was refused without billing.
    Unbilled,
    /// Provided without a charge; the reason is stored separately.
    Comped,
}

/// Everything the lifecycle knows about one computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComputerState {
    /// Purchase context retained across outbox retries and first-boot enrollment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provision_traceparent: Option<String>,
    /// First-setup milestones; absent on rows reserved before setup timing.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup: Option<crate::domain::setup::SetupTimeline>,
    /// Last observed guest phase.
    pub phase: Phase,
    /// Requested power state.
    pub power: Power,
    /// Purchase funding or billing state.
    pub billing: Billing,
    /// Latched purchase outcome.
    pub payment: PaymentOutcome,
    /// Absent on older Stripe purchases; persisted at reservation for crash recovery.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub comp_reason: Option<String>,
    /// Whether macrod is currently connected.
    pub macrod_connected: bool,
    /// Consecutive grace expirations while the guest remains running.
    #[serde(default)]
    pub macrod_misses: u8,
    /// Crash times inside the current [`CRASH_WINDOW`].
    pub recent_crashes: Vec<DateTime<Utc>>,
    /// A power-on is waiting for the computer to start.
    pub power_on_requested: bool,
    /// Absent until a start first waits for room.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capacity_wait: Option<CapacityWait>,
}

impl ComputerState {
    /// A fresh purchase holding units on `host`.
    pub fn reserved(host: HostId, now: DateTime<Utc>) -> Self {
        Self {
            provision_traceparent: None,
            setup: Some(crate::domain::setup::SetupTimeline::started(now)),
            phase: Phase::PendingPayment { host, since: now },
            power: Power::On,
            billing: Billing::Active,
            payment: PaymentOutcome::Pending,
            comp_reason: None,
            macrod_connected: false,
            macrod_misses: 0,
            recent_crashes: Vec::new(),
            power_on_requested: false,
            capacity_wait: None,
        }
    }

    /// The purchase context to parent work under while first setup is running.
    /// Completed or untimed setups return `None`; their work links instead.
    pub fn setup_traceparent(&self) -> Option<&str> {
        self.setup
            .as_ref()
            .filter(|setup| !setup.complete())
            .and(self.provision_traceparent.as_deref())
    }

    /// The host this computer lives on, while it holds capacity.
    pub fn host(&self) -> Option<HostId> {
        match self.phase {
            Phase::PendingPayment { host, .. }
            | Phase::Provisioning { host, .. }
            | Phase::Booting { host }
            | Phase::Restarting { host }
            | Phase::Running { host }
            | Phase::Stopping { host }
            | Phase::Updating { host, .. }
            | Phase::Stopped { host }
            | Phase::Failed { host } => Some(host),
            Phase::PaymentFailed | Phase::Destroyed => None,
        }
    }

    /// Whether an on request is waiting for host capacity rather than setup.
    pub fn waiting_for_capacity(&self) -> bool {
        self.power == Power::On
            && self.power_on_requested
            && matches!(
                self.phase,
                Phase::Provisioning { start: false, .. } | Phase::Stopped { .. }
            )
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
                | Phase::Stopping { .. }
                | Phase::Updating { start: true, .. }
        )
    }
}

/// Something that happened to a computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
    /// The server granted a computer without a subscription charge.
    Comped {
        /// Reason for this decision or failure.
        reason: String,
    },
    /// Purchase payment succeeded.
    PaymentConfirmed,
    /// The purchase was definitely refused by billing.
    PurchaseFailed,
    /// The fleet finished creating the instance and started it.
    InstanceStarted,
    /// The fleet finished stopping the instance (or created it stopped).
    InstanceStopped,
    /// The guest connected to the harness service.
    MacrodConnected,
    /// The guest disconnected from the harness service.
    MacrodDisconnected,
    /// Timer: macrod has been gone for [`MACROD_GRACE`], with a fresh fleet observation.
    MacrodMissing {
        /// Guest status; None means the fleet confirmed the instance is absent.
        instance_status: Option<InstanceStatus>,
    },
    /// The guest stopped unexpectedly.
    VmCrashed,
    /// The guest no longer exists; recreate it on its assigned host.
    InstanceLost,
    /// Timer: the backoff after a crash elapsed.
    RestartDue,
    /// The assigned host is unavailable.
    HostLost,
    /// Request power on.
    PowerOn,
    /// Request power off.
    PowerOff,
    /// Timer: retry a start that found the host full.
    PowerOnRetry,
    /// Another computer on the host released awake units.
    CapacityChanged,
    /// Schedule cancellation at the billing period end.
    CancelAtPeriodEnd {
        /// Time the operation takes effect.
        at: DateTime<Utc>,
    },
    /// Withdraw a pending cancellation.
    UndoCancel,
    /// Timer: shortly before a cancel-at-period-end's period ends.
    BillingStops,
    /// Timer: the billing period of a cancel-at-period-end ended.
    PeriodEnded,
    /// Billing removed the item outside our timer (webhook).
    SubscriptionCanceled,
    /// Release now: stop billing and destroy immediately.
    ReleaseNow,
    /// The retained disk may now be deleted.
    RetentionExpired,
    /// Retry a failed guest.
    OperatorRetry,
    /// An operator moves a running or stopped computer to another image.
    UpdateImage {
        /// Image to rebuild the root disk from.
        image: GuestImage,
    },
    /// A fleet effect failed after its retries; an operator looks.
    EffectFailed {
        /// Reason for this decision or failure.
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
    /// Check whether macrod exceeded its connection grace period.
    MacrodMissing,
    /// Retry after the crash backoff.
    RestartDue,
    /// Retry a start blocked by host capacity.
    PowerOnRetry,
    /// Another computer on the host released awake units.
    CapacityChanged,
    /// Remove a canceled computer's billing item before the renewal.
    BillingStops,
    /// Apply the scheduled billing cancellation.
    PeriodEnded,
    /// The retained disk may now be deleted.
    RetentionExpired,
}

impl TimerKind {
    /// The event a timer delivers when it fires.
    pub fn event(self, instance_status: Option<InstanceStatus>) -> Event {
        match self {
            Self::MacrodMissing => Event::MacrodMissing { instance_status },
            Self::RestartDue => Event::RestartDue,
            Self::PowerOnRetry => Event::PowerOnRetry,
            Self::CapacityChanged => Event::CapacityChanged,
            Self::BillingStops => Event::BillingStops,
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
        /// Additional subscription items included in the purchase.
        extra_items: Vec<SubscriptionItem>,
    },
    /// Create the instance from the base image with its enrollment; start it when `start`.
    Create {
        /// Host holding the computer.
        host: HostId,
        /// Whether creation should also start the guest.
        start: bool,
        /// Enrollment generation reserved for this creation.
        generation: EnrollmentGeneration,
    },
    /// Start the guest.
    Start {
        /// Host holding the computer.
        host: HostId,
    },
    /// Shut down the guest.
    Stop {
        /// Host holding the computer.
        host: HostId,
    },
    /// Recover a crashed guest with an idempotent start.
    Restart {
        /// Host holding the computer.
        host: HostId,
    },
    /// Restart only the guest connection daemon, preserving the guest and its sessions.
    RestartMacrod {
        /// Host holding the computer.
        host: HostId,
    },
    /// Stop the guest, rebuild its root disk from `image` keeping the data
    /// disk, and start it again when `start`.
    Rebuild {
        /// Host holding the computer.
        host: HostId,
        /// Image to rebuild the root disk from.
        image: GuestImage,
        /// Whether to start the guest after the rebuild.
        start: bool,
    },
    /// Delete the guest, its root disk and its data disk.
    Destroy {
        /// Host holding the computer.
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
        /// Timer event to deliver.
        kind: TimerKind,
        /// Time the operation takes effect.
        at: DateTime<Utc>,
    },
    /// Report a failure requiring operator attention.
    PageOperator {
        /// Reason for this decision or failure.
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
/// Worker responsible for an outbox action.
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum EffectWorker {
    /// Executes guest operations.
    Fleet,
    /// Executes subscription operations.
    Billing,
    /// Persists scheduled lifecycle events.
    Timers,
}

/// What the fleet observes about an instance.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum InstanceStatus {
    /// Guest is running.
    Running,
    /// Guest is powered off.
    Stopped,
}

/// Facts the applier gathers under the host lock before a transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Context {
    /// Last creation begun by the fleet; Create effects reserve its successor.
    pub enrollment_generation: EnrollmentGeneration,
    /// Current time used for this transition.
    pub now: DateTime<Utc>,
    /// Whether the computer's host has awake units free for it to start.
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
            Event::PaymentConfirmed | Event::Comped { .. } => {
                if let Event::Comped { reason } = event {
                    next.payment = PaymentOutcome::Comped;
                    next.comp_reason = Some(reason.clone());
                } else {
                    next.payment = PaymentOutcome::Paid;
                }
                let start = state.power == Power::On && context.host_has_room;
                next.phase = Phase::Provisioning { host, start };
                next.power_on_requested = state.power == Power::On && !start;
                schedule_create(
                    &mut next,
                    &mut effects,
                    host,
                    start,
                    context.enrollment_generation,
                );
            }
            Event::PurchaseFailed => {
                next.payment = PaymentOutcome::Unbilled;
                next.phase = Phase::PaymentFailed;
            }
            _ => {}
        }
        return (next, effects);
    }

    match event {
        Event::PaymentConfirmed | Event::Comped { .. } | Event::PurchaseFailed => {}

        Event::InstanceLost => {
            next.macrod_connected = false;
            if matches!(state.billing, Billing::Canceled { .. }) {
                next.phase = Phase::Destroyed;
                next.power_on_requested = false;
                effects.push(Effect::RevokeHarness);
            } else {
                let start = state.power == Power::On && context.host_has_room;
                next.phase = Phase::Provisioning { host, start };
                next.power_on_requested = state.power == Power::On && !start;
                schedule_create(
                    &mut next,
                    &mut effects,
                    host,
                    start,
                    context.enrollment_generation,
                );
            }
        }

        Event::InstanceStarted => {
            if let Phase::Provisioning { start: true, .. } | Phase::Updating { start: true, .. } =
                state.phase
            {
                if state.power == Power::On {
                    if state.macrod_connected {
                        next.phase = Phase::Running { host };
                        next.power_on_requested = false;
                    } else {
                        boot(&mut next, &mut effects, host, now, None);
                    }
                } else {
                    stop(&mut next, &mut effects, host);
                }
            }
        }

        Event::InstanceStopped => {
            if matches!(
                state.phase,
                Phase::Provisioning { .. } | Phase::Stopping { .. } | Phase::Updating { .. }
            ) {
                next.phase = Phase::Stopped { host };
                next.macrod_connected = false;
                if state.power == Power::On && state.power_on_requested {
                    effects.push(Effect::ScheduleTimer {
                        kind: TimerKind::PowerOnRetry,
                        at: now + POWER_ON_RETRY,
                    });
                }
            }
        }

        Event::MacrodConnected => {
            next.macrod_connected = true;
            next.macrod_misses = 0;
            if let Phase::Booting { .. } = state.phase {
                if state.power == Power::On {
                    next.phase = Phase::Running { host };
                    next.power_on_requested = false;
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

        Event::MacrodMissing { instance_status } => {
            let gone = !state.macrod_connected
                && matches!(state.phase, Phase::Booting { .. } | Phase::Running { .. });
            if gone {
                if *instance_status == Some(InstanceStatus::Running) {
                    next.macrod_misses =
                        state.macrod_misses.saturating_add(1).min(MAX_MACROD_MISSES);
                    effects.push(Effect::ScheduleTimer {
                        kind: TimerKind::MacrodMissing,
                        at: now + MACROD_GRACE,
                    });
                    if state.macrod_misses < MAX_MACROD_MISSES
                        && next.macrod_misses == MAX_MACROD_MISSES
                    {
                        effects.push(Effect::RestartMacrod { host });
                        effects.push(Effect::PageOperator {
                            reason: "macrod missing repeatedly while the guest is running"
                                .to_owned(),
                        });
                    }
                } else {
                    crash(&mut next, &mut effects, host, now);
                }
            }
        }

        Event::VmCrashed => match state.phase {
            Phase::Booting { .. } | Phase::Running { .. } => {
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

        Event::PowerOnRetry => {
            let due = state
                .capacity_wait
                .as_ref()
                .is_none_or(|wait| now >= wait.retry_at);
            if state.power == Power::On && state.power_on_requested && due {
                power_on(&mut next, &mut effects, host, context);
            }
        }

        Event::CapacityChanged => {
            if state.waiting_for_capacity() {
                next.capacity_wait = None;
                power_on(&mut next, &mut effects, host, context);
            }
        }

        Event::PowerOn => {
            if !matches!(state.billing, Billing::Canceled { .. }) {
                next.power = Power::On;
                power_on(&mut next, &mut effects, host, context);
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
                        next.power_on_requested = true;
                        wait_for_room(&mut next, &mut effects, now);
                    }
                } else {
                    next.phase = Phase::Stopped { host };
                    effects.push(Effect::Stop { host });
                }
            }
        }

        Event::UpdateImage { image } => {
            let start = match state.phase {
                Phase::Running { .. } => Some(true),
                Phase::Stopped { .. } => Some(false),
                _ => None,
            };
            if let Some(start) = start {
                next.phase = Phase::Updating { host, start };
                next.macrod_connected = false;
                next.macrod_misses = 0;
                effects.push(Effect::Rebuild {
                    host,
                    image: image.clone(),
                    start,
                });
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
                if state.payment == PaymentOutcome::Comped {
                    cancel(&mut next, &mut effects, host, now);
                    return (next, effects);
                }
                next.billing = Billing::CancelAtPeriodEnd { at: *at };
                if state.payment == PaymentOutcome::Paid {
                    effects.push(Effect::ScheduleTimer {
                        kind: TimerKind::BillingStops,
                        at: (*at - BILLING_STOP_LEAD).max(now),
                    });
                }
                effects.push(Effect::ScheduleTimer {
                    kind: TimerKind::PeriodEnded,
                    at: *at,
                });
            }
        }

        Event::BillingStops => {
            if let Billing::CancelAtPeriodEnd { at } = state.billing
                && state.payment == PaymentOutcome::Paid
            {
                effects.push(Effect::RemoveBillingItem);
                next.billing = Billing::BillingStopped { at };
            }
        }

        Event::UndoCancel => {
            if let Billing::CancelAtPeriodEnd { .. } = state.billing {
                next.billing = Billing::Active;
            }
        }

        Event::PeriodEnded => match state.billing {
            // The early removal never ran (e.g. canceled within the lead).
            Billing::CancelAtPeriodEnd { .. } => {
                if state.payment == PaymentOutcome::Paid {
                    effects.push(Effect::RemoveBillingItem);
                }
                cancel(&mut next, &mut effects, host, now);
            }
            Billing::BillingStopped { .. } => cancel(&mut next, &mut effects, host, now),
            Billing::Active | Billing::Canceled { .. } => {}
        },

        Event::SubscriptionCanceled => {
            if state.payment != PaymentOutcome::Comped
                && !matches!(state.billing, Billing::Canceled { .. })
            {
                cancel(&mut next, &mut effects, host, now);
            }
        }

        Event::ReleaseNow => {
            if state.payment == PaymentOutcome::Paid
                && matches!(
                    state.billing,
                    Billing::Active | Billing::CancelAtPeriodEnd { .. }
                )
            {
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

    if !next.waiting_for_capacity() {
        next.capacity_wait = None;
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
    next.capacity_wait = None;
    next.macrod_misses = 0;
    next.power_on_requested = false;
    next.macrod_connected = false;
    effects.extend(start);
    effects.push(Effect::ScheduleTimer {
        kind: TimerKind::MacrodMissing,
        at: now + MACROD_GRACE,
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
    let doublings = crashes.saturating_sub(1).min(8);
    effects.push(Effect::ScheduleTimer {
        kind: TimerKind::RestartDue,
        at: now + RESTART_BACKOFF * (1_i32 << doublings),
    });
}

fn fail(next: &mut ComputerState, effects: &mut Vec<Effect>, host: HostId, reason: String) {
    next.phase = Phase::Failed { host };
    next.power_on_requested = false;
    next.macrod_connected = false;
    effects.push(Effect::PageOperator { reason });
}

fn stop(next: &mut ComputerState, effects: &mut Vec<Effect>, host: HostId) {
    next.phase = Phase::Stopping { host };
    effects.push(Effect::Stop { host });
}

/// Bring the computer to rest after the team turned it off.
fn power_down(next: &mut ComputerState, effects: &mut Vec<Effect>, host: HostId) {
    next.power_on_requested = false;
    match next.phase {
        Phase::Booting { .. } | Phase::Running { .. } | Phase::Restarting { .. } => {
            stop(next, effects, host)
        }
        // A failed instance holds no units; stop whatever is left of it.
        Phase::Failed { .. } => {
            next.phase = Phase::Stopped { host };
            effects.push(Effect::Stop { host });
        }
        Phase::PendingPayment { .. }
        | Phase::Provisioning { .. }
        | Phase::Updating { .. }
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
    next.power_on_requested = false;
    next.macrod_connected = false;
    effects.push(Effect::Destroy { host });
    effects.push(Effect::RevokeHarness);
}

fn schedule_create(
    state: &mut ComputerState,
    effects: &mut Vec<Effect>,
    host: HostId,
    start: bool,
    previous: EnrollmentGeneration,
) {
    match previous.next() {
        Some(generation) => effects.push(Effect::Create {
            host,
            start,
            generation,
        }),
        None => {
            state.phase = Phase::Failed { host };
            effects.push(Effect::PageOperator {
                reason: "enrollment generation exhausted".to_owned(),
            });
        }
    }
}
