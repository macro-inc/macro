//! What happens to a computer (events), what may be refused (rejections), and
//! what the lifecycle asks for in return (effects and timers).

use super::*;

/// Something that happened to a computer, or something asked of it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "event", rename_all = "snake_case")]
pub enum Event {
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
    /// The guest no longer exists: recreate it on its host, or destroy what
    /// is left once billing has ended.
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
    /// Retry a computer that gave up restarting.
    OperatorRetry,
    /// The team retried a computer that gave up. Like [`Self::OperatorRetry`],
    /// but a give-up before the computer next boots is not paged: a team
    /// retrying repeatedly must not page on-call each time.
    TeamRetry,
    /// A fleet effect failed after its retries, or for good at once; an
    /// operator looks.
    EffectFailed {
        /// What failed, as the team sees it.
        failure: Failure,
        /// The full error, for the logs and the operator page.
        reason: String,
    },
    /// Stop billing at `at`, the end of the current period. The item is
    /// removed at once without proration (the period is paid).
    CancelAtPeriodEnd {
        /// End of the period paid for.
        at: DateTime<Utc>,
    },
    /// Keep a canceled computer before its period ends; billing re-added
    /// `subscription_item` without proration.
    UndoCancel {
        /// The re-added item.
        subscription_item: SubscriptionItemId,
    },
    /// Keep a computer in retention; billing is `Active` (item re-added,
    /// prorated) or `Comped`.
    Restore {
        /// The computer's billing from now on.
        billing: Billing,
    },
    /// Release now: stop billing and destroy immediately.
    ReleaseNow,
    /// The subscription went past due, unpaid or paused, per a snapshot read at `observed_at`.
    PaymentLapsed {
        /// When the subscription snapshot was read.
        observed_at: DateTime<Utc>,
    },
    /// The subscription is paid again, per a snapshot read at `observed_at`.
    PaymentRecovered {
        /// When the subscription snapshot was read.
        observed_at: DateTime<Utc>,
    },
    /// The computer's item is gone from the subscription (or the
    /// subscription ended), per a snapshot read at `observed_at`.
    BillingItemMissing {
        /// When the subscription snapshot was read.
        observed_at: DateTime<Utc>,
    },
    /// The item carrying this computer's id changed, per a snapshot read at `observed_at`.
    BillingItemMoved {
        /// The item that now carries the computer.
        subscription_item: SubscriptionItemId,
        /// When the subscription snapshot was read.
        observed_at: DateTime<Utc>,
    },
    /// Timer: the end of a canceled computer's paid period.
    BillingEnds,
    /// Timer: the past-due grace may be over.
    PastDueGrace,
    /// Timer: the retained disk may now be deleted.
    RetentionExpired,
}

/// Why a requested change does not apply in the computer's state. Only
/// requests are rejected; observations and timers that no longer apply are
/// ignored.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum Rejected {
    /// The computer was released.
    #[error("this computer was released")]
    Released,
    /// Only a computer that gave up restarting may be retried.
    #[error("only a failed computer can be retried")]
    NotFailed,
    /// The computer is already canceled.
    #[error("this computer is already canceled")]
    AlreadyCanceled,
    /// The computer is not canceled.
    #[error("this computer is not canceled")]
    NotCanceled,
    /// The paid period is over; restore the computer instead.
    #[error("billing for this computer has ended; restore it to keep it")]
    BillingEnded,
    /// The paid period has not ended; undo the cancellation instead.
    #[error("billing for this computer has not ended yet; undo the cancellation instead")]
    BillingNotEnded,
    /// A restore must make the computer billed or comped again.
    #[error("a restored computer must be billed or comped")]
    InvalidRestore,
    /// The subscription is past due beyond its grace.
    #[error("the team subscription is past due; update the payment method first")]
    PastDue,
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
#[cfg_attr(feature = "outbound", derive(sqlx::Type))]
#[cfg_attr(
    feature = "outbound",
    sqlx(type_name = "computer_timer_kind", rename_all = "snake_case")
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
    /// The end of a canceled computer's paid period.
    BillingEnds,
    /// The end of the past-due grace.
    PastDueGrace,
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
            Self::BillingEnds => Event::BillingEnds,
            Self::PastDueGrace => Event::PastDueGrace,
            Self::RetentionExpired => Event::RetentionExpired,
        }
    }
}

/// Something the lifecycle wants done.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "effect", rename_all = "snake_case")]
pub enum Effect {
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
    /// Delete the guest, its root disk and its data disk.
    Destroy {
        /// Host holding the computer.
        host: HostId,
    },
    /// Remove this computer's own item from the team subscription, without
    /// proration. An item or subscription already gone counts as removed.
    RemoveBillingItem {
        /// The item to remove.
        subscription_item: SubscriptionItemId,
    },
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
    /// Tell the buyer how first setup ended.
    NotifySetup {
        /// Ready, or why it failed.
        outcome: SetupOutcome,
    },
}

/// How a computer's first setup ended, as its buyer hears it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "outcome", rename_all = "snake_case")]
pub enum SetupOutcome {
    /// macrod connected for the first time. Happens once per computer.
    Ready,
    /// Setup gave up before macrod ever connected. A team retry that gives
    /// up again is a new outcome with a later `failed_at`.
    Failed {
        /// Why, as the team sees it.
        failure: Failure,
        /// When setup gave up; tells one attempt's failure from the next.
        failed_at: DateTime<Utc>,
    },
}

impl Effect {
    /// Which worker carries the effect out. Billing runs where Stripe lives.
    pub fn worker(&self) -> EffectWorker {
        match self {
            Self::RemoveBillingItem { .. } => EffectWorker::Billing,
            Self::ScheduleTimer { .. } => EffectWorker::Timers,
            Self::Create { .. }
            | Self::Start { .. }
            | Self::Stop { .. }
            | Self::Restart { .. }
            | Self::RestartMacrod { .. }
            | Self::Destroy { .. }
            | Self::RevokeHarness
            | Self::PageOperator { .. }
            | Self::NotifySetup { .. } => EffectWorker::Fleet,
        }
    }
}

#[derive(
    Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize, strum::AsRefStr, strum::EnumString,
)]
/// Worker responsible for an outbox action. Timer effects never reach the
/// outbox: they are stored as timers.
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
