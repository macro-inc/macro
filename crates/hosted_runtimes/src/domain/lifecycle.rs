//! The pure lifecycle: `transition(state, event, context) -> Result<(state, effects), Rejected>`.
//!
//! No I/O. The event applier locks a computer's row, runs [`transition`],
//! and writes the new state plus its effects (an outbox) in one transaction.
//! Effect workers carry the effects out and report back with events.
//!
//! A computer's state has two machines side by side: [`Phase`] is the guest
//! machine, [`Billing`] is what pays for it. Billing events change only
//! [`Billing`] and emit the machine effects billing calls for (stop at the end
//! of a paid period, destroy after retention). Both change in the same
//! transition, inside the same repository lock.

pub use crate::domain::ids::HostId;
use chrono::{DateTime, Duration, Utc};
use serde::{Deserialize, Serialize};

use crate::domain::enrollment::EnrollmentGeneration;

mod backoff;
pub use backoff::{BILLING_BACKOFF, Backoff, CAPACITY_BACKOFF, RESTART_BACKOFF, Retry, backoff};
mod billing;
pub use billing::{restore_allowed, undo_allowed};
mod capacity;
use capacity::{power_on, wait_for_room};
mod event;
pub use event::{Effect, EffectWorker, Event, InstanceStatus, Rejected, SetupOutcome, TimerKind};

#[cfg(test)]
mod test;

/// Grace between fleet-backed checks of a missing macrod.
pub const MACROD_GRACE: Duration = Duration::minutes(3);
/// Consecutive missing connections on a running guest before restarting macrod.
pub const MAX_MACROD_MISSES: u8 = 3;
/// Crashes inside this window count toward [`MAX_CRASHES`].
pub const CRASH_WINDOW: Duration = Duration::minutes(15);
/// This many crashes inside [`CRASH_WINDOW`] stop automatic restarts.
pub const MAX_CRASHES: usize = 3;

/// A Stripe subscription item, one per billed computer.
pub type SubscriptionItemId = stripe::SubscriptionItemId;

/// How long an agent teammate has to report itself online after its
/// computer's macrod connects, before its start counts as failed.
pub const AGENT_START_DEADLINE: Duration = Duration::minutes(3);
/// How often an agent's hand-off is sent again while it hasn't reported
/// online: the runtime bus carries no acknowledgement, so a lost hand-off
/// must not cost the agent its start.
pub const AGENT_REDELIVERY: Duration = Duration::seconds(20);
/// Failed first starts after which a computer is released and its purchase
/// refunded: one failure leaves it for the team to retry.
pub const MAX_FIRST_START_FAILURES: u8 = 2;
/// How long the purchase request has to answer its own charge before the
/// billing worker takes it over ([`TimerKind::ChargeUnsettled`]): longer
/// than any one subscription update takes, so it only fires for a request
/// that died part way.
pub const CHARGE_TAKEOVER: Duration = Duration::minutes(2);

/// The credit note and refund that undid a computer's purchase.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct PurchaseRefund {
    /// The credit note on the purchase's invoice.
    pub credit_note: stripe::CreditNoteId,
    /// The refund to the card; `None` when the invoice was paid from the
    /// team's credit balance, which the credit note restores instead.
    pub refund: Option<stripe::RefundId>,
}

/// How long billing waits before acting, from the deployment's configuration.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct BillingPolicy {
    /// How long a computer whose billing ended keeps its disk before it is destroyed.
    pub retention: Duration,
    /// How long a computer runs on an unpaid subscription before it is turned off.
    pub past_due_grace: Duration,
}

/// A billing policy with a zero length.
#[derive(Debug, thiserror::Error)]
#[error("{0} must be at least one day")]
pub struct InvalidBillingPolicy(&'static str);

impl BillingPolicy {
    /// From whole days, as configured (`COMPUTER_RETENTION_DAYS`,
    /// `COMPUTER_PAST_DUE_GRACE_DAYS`).
    pub fn from_days(
        retention_days: u32,
        past_due_grace_days: u32,
    ) -> Result<Self, InvalidBillingPolicy> {
        if retention_days == 0 {
            return Err(InvalidBillingPolicy("COMPUTER_RETENTION_DAYS"));
        }
        if past_due_grace_days == 0 {
            return Err(InvalidBillingPolicy("COMPUTER_PAST_DUE_GRACE_DAYS"));
        }
        Ok(Self {
            retention: Duration::days(i64::from(retention_days)),
            past_due_grace: Duration::days(i64::from(past_due_grace_days)),
        })
    }
}

/// What the guest machine is doing, as last observed. The host lives on the
/// computer; every phase but [`Phase::Destroying`] holds sold capacity on it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "phase", rename_all = "snake_case")]
pub enum Phase {
    /// The instance is being created, started when `start` (a full host
    /// creates it stopped and starts it later).
    Provisioning {
        /// Whether creation should also start the guest.
        start: bool,
    },
    /// The VM is starting (first boot, power on or restart); macrod not yet connected.
    Booting,
    /// Guest is running.
    Running,
    /// The guest crashed. With a `retry` it restarts when that is due; with
    /// none it gave up (too many crashes, a failed effect or a lost host),
    /// paged an operator, and waits for a retry, or for a sign of life when
    /// its cause can pass.
    Crashed {
        /// Crashes inside the current [`CRASH_WINDOW`].
        restarts: u8,
        /// The pending restart, if any.
        retry: Option<Retry>,
    },
    /// Guest is shutting down.
    Stopping,
    /// Guest is powered off.
    Stopped,
    /// Released: the guest, its root disk and its data disk are being (or
    /// have been) deleted. Terminal; frees the computer's sold capacity.
    Destroying,
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

/// What pays for the computer. Stored beside [`Phase`] in the state JSON
/// (`state.billing.billing`).
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "billing", rename_all = "snake_case")]
pub enum Billing {
    /// The team subscription bills this computer's own item.
    Active {
        /// The computer's subscription item.
        subscription_item: SubscriptionItemId,
    },
    /// The subscription is behind on payment since `since`; after the
    /// configured grace the computer is turned off, never destroyed.
    PastDue {
        /// When the lapse was first observed.
        since: DateTime<Utc>,
        /// The computer's subscription item.
        subscription_item: SubscriptionItemId,
    },
    /// No longer billed after `at` (the item is already removed): the
    /// computer stops at `at` and is destroyed after retention.
    EndsAt {
        /// End of the period paid for.
        at: DateTime<Utc>,
    },
    /// Provided without a charge.
    Comped {
        /// Why the computer is free.
        reason: String,
    },
    /// Bought and provisioning while its purchase's charge (the computer's
    /// item at its saved price, plus `extra_items`, keyed
    /// `computer-add:{computer id}`) settles. Nothing is billed yet; a
    /// refused charge releases it.
    Charging {
        /// Joined into the same subscription update as the computer's item.
        extra_items: Vec<crate::domain::models::SubscriptionItem>,
        /// Who is answering the charge now.
        charger: Charger,
    },
}

/// Who runs a just-bought computer's charge.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Charger {
    /// The purchase request, while the guest is created beside it.
    Request,
    /// The billing worker ([`Effect::Charge`]), after the request could not
    /// answer it: the outcome was unknown, or the request died.
    Worker,
}

/// Where the buyer heard that a purchase's charge was refused.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DeclineSeen {
    /// The purchase request answered the refusal itself (402), and its
    /// caller undoes whatever it set up for the computer.
    ByBuyer,
    /// The purchase was answered before the refusal was known (202), so
    /// the buyer is told and an agent teammate bought with it taken back.
    Later,
}

/// What a fenced charge's item is, if it landed after its computer was
/// released while charging.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum LandedCharge {
    /// Removed without proration, like any released computer's item.
    Remove,
    /// Refunded, then removed: the computer failed its first start.
    Refund,
}

impl Billing {
    /// The subscription item this computer is billed on, if it is.
    pub fn subscription_item(&self) -> Option<&SubscriptionItemId> {
        match self {
            Self::Active { subscription_item }
            | Self::PastDue {
                subscription_item, ..
            } => Some(subscription_item),
            Self::EndsAt { .. } | Self::Comped { .. } | Self::Charging { .. } => None,
        }
    }

    /// Whether the purchase's charge has not settled yet.
    pub fn is_charging(&self) -> bool {
        matches!(self, Self::Charging { .. })
    }
}

/// Everything the lifecycle knows about one computer.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct ComputerState {
    /// Purchase context retained across outbox retries and first-boot enrollment.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub provision_traceparent: Option<String>,
    /// First-setup milestones.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub setup: Option<crate::domain::setup::SetupTimeline>,
    /// Last observed guest phase.
    pub phase: Phase,
    /// What pays for the computer.
    pub billing: Billing,
    /// When [`Self::billing`] last changed; a subscription snapshot read
    /// before it cannot change it again.
    pub billing_changed_at: DateTime<Utc>,
    /// Requested power state.
    pub power: Power,
    /// Whether macrod is currently connected.
    pub macrod_connected: bool,
    /// Consecutive grace expirations while the guest remains running.
    pub macrod_misses: u8,
    /// Crash times inside the current [`CRASH_WINDOW`].
    pub recent_crashes: Vec<DateTime<Utc>>,
    /// A power-on is waiting for the computer to start.
    pub power_on_requested: bool,
    /// Absent until a start first waits for room.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub capacity_wait: Option<Retry>,
    /// The team retried it and it has not booted since; a give-up then is
    /// logged, not paged. Absent in rows written before it existed.
    #[serde(default)]
    pub retried_by_team: bool,
    /// Why the computer last gave up; cleared by a retry. Absent in rows
    /// written before it existed.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub failure: Option<Failure>,
    /// Bought for an agent teammate that hasn't reported itself online yet:
    /// its first start isn't over until it does. Absent in rows written
    /// before it existed.
    #[serde(default)]
    pub awaiting_agent: bool,
    /// Give-ups during the first start; at [`MAX_FIRST_START_FAILURES`] the
    /// computer is released and its purchase refunded.
    #[serde(default)]
    pub first_start_failures: u8,
    /// The refund of a computer released after failing its first start.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub refund: Option<PurchaseRefund>,
}

/// Why a computer gave up, in terms the team may see. The full error
/// stays in the logs and the operator page.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum Failure {
    /// The fleet could not create the guest.
    Create,
    /// The fleet could not start, stop or restart the guest.
    Power,
    /// The guest crashed [`MAX_CRASHES`] times inside [`CRASH_WINDOW`].
    KeptCrashing,
    /// The computer's host became unavailable.
    HostLost,
    /// No enrollment generation is left to recreate the guest with.
    SetupExhausted,
    /// The agent teammate didn't report itself online within
    /// [`AGENT_START_DEADLINE`] of macrod connecting.
    AgentNotStarted,
    /// The computer's macrod can't take an agent teammate: its image
    /// predates agent hand-off.
    AgentUnsupported,
    /// The purchase's charge was refused, so the computer was released.
    Payment,
}

impl Failure {
    /// The sentence the team sees.
    pub fn reason(self) -> &'static str {
        match self {
            Self::Create => "The computer couldn't be created on the host.",
            Self::Power => "The host couldn't start or stop the computer.",
            Self::KeptCrashing => "The computer kept crashing.",
            Self::HostLost => "The computer's host stopped responding.",
            Self::SetupExhausted => "The computer couldn't be set up again.",
            Self::AgentNotStarted => "The agent teammate didn't start on its computer.",
            Self::AgentUnsupported => "The computer's software can't run an agent teammate.",
            Self::Payment => "The payment for the computer didn't go through, so it was released.",
        }
    }

    /// Whether `sign` shows this give-up's cause has passed. A guest that
    /// kept crashing or that the host couldn't power is running if macrod
    /// connects; an agent that missed its deadline is running only once it
    /// reports online, since macrod was already connected when it missed.
    /// The rest can't pass by themselves and wait for a retry.
    fn ended_by(self, sign: SignOfLife) -> bool {
        match self {
            Self::Power | Self::KeptCrashing => true,
            Self::AgentNotStarted => sign == SignOfLife::AgentOnline,
            Self::Create
            | Self::HostLost
            | Self::SetupExhausted
            | Self::AgentUnsupported
            | Self::Payment => false,
        }
    }
}

/// Evidence that a computer which gave up is running after all.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum SignOfLife {
    MacrodConnected,
    AgentOnline,
}

impl ComputerState {
    /// The purchase context to parent work under during the first start,
    /// including handing an agent teammate over until it reports online.
    /// Later work returns `None` and links instead.
    pub fn setup_traceparent(&self) -> Option<&str> {
        self.provision_traceparent
            .as_deref()
            .filter(|_| self.first_start())
    }

    /// Whether the computer is still on its first start: setup hasn't
    /// finished, or the agent teammate it runs hasn't reported online.
    pub fn first_start(&self) -> bool {
        self.awaiting_agent || self.setup.as_ref().is_some_and(|setup| !setup.complete())
    }

    /// Whether an on request is waiting for host capacity rather than setup.
    pub fn waiting_for_capacity(&self) -> bool {
        self.power == Power::On
            && self.power_on_requested
            && matches!(
                self.phase,
                Phase::Provisioning { start: false } | Phase::Stopped
            )
    }

    /// Whether the purchase's payment is confirmed, for the setup timeline.
    pub fn payment_progress(&self) -> crate::domain::setup::PaymentProgress {
        if self.billing.is_charging() {
            crate::domain::setup::PaymentProgress::Charging
        } else {
            crate::domain::setup::PaymentProgress::Settled
        }
    }

    /// Whether the computer was released because its purchase's charge was
    /// refused: it never belonged to the team, so it is never listed.
    pub fn declined(&self) -> bool {
        self.phase == Phase::Destroying && self.failure == Some(Failure::Payment)
    }

    /// Whether the computer still holds sold capacity on its host.
    pub fn is_live(&self) -> bool {
        self.phase != Phase::Destroying
    }

    /// Whether the computer holds host RAM, i.e. counts against awake capacity.
    pub fn is_awake(&self) -> bool {
        match self.phase {
            Phase::Provisioning { start } => start,
            Phase::Booting | Phase::Running | Phase::Stopping => true,
            Phase::Crashed { retry, .. } => retry.is_some(),
            Phase::Stopped | Phase::Destroying => false,
        }
    }

    /// Whether the paid period is over (the computer is in retention).
    pub fn billing_ended(&self, now: DateTime<Utc>) -> bool {
        matches!(self.billing, Billing::EndsAt { at } if now >= at)
    }

    /// Whether the past-due grace is over, so the computer stays off.
    pub fn past_due_expired(&self, now: DateTime<Utc>, policy: BillingPolicy) -> bool {
        matches!(self.billing, Billing::PastDue { since, .. } if now >= since + policy.past_due_grace)
    }
}

/// Facts the applier gathers under the host lock before a transition.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Context {
    /// The computer's host.
    pub host: HostId,
    /// Last creation begun by the fleet; Create effects reserve its successor.
    pub enrollment_generation: EnrollmentGeneration,
    /// Current time used for this transition.
    pub now: DateTime<Utc>,
    /// Whether the computer's host has awake units free for it to start.
    pub host_has_room: bool,
    /// The deployment's retention and past-due grace.
    pub policy: BillingPolicy,
}

/// The first state of a just-bought computer, with the effects that start
/// provisioning it. A [`Billing::Charging`] computer is charged by its
/// purchase request beside the creation; its [`TimerKind::ChargeUnsettled`]
/// hands the charge to the billing worker if the request never answers.
pub fn provision(
    billing: Billing,
    setup: crate::domain::setup::SetupTimeline,
    provision_traceparent: Option<String>,
    for_agent: bool,
    context: Context,
) -> (ComputerState, Vec<Effect>) {
    let start = context.host_has_room;
    let mut state = ComputerState {
        provision_traceparent,
        setup: Some(setup),
        phase: Phase::Provisioning { start },
        billing,
        billing_changed_at: context.now,
        power: Power::On,
        macrod_connected: false,
        macrod_misses: 0,
        recent_crashes: Vec::new(),
        power_on_requested: !start,
        capacity_wait: None,
        retried_by_team: false,
        failure: None,
        awaiting_agent: for_agent,
        first_start_failures: 0,
        refund: None,
    };
    let mut effects = Vec::new();
    schedule_create(
        &mut state,
        &mut effects,
        context.host,
        start,
        context.enrollment_generation,
    );
    if state.billing.is_charging() {
        effects.push(Effect::ScheduleTimer {
            kind: TimerKind::ChargeUnsettled,
            at: context.now + CHARGE_TAKEOVER,
        });
    }
    (state, effects)
}

/// Apply one event. Requests that do not apply return [`Rejected`];
/// observations and timers that no longer apply change nothing, so
/// redelivery and stale timers are harmless.
pub fn transition(
    state: &ComputerState,
    event: &Event,
    context: Context,
) -> Result<(ComputerState, Vec<Effect>), Rejected> {
    let mut next = state.clone();
    let mut effects = Vec::new();
    let now = context.now;
    let host = context.host;
    let policy = context.policy;

    if let Event::PurchaseRefunded { refund } = event {
        next.refund = Some(refund.clone());
        return Ok((next, effects));
    }

    if state.phase == Phase::Destroying {
        return match event {
            Event::PowerOn
            | Event::PowerOff
            | Event::OperatorRetry
            | Event::TeamRetry
            | Event::CancelAtPeriodEnd { .. }
            | Event::UndoCancel { .. }
            | Event::Restore { .. }
            | Event::ReleaseNow => Err(Rejected::Released),
            _ => Ok((next, effects)),
        };
    }

    // Nothing is billed yet to cancel, undo or restore while the charge
    // settles. Releasing is allowed: it fences the charge.
    if state.billing.is_charging()
        && matches!(
            event,
            Event::CancelAtPeriodEnd { .. } | Event::UndoCancel { .. } | Event::Restore { .. }
        )
    {
        return Err(Rejected::PaymentPending);
    }

    match event {
        Event::InstanceLost => {
            next.macrod_connected = false;
            if state.billing_ended(now) {
                // The fleet still deletes the data volume the lost guest left.
                destroy(&mut next, &mut effects, host);
            } else {
                let start = state.power == Power::On && context.host_has_room;
                next.phase = Phase::Provisioning { start };
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
            if let Phase::Provisioning { start: true } = state.phase {
                if state.power == Power::On {
                    if state.macrod_connected {
                        next.phase = Phase::Running;
                        next.power_on_requested = false;
                    } else {
                        boot(&mut next, &mut effects, now, None);
                    }
                } else {
                    stop(&mut next, &mut effects, host);
                }
            }
        }

        Event::InstanceStopped => {
            if matches!(state.phase, Phase::Provisioning { .. } | Phase::Stopping) {
                next.phase = Phase::Stopped;
                next.macrod_connected = false;
                if state.power == Power::On && state.power_on_requested {
                    effects.push(Effect::ScheduleTimer {
                        kind: TimerKind::PowerOnRetry,
                        at: now + backoff(CAPACITY_BACKOFF, 0),
                    });
                }
            }
        }

        Event::MacrodConnected => {
            next.macrod_connected = true;
            next.macrod_misses = 0;
            let recovered = recover(state, &mut next, SignOfLife::MacrodConnected);
            // An agent's credentials are handed over only once its
            // computer is paid for: a charging one waits for the charge, and
            // one that gave up waits for a retry or a recovery.
            if state.awaiting_agent
                && (recovered || !state.macrod_connected)
                && !gave_up(&next.phase)
                && !state.billing.is_charging()
            {
                deliver_agent(&mut effects, now);
            }
            if let Phase::Booting = state.phase {
                if state.power == Power::On {
                    next.phase = Phase::Running;
                    next.power_on_requested = false;
                    next.retried_by_team = false;
                } else {
                    stop(&mut next, &mut effects, host);
                }
            }
        }

        Event::MacrodConnectedWithoutAgentHandOff => {
            // A give-up this connection would end still can't hand the agent
            // over: it fails for the macrod instead of recovering.
            let would_recover = gave_up(&state.phase)
                && state
                    .failure
                    .is_some_and(|failure| failure.ended_by(SignOfLife::MacrodConnected));
            if !state.awaiting_agent || (gave_up(&state.phase) && !would_recover) {
                return transition(state, &Event::MacrodConnected, context);
            }
            give_up(
                &mut next,
                &mut effects,
                Failure::AgentUnsupported,
                "macrod on this computer declared no apply-agent capability: its image \
                 predates agent hand-off"
                    .to_owned(),
            );
        }

        Event::MacrodDisconnected => {
            next.macrod_connected = false;
            if let Phase::Running = state.phase {
                effects.push(Effect::ScheduleTimer {
                    kind: TimerKind::MacrodMissing,
                    at: now + MACROD_GRACE,
                });
            }
        }

        Event::MacrodMissing { instance_status } => {
            let gone =
                !state.macrod_connected && matches!(state.phase, Phase::Booting | Phase::Running);
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
                    crash(&mut next, &mut effects, now);
                }
            }
        }

        Event::VmCrashed => match state.phase {
            Phase::Booting | Phase::Running => crash(&mut next, &mut effects, now),
            Phase::Stopping => {
                next.phase = Phase::Stopped;
                next.macrod_connected = false;
            }
            Phase::Provisioning { .. }
            | Phase::Crashed { .. }
            | Phase::Stopped
            | Phase::Destroying => {}
        },

        Event::RestartDue => {
            if let Phase::Crashed {
                retry: Some(retry), ..
            } = state.phase
                && now >= retry.next_at
            {
                boot(&mut next, &mut effects, now, Some(Effect::Restart { host }));
            }
        }

        Event::PowerOnRetry => {
            let due = state
                .capacity_wait
                .as_ref()
                .is_none_or(|wait| now >= wait.next_at);
            if state.power == Power::On && state.power_on_requested && due {
                power_on(&mut next, &mut effects, context);
            }
        }

        Event::CapacityChanged => {
            if state.waiting_for_capacity() {
                next.capacity_wait = None;
                power_on(&mut next, &mut effects, context);
            }
        }

        Event::PowerOn => {
            if state.billing_ended(now) {
                return Err(Rejected::BillingEnded);
            }
            if state.past_due_expired(now, policy) {
                return Err(Rejected::PastDue);
            }
            next.power = Power::On;
            power_on(&mut next, &mut effects, context);
        }

        Event::PowerOff => {
            next.power = Power::Off;
            power_down(&mut next, &mut effects, host);
        }

        Event::OperatorRetry | Event::TeamRetry => {
            let Phase::Crashed { retry: None, .. } = state.phase else {
                return Err(Rejected::NotFailed);
            };
            next.recent_crashes.clear();
            next.failure = None;
            next.retried_by_team = matches!(event, Event::TeamRetry);
            if state.power == Power::On {
                if context.host_has_room {
                    boot(&mut next, &mut effects, now, Some(Effect::Restart { host }));
                } else {
                    next.phase = Phase::Stopped;
                    next.power_on_requested = true;
                    wait_for_room(&mut next, &mut effects, now);
                }
            } else {
                next.phase = Phase::Stopped;
                // Nothing boots to clear the mark, so a later give-up pages.
                next.retried_by_team = false;
                effects.push(Effect::Stop { host });
            }
        }

        Event::AgentOnline => {
            next.awaiting_agent = false;
            if recover(state, &mut next, SignOfLife::AgentOnline) && !next.macrod_connected {
                // Watch for the connection the agent's report implies.
                effects.push(Effect::ScheduleTimer {
                    kind: TimerKind::MacrodMissing,
                    at: now + MACROD_GRACE,
                });
            }
        }

        // Only timed: see `SetupTimeline::advance_agent`.
        Event::AgentDelivered => {}

        Event::AgentRedeliver => {
            if state.awaiting_agent
                && state.macrod_connected
                && !gave_up(&state.phase)
                && !state.billing.is_charging()
            {
                effects.push(Effect::DeliverAgent);
                effects.push(Effect::ScheduleTimer {
                    kind: TimerKind::AgentRedeliver,
                    at: now + AGENT_REDELIVERY,
                });
            }
        }

        Event::AgentStartDue => {
            if state.awaiting_agent && state.macrod_connected && !gave_up(&state.phase) {
                give_up(
                    &mut next,
                    &mut effects,
                    Failure::AgentNotStarted,
                    "the agent teammate never reported online".to_owned(),
                );
            }
        }

        // Handled before the phase checks above.
        Event::PurchaseRefunded { .. } => {}

        Event::HostLost => {
            if !gave_up(&state.phase) {
                give_up(
                    &mut next,
                    &mut effects,
                    Failure::HostLost,
                    "host lost".to_owned(),
                );
            }
        }

        Event::Moved => match state.phase {
            // It was stopped for the move: boot it on its new host, which
            // `host` (the row's host_id) already is, with the idempotent
            // start a crashed guest gets.
            Phase::Running | Phase::Booting => {
                boot(&mut next, &mut effects, now, Some(Effect::Restart { host }));
            }
            // A stop in flight completes on the new host.
            Phase::Stopping => {
                next.macrod_connected = false;
                next.macrod_misses = 0;
                effects.push(Effect::Stop { host });
            }
            Phase::Stopped | Phase::Crashed { .. } => {
                next.macrod_connected = false;
                next.macrod_misses = 0;
            }
            Phase::Provisioning { .. } | Phase::Destroying => return Err(Rejected::NotMovable),
        },

        Event::EffectFailed { failure, reason } => {
            if !gave_up(&state.phase) {
                give_up(&mut next, &mut effects, *failure, reason.clone());
            }
        }

        Event::CancelAtPeriodEnd { .. }
        | Event::UndoCancel { .. }
        | Event::Restore { .. }
        | Event::ReleaseNow
        | Event::PaymentLapsed { .. }
        | Event::PaymentRecovered { .. }
        | Event::BillingItemMissing { .. }
        | Event::BillingItemMoved { .. }
        | Event::BillingEnds
        | Event::PastDueGrace
        | Event::RetentionExpired
        | Event::ChargeSucceeded { .. }
        | Event::ChargeUnsettled
        | Event::ChargeFailed { .. } => {
            billing::transition(state, event, context, &mut next, &mut effects)?;
        }
    }

    if !next.waiting_for_capacity() {
        next.capacity_wait = None;
    }
    if next.billing != state.billing {
        next.billing_changed_at = now;
    }
    // A host outage is not the computer's failure: counting it would release
    // and refund every computer that was setting up on the host.
    if state.first_start()
        && !gave_up(&state.phase)
        && gave_up(&next.phase)
        && next.failure != Some(Failure::HostLost)
    {
        next.first_start_failures = state.first_start_failures.saturating_add(1);
        if next.first_start_failures >= MAX_FIRST_START_FAILURES {
            release_failed_start(state, &mut next, &mut effects, host, now);
            return Ok((next, effects));
        }
    }
    if let Some(outcome) = setup_outcome(state, &next, now) {
        effects.push(Effect::NotifySetup { outcome });
    }
    Ok((next, effects))
}

/// A computer that failed its first start [`MAX_FIRST_START_FAILURES`]
/// times: release it, refund its purchase and take back the agent teammate
/// it was bought for. The team is not billed for a computer that never
/// worked, and nothing it bought is left behind.
fn release_failed_start(
    state: &ComputerState,
    next: &mut ComputerState,
    effects: &mut Vec<Effect>,
    host: HostId,
    now: DateTime<Utc>,
) {
    // The give-up's own page is replaced by the release.
    effects.retain(|effect| !matches!(effect, Effect::PageOperator { .. }));
    next.billing = Billing::EndsAt { at: now };
    next.power = Power::Off;
    next.awaiting_agent = false;
    destroy(next, effects, host);
    if let Some(subscription_item) = state.billing.subscription_item() {
        effects.push(Effect::RefundPurchase {
            subscription_item: subscription_item.clone(),
        });
    }
    // The charge may still land: fence it, and refund an item that did.
    if state.billing.is_charging() {
        effects.push(Effect::SettleCharge {
            landed: LandedCharge::Refund,
        });
    }
    effects.push(Effect::UndoAgentInvite);
    if let Some(failure) = next.failure {
        effects.push(Effect::NotifySetup {
            outcome: SetupOutcome::Released {
                failure,
                failed_at: now,
            },
        });
    }
}

/// How this transition ended first setup, if it did. The applier latches
/// `setup.connected_at` on the first connection, so `Ready` comes once; a
/// give-up comes once per attempt, since only a retry leaves it.
fn setup_outcome(
    state: &ComputerState,
    next: &ComputerState,
    now: DateTime<Utc>,
) -> Option<SetupOutcome> {
    if !state.first_start() {
        return None;
    }
    let setting_up = state.setup.as_ref().is_some_and(|setup| !setup.complete());
    if setting_up && !state.macrod_connected && next.macrod_connected {
        return Some(SetupOutcome::Ready);
    }
    if !gave_up(&state.phase) && gave_up(&next.phase) {
        return next.failure.map(|failure| SetupOutcome::Failed {
            failure,
            failed_at: now,
        });
    }
    None
}

/// Hand the agent teammate to the connected macrod and give it
/// [`AGENT_START_DEADLINE`] to report online.
fn deliver_agent(effects: &mut Vec<Effect>, now: DateTime<Utc>) {
    effects.push(Effect::DeliverAgent);
    effects.push(Effect::ScheduleTimer {
        kind: TimerKind::AgentStartDue,
        at: now + AGENT_START_DEADLINE,
    });
    effects.push(Effect::ScheduleTimer {
        kind: TimerKind::AgentRedeliver,
        at: now + AGENT_REDELIVERY,
    });
}

/// Enter Booting, optionally with the effect that starts the VM, and arm the
/// timer that treats a macrod that never connects as a crash.
fn boot(
    next: &mut ComputerState,
    effects: &mut Vec<Effect>,
    now: DateTime<Utc>,
    start: Option<Effect>,
) {
    next.phase = Phase::Booting;
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

/// Restart with [`RESTART_BACKOFF`], or give up after [`MAX_CRASHES`].
fn crash(next: &mut ComputerState, effects: &mut Vec<Effect>, now: DateTime<Utc>) {
    next.recent_crashes.retain(|at| now - *at < CRASH_WINDOW);
    next.recent_crashes.push(now);
    next.macrod_connected = false;

    let crashes = next.recent_crashes.len();
    if crashes >= MAX_CRASHES {
        give_up(
            next,
            effects,
            Failure::KeptCrashing,
            format!(
                "{crashes} crashes in {} minutes",
                CRASH_WINDOW.num_minutes()
            ),
        );
        return;
    }

    let restarts = u8::try_from(crashes).unwrap_or(u8::MAX);
    let retry = Retry::after(RESTART_BACKOFF, restarts.saturating_sub(1), now);
    next.phase = Phase::Crashed {
        restarts,
        retry: Some(retry),
    };
    effects.push(Effect::ScheduleTimer {
        kind: TimerKind::RestartDue,
        at: retry.next_at,
    });
}

pub(crate) fn gave_up(phase: &Phase) -> bool {
    matches!(phase, Phase::Crashed { retry: None, .. })
}

/// End a give-up that `sign` shows has passed: the guest never stopped
/// (a give-up stops nothing), so it is running again, and the failure and
/// crash count are cleared. A computer the team turned off stays as it is.
/// Returns whether it recovered.
fn recover(state: &ComputerState, next: &mut ComputerState, sign: SignOfLife) -> bool {
    let passed = state.failure.is_some_and(|failure| failure.ended_by(sign));
    if !gave_up(&state.phase) || state.power != Power::On || !passed {
        return false;
    }
    tracing::info!(failure = ?state.failure, sign = ?sign, "a computer that gave up is running again");
    next.phase = Phase::Running;
    next.failure = None;
    next.recent_crashes.clear();
    next.macrod_misses = 0;
    next.power_on_requested = false;
    next.retried_by_team = false;
    true
}

/// Stop restarting and page an operator; a retry resumes, and so does a
/// sign of life when the cause can pass ([`Failure::ended_by`]). Whether
/// macrod is connected is presence, not lifecycle, and stays as observed.
fn give_up(next: &mut ComputerState, effects: &mut Vec<Effect>, failure: Failure, reason: String) {
    next.failure = Some(failure);
    next.phase = Phase::Crashed {
        restarts: u8::try_from(next.recent_crashes.len()).unwrap_or(u8::MAX),
        retry: None,
    };
    next.power_on_requested = false;
    if next.retried_by_team {
        tracing::warn!(reason = %reason, "a computer the team retried gave up again; not paging");
    } else {
        effects.push(Effect::PageOperator { reason });
    }
}

fn stop(next: &mut ComputerState, effects: &mut Vec<Effect>, host: HostId) {
    next.phase = Phase::Stopping;
    effects.push(Effect::Stop { host });
}

/// Bring the computer to rest after the team (or billing) turned it off.
fn power_down(next: &mut ComputerState, effects: &mut Vec<Effect>, host: HostId) {
    next.power_on_requested = false;
    match next.phase {
        Phase::Booting | Phase::Running | Phase::Crashed { retry: Some(_), .. } => {
            stop(next, effects, host)
        }
        // A computer that gave up holds no awake units; stop whatever is left of it.
        Phase::Crashed { retry: None, .. } => {
            next.phase = Phase::Stopped;
            effects.push(Effect::Stop { host });
        }
        Phase::Provisioning { .. } | Phase::Stopping | Phase::Stopped | Phase::Destroying => {}
    }
}

fn destroy(next: &mut ComputerState, effects: &mut Vec<Effect>, host: HostId) {
    next.phase = Phase::Destroying;
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
        None => give_up(
            state,
            effects,
            Failure::SetupExhausted,
            "enrollment generation exhausted".to_owned(),
        ),
    }
}
