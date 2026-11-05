//! What the computer services need from the outside world.

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::domain::enrollment::Enrollment;
use crate::domain::lifecycle::{Effect, EffectWorker, Event, HostId, TimerKind};
use crate::domain::models::{
    BillingInterval, Computer, ControlPlaneId, Host, HostRegistration, NewComputer, Quote,
    SubscriptionItem,
};
use crate::domain::size::ComputerSize;

/// Classifies a fleet failure that requires replacing a lost guest.
pub trait FleetError: std::error::Error + Send + Sync + 'static {
    /// True only when the addressed instance no longer exists.
    fn is_missing(&self) -> bool;
}

/// An effect waiting in the outbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingEffect {
    /// Outbox id; workers key idempotency on it.
    pub id: i64,
    pub computer_id: Uuid,
    pub effect: Effect,
    pub attempts: u32,
}

/// A timer that came due.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DueTimer {
    pub computer_id: Uuid,
    pub kind: TimerKind,
    pub fire_at: DateTime<Utc>,
}

/// Why units could not be reserved.
#[derive(Debug, thiserror::Error)]
pub enum ReserveError<Err> {
    #[error("no host has room for this size")]
    SoldOut,
    #[error(transparent)]
    Storage(Err),
}

/// Computers, hosts, the effect outbox and timers, in one store so an event
/// and its effects commit together.
pub trait ComputerRepo: Send + Sync + 'static {
    type Err: std::error::Error + Send + Sync + 'static;

    /// Serializes payment resolution through its lifecycle write across replicas.
    type PaymentGuard: Send;

    fn lock_payment(
        &self,
        computer_id: Uuid,
    ) -> impl Future<Output = Result<Self::PaymentGuard, Self::Err>> + Send;

    /// Hold the computer's units on the host with the most sold capacity
    /// left, and insert it in [`crate::domain::lifecycle::Phase::PendingPayment`]
    /// with its delayed ConfirmPayment billing effect, in one transaction.
    fn reserve(
        &self,
        computer: NewComputer,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Computer, ReserveError<Self::Err>>> + Send;

    /// Lock the computer and its host, run the lifecycle transition, and
    /// store the new state, its effects and its timers in one transaction.
    /// `None` when the computer does not exist.
    fn apply(
        &self,
        computer_id: Uuid,
        event: Event,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<Computer>, Self::Err>> + Send;

    fn get(
        &self,
        computer_id: Uuid,
    ) -> impl Future<Output = Result<Option<Computer>, Self::Err>> + Send;

    /// The team's computers that are not released, oldest first.
    fn list_for_team(
        &self,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Vec<Computer>, Self::Err>> + Send;

    /// The computer whose harness this is.
    fn find_by_harness(
        &self,
        harness_id: Uuid,
    ) -> impl Future<Output = Result<Option<Computer>, Self::Err>> + Send;

    fn set_harness(
        &self,
        computer_id: Uuid,
        harness_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Record the first macrod connection; later calls keep the first time.
    fn mark_enrolled(
        &self,
        computer_id: Uuid,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Running computers with their harness, for the idle sweep.
    fn running(&self) -> impl Future<Output = Result<Vec<Computer>, Self::Err>> + Send;

    /// The frozen computer on `host` that has been frozen longest.
    fn coldest_frozen(
        &self,
        host: HostId,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;

    /// Computers the fleet should hold an instance for on `host`.
    fn instances_expected(
        &self,
        host: HostId,
    ) -> impl Future<Output = Result<Vec<Computer>, Self::Err>> + Send;

    /// Lease up to `limit` due effects for `worker`; a leased effect is
    /// hidden from other workers until `lease_until`.
    fn lease_effects(
        &self,
        worker: EffectWorker,
        limit: u32,
        now: DateTime<Utc>,
        lease_until: DateTime<Utc>,
    ) -> impl Future<Output = Result<Vec<PendingEffect>, Self::Err>> + Send;

    fn complete_effect(&self, id: i64) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Record a failed attempt and run the effect again at `retry_at`.
    fn retry_effect(
        &self,
        id: i64,
        error: String,
        retry_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Timers due at `now`, oldest first.
    fn due_timers(
        &self,
        now: DateTime<Utc>,
        limit: u32,
    ) -> impl Future<Output = Result<Vec<DueTimer>, Self::Err>> + Send;

    /// Delete the timer if it is still the one that came due and apply its
    /// event, in one transaction. A timer replaced meanwhile is left alone.
    fn fire_timer(
        &self,
        timer: DueTimer,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<Computer>, Self::Err>> + Send;

    /// Insert or refresh a host and its capacity.
    fn register_host(
        &self,
        registration: HostRegistration,
    ) -> impl Future<Output = Result<Host, Self::Err>> + Send;

    /// Sizes that no host can sell right now.
    fn sold_out_sizes(&self) -> impl Future<Output = Result<Vec<ComputerSize>, Self::Err>> + Send;

    /// Ask to hear when `size` can be bought again.
    fn request_notify(
        &self,
        team_id: Uuid,
        user_id: String,
        size: ComputerSize,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    fn notify_requests(
        &self,
        team_id: Uuid,
        user_id: String,
    ) -> impl Future<Output = Result<Vec<ComputerSize>, Self::Err>> + Send;
}

/// Errors from billing a team.
#[derive(Debug, thiserror::Error)]
pub enum BillingError {
    #[error("the team has no active subscription")]
    NoSubscription,
    #[error("computers are not sold on {0:?} billing")]
    IntervalNotSold(BillingInterval),
    #[error("the payment did not go through")]
    PaymentFailed,
    #[error("billing provider error: {0:?}")]
    Provider(rootcause::Report),
}

/// The team subscription, where computers are billed as items.
pub trait Billing: Send + Sync + 'static {
    /// The price of one computer of `size` at the team's billing interval.
    fn quote(
        &self,
        team_id: Uuid,
        size: ComputerSize,
    ) -> impl Future<Output = Result<Quote, BillingError>> + Send;

    /// Add one `size` computer plus `extra_items` to the team subscription
    /// in ONE update, invoiced now with proration. `idempotency_key` makes a
    /// retried call a no-op.
    fn add_computer(
        &self,
        team_id: Uuid,
        size: ComputerSize,
        extra_items: &[SubscriptionItem],
        idempotency_key: &str,
    ) -> impl Future<Output = Result<(), BillingError>> + Send;

    /// Remove one `size` computer from the team subscription, without a refund.
    fn remove_computer(
        &self,
        team_id: Uuid,
        size: ComputerSize,
        idempotency_key: &str,
    ) -> impl Future<Output = Result<(), BillingError>> + Send;

    /// When the team's current billing period ends.
    fn period_end(
        &self,
        team_id: Uuid,
    ) -> impl Future<Output = Result<DateTime<Utc>, BillingError>> + Send;
}

/// The VMs (or dev containers) computers run in.
/// Instance operations classify a lost guest with [`FleetError::is_missing`].
/// Stop and destroy succeed when the instance is already absent.
pub trait Fleet: Send + Sync + 'static {
    type Err: FleetError;

    /// Stable owner of every instance this fleet creates and lists.
    fn control_plane_id(&self) -> &ControlPlaneId;

    /// Create the instance from the base image, carrying `enrollment`, and
    /// start it when `start`. An instance that already exists is reused.
    fn create(
        &self,
        computer: &Computer,
        enrollment: &Enrollment,
        start: bool,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    fn start(&self, computer_id: Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;
    fn stop(&self, computer_id: Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;
    fn restart(&self, computer_id: Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;
    fn freeze(&self, computer_id: Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;
    fn unfreeze(&self, computer_id: Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Save RAM to disk and stop. A fleet without stateful stop stops cold
    /// and its resume boots fresh; the lifecycle does not need to know.
    fn suspend(&self, computer_id: Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;
    fn resume(&self, computer_id: Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete the instance and its disk. A missing instance is not an error.
    fn destroy(&self, computer_id: Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete the one-time enrollment once macrod has used it.
    fn clear_enrollment(
        &self,
        computer_id: Uuid,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Only instances stamped with this fleet's control-plane identity.
    fn instances(&self) -> impl Future<Output = Result<Vec<FleetInstance>, Self::Err>> + Send;

    /// The host this fleet drives, for registration.
    fn host(&self) -> impl Future<Output = Result<HostRegistration, Self::Err>> + Send;
}

/// Ownership and age observed on the guest, independent of the computer row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FleetInstance {
    pub computer_id: Uuid,
    pub status: InstanceStatus,
    pub control_plane_id: ControlPlaneId,
    /// Missing or malformed timestamps never permit orphan deletion.
    pub created_at: Option<DateTime<Utc>>,
}

/// What the fleet observes about an instance.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InstanceStatus {
    Running,
    Frozen,
    Stopped,
}

/// A harness pre-approved for a computer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostedPairing {
    pub pairing_id: Uuid,
    pub device_secret: String,
}

/// The harness registry macrod pairs with.
pub trait Harnesses: Send + Sync + 'static {
    type Err: std::error::Error + Send + Sync + 'static;

    /// Create, or re-key, the team harness for a computer.
    fn create_hosted_pairing(
        &self,
        computer: &Computer,
    ) -> impl Future<Output = Result<HostedPairing, Self::Err>> + Send;

    /// The computer a harness runs on, if it is a computer's.
    fn computer_for(
        &self,
        harness_id: Uuid,
    ) -> impl Future<Output = Result<Option<Uuid>, Self::Err>> + Send;

    /// Delete the computer's harness and its credential; absent is fine.
    fn revoke(&self, computer_id: Uuid) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// Server-side eligibility for complimentary computers.
pub trait CompPolicy: Send + Sync + 'static {
    type Err: std::error::Error + Send + Sync + 'static;

    fn comp_reason(
        &self,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Option<String>, Self::Err>> + Send;
}

/// Explicit default policy: every team pays through Stripe.
#[derive(Debug, Clone, Copy)]
pub struct NoComps;

impl CompPolicy for NoComps {
    type Err = std::convert::Infallible;

    async fn comp_reason(&self, _team_id: Uuid) -> Result<Option<String>, Self::Err> {
        Ok(None)
    }
}
