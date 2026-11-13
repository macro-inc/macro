//! What the computer services need from the outside world.

pub use crate::domain::lifecycle::InstanceStatus;

use bot_id::BotId;
use harness_id::HarnessId;
use std::collections::HashMap;
use std::pin::Pin;

use chrono::{DateTime, Utc};
use uuid::Uuid;

use crate::domain::enrollment::{
    DeviceSecret, Enrollment, EnrollmentGeneration, EnrollmentIssueError,
};
use crate::domain::ids::{ComputerId, PairingId};
use crate::domain::image::GuestImage;
use crate::domain::lifecycle::{
    Billing as ComputerBilling, BillingPolicy, Effect, EffectWorker, Event, HostId, Rejected,
    SetupOutcome, SubscriptionItemId, TimerKind,
};
use crate::domain::models::{
    BillingInterval, Computer, ComputerRecord, ControlPlaneId, Host, HostAllocation,
    HostRegistration, NewReservation, Quote, Reservation, Reserved, SubscriptionItem,
};
use crate::domain::size::ComputerSize;

/// Supplies advisory fleet operator presence at the caller's time.
pub trait FleetAttachmentSource: Send + Sync + 'static {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Read whether any operator is attached.
    fn attachment(
        &self,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<crate::domain::models::FleetAttachment, Self::Err>> + Send;
}

/// Explicit attachment for callers with static operator knowledge and tests.
#[derive(Debug, Clone, Copy)]
pub struct StaticFleetAttachment(pub crate::domain::models::FleetAttachment);

impl FleetAttachmentSource for StaticFleetAttachment {
    type Err = std::convert::Infallible;

    async fn attachment(
        &self,
        _now: DateTime<Utc>,
    ) -> Result<crate::domain::models::FleetAttachment, Self::Err> {
        Ok(self.0)
    }
}

/// Storage could not be reached at all right now (no connection to be had
/// from the pool). An adapter reports it as the source of its error; the
/// passes skip that tick and retry on the next, never counting it as a
/// failed attempt. See [`crate::domain::service::ComputerError::is_storage_unavailable`].
#[derive(Debug, thiserror::Error)]
#[error("computer storage is unavailable right now")]
pub struct StorageUnavailable(#[source] pub Box<dyn std::error::Error + Send + Sync + 'static>);

/// Classifies a fleet failure: a lost guest is replaced, a permanent
/// failure fails the computer at once, anything else is retried.
pub trait FleetError: std::error::Error + Send + Sync + 'static {
    /// True only when the addressed instance no longer exists.
    fn is_missing(&self) -> bool;
    /// True when retrying the same request cannot succeed, such as a
    /// request the fleet rejected as invalid.
    fn is_permanent(&self) -> bool;
}

/// An effect waiting in the outbox.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PendingEffect {
    /// Outbox id; workers key idempotency on it.
    pub id: i64,
    /// Computer this operation addresses.
    pub computer_id: ComputerId,
    /// Lifecycle action to execute.
    pub effect: Effect,
    /// Number of failed execution attempts.
    pub attempts: u32,
}

/// A timer that came due.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DueTimer {
    /// Computer this operation addresses.
    pub computer_id: ComputerId,
    /// Timer event to deliver.
    pub kind: TimerKind,
    /// Time this timer becomes due.
    pub fire_at: DateTime<Utc>,
}

/// Why units could not be reserved.
#[derive(Debug, thiserror::Error)]
pub enum ReserveError<Err> {
    /// No host that can run the size awake has enough sale capacity.
    #[error("no host has room for this size")]
    SoldOut,
    /// Reservation storage failed.
    #[error(transparent)]
    Storage(Err),
}

/// What applying an event to a stored computer did.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Applied {
    /// The transition ran; the computer as stored afterwards.
    Changed(Box<Computer>),
    /// The lifecycle refused the request; nothing changed.
    Rejected(Rejected),
}

/// Computers, reservations, hosts, the effect outbox and timers, in one
/// store so an event and its effects commit together.
pub trait ComputerRepo: Send + Sync + 'static {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Serializes fleet enrollment with the harness claim transaction.
    type EnrollmentGuard: Send;

    /// Serializes everything that changes one computer's billing item.
    type BillingGuard: Send;

    /// The deployment's retention and past-due grace, used by every transition.
    fn policy(&self) -> BillingPolicy;

    /// Hold the enrollment guard through guest creation and claim checks.
    fn lock_enrollment(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Self::EnrollmentGuard, Self::Err>> + Send;

    /// Hold the computer's billing guard: undo, restore, item removal and
    /// stray-item cleanup decide and talk to the billing provider under it,
    /// so none of them acts on a billing state another is changing.
    fn lock_billing(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Self::BillingGuard, Self::Err>> + Send;

    /// Under the host lock: return what `reservation.purchase_key` already
    /// led to, or hold the purchase's units until `expires_at` on the host,
    /// among those whose awake capacity fits them, with the most sold
    /// capacity left (sold capacity minus live computers and
    /// reservations, expired or not: an expired one may still settle as
    /// charged).
    fn reserve(
        &self,
        reservation: NewReservation,
        now: DateTime<Utc>,
        expires_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<Reserved, ReserveError<Self::Err>>> + Send;

    /// In one transaction: delete the reservation, insert its computer with
    /// `billing`, starting provisioning, and enqueue its creation. `None`
    /// when the reservation is gone (another worker converted or deleted it).
    fn convert_reservation(
        &self,
        reservation_id: ComputerId,
        billing: ComputerBilling,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<Computer>, Self::Err>> + Send;

    /// Delete a reservation whose charge did not happen; false when it was already gone.
    fn delete_reservation(
        &self,
        reservation_id: ComputerId,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// One reservation.
    fn reservation(
        &self,
        reservation_id: ComputerId,
    ) -> impl Future<Output = Result<Option<Reservation>, Self::Err>> + Send;

    /// The team's reservations, oldest first.
    fn team_reservations(
        &self,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Vec<Reservation>, Self::Err>> + Send;

    /// Reservations created at or before `created_before`, oldest first, for the confirm worker.
    fn reservations_created_before(
        &self,
        created_before: DateTime<Utc>,
        limit: u32,
    ) -> impl Future<Output = Result<Vec<Reservation>, Self::Err>> + Send;

    /// Lock the computer and its host, run the lifecycle transition, and
    /// store the new state, its effects and its timers in one transaction.
    /// `None` when the computer does not exist; quarantine rejects events
    /// without changing work.
    fn apply(
        &self,
        computer_id: ComputerId,
        event: Event,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<Applied>, Self::Err>> + Send;

    /// Read a computer by identity, preserving quarantined rows as present.
    fn get(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Option<ComputerRecord>, Self::Err>> + Send;

    /// The team's computers that are not released, oldest first.
    fn list_for_team(
        &self,
        team_id: Uuid,
    ) -> impl Future<Output = Result<Vec<ComputerRecord>, Self::Err>> + Send;

    /// The computer whose harness this is.
    fn find_by_harness(
        &self,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<Option<Computer>, Self::Err>> + Send;

    /// Every awake computer that has a harness, as `(harness, computer)`.
    fn awake_computers(
        &self,
    ) -> impl Future<Output = Result<Vec<(HarnessId, ComputerId)>, Self::Err>> + Send;

    /// Attach the guest harness to its computer.
    fn set_harness(
        &self,
        computer_id: ComputerId,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Record the first macrod connection; later calls keep the first time.
    fn mark_enrolled(
        &self,
        computer_id: ComputerId,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// How many live agents are bound to each computer's live harness;
    /// computers without any are absent.
    fn agent_counts(
        &self,
        computer_ids: &[ComputerId],
    ) -> impl Future<Output = Result<HashMap<ComputerId, u32>, Self::Err>> + Send;

    /// Record the image the guest was created from.
    fn record_image(
        &self,
        computer_id: ComputerId,
        image: &GuestImage,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Record the coding agent the computer came with.
    fn set_default_agent(
        &self,
        computer_id: ComputerId,
        agent_id: BotId,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Record that the team finished the guided setup; later calls keep the
    /// first time. Returns the computer, or `None` when it does not exist.
    fn complete_setup(
        &self,
        computer_id: ComputerId,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<ComputerRecord>, Self::Err>> + Send;

    /// Computers the fleet should hold an instance for on `host`, including quarantined ids.
    fn instances_expected(
        &self,
        host: HostId,
    ) -> impl Future<Output = Result<Vec<ComputerRecord>, Self::Err>> + Send;

    /// Lease up to `limit` due effects for `worker`; a leased effect is
    /// hidden from other workers until `lease_until`. Exclude quarantined owners before the limit.
    fn lease_effects(
        &self,
        worker: EffectWorker,
        limit: u32,
        now: DateTime<Utc>,
        lease_until: DateTime<Utc>,
    ) -> impl Future<Output = Result<Vec<PendingEffect>, Self::Err>> + Send;

    /// Return only these unfinished fleet leases, provided they still have this deadline.
    /// Never release another worker's leases or overwrite a recorded retry backoff.
    fn release_effects(
        &self,
        ids: &[i64],
        lease_until: DateTime<Utc>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete a successfully executed outbox effect.
    fn complete_effect(&self, id: i64) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Atomically complete a fleet effect and apply its completion event.
    /// A lost write leaves both the effect and the lifecycle unchanged for retry.
    fn finish_effect(
        &self,
        id: i64,
        completion: Option<Event>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Record a failed attempt and run the effect again at `retry_at`.
    fn retry_effect(
        &self,
        id: i64,
        error: String,
        retry_at: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Timers due at `now`, oldest first; exclude quarantined owners before the limit.
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
        instance_status: Option<InstanceStatus>,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<Option<Computer>, Self::Err>> + Send;

    /// Give healthy computers' macrod timers a fresh grace after startup, scoped to the host.
    fn postpone_macrod_timers(
        &self,
        host: HostId,
        deadline: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Insert or refresh a host and its capacity.
    fn register_host(
        &self,
        registration: HostRegistration,
    ) -> impl Future<Output = Result<Host, Self::Err>> + Send;

    /// Refresh operator presence without changing host capacity or startup timers.
    fn heartbeat_host(
        &self,
        host: HostId,
        now: DateTime<Utc>,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Every host with what its computers and reservations hold, by host id.
    fn allocation(&self) -> impl Future<Output = Result<Vec<HostAllocation>, Self::Err>> + Send;
}

/// Errors from billing a team.
#[derive(Debug, thiserror::Error)]
pub enum BillingError {
    /// Computer sales are disabled in this environment.
    #[error("computers are not available in this environment")]
    NotAvailable,
    /// The team has no active subscription.
    #[error("the team has no active subscription")]
    NoSubscription,
    /// The subscription interval has no computer price.
    #[error("computers are not sold on {0:?} billing")]
    IntervalNotSold(BillingInterval),
    /// The payment was refused; nothing was charged.
    #[error("the payment did not go through")]
    PaymentFailed,
    /// The team's subscription is in a trial: computers are for paying
    /// teams only, so nothing is charged or provisioned.
    #[error("Computers are available on paid plans. Your team is on a trial.")]
    TeamOnTrial,
    /// The billing provider failed; the change's outcome is unknown.
    #[error("billing provider error: {0:?}")]
    Provider(rootcause::Report),
}

impl BillingError {
    /// Whether the change definitely did not happen (as opposed to an unknown outcome).
    pub fn is_definite(&self) -> bool {
        match self {
            Self::NotAvailable
            | Self::NoSubscription
            | Self::IntervalNotSold(_)
            | Self::PaymentFailed
            | Self::TeamOnTrial => true,
            Self::Provider(_) => false,
        }
    }
}

/// Where an item change keyed by an idempotency key stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ChargeStatus {
    /// Sent with its outcome unknown; sending it again replays it.
    Pending,
    /// It reached the subscription.
    Applied,
    /// It was refused or given up, and is never sent again.
    NotApplied,
}

/// How an added item bills the part of the period already under way.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ItemCharge {
    /// Invoice the prorated rest of the period now (a purchase or a restore).
    Prorated,
    /// No proration: the period is already paid (undoing a cancellation).
    NoProration,
}

/// The team subscription, where each computer is billed as its own item
/// carrying its computer id in metadata.
pub trait Billing: Send + Sync + 'static {
    /// Whether this environment sells computers, before reserving capacity.
    fn sales_available(&self) -> bool;

    /// The price of one computer of `size` at the team's billing interval.
    fn quote(
        &self,
        team_id: Uuid,
        size: ComputerSize,
    ) -> impl Future<Output = Result<Quote, BillingError>> + Send;

    /// Add the computer's own item at its saved `price_id`, plus
    /// `extra_items`, in ONE update that fails rather than leaving an unpaid
    /// invoice. `idempotency_key` makes a retried call a no-op returning the
    /// same item.
    fn add_computer(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
        price_id: &stripe::PriceId,
        extra_items: &[SubscriptionItem],
        charge: ItemCharge,
        idempotency_key: &str,
    ) -> impl Future<Output = Result<SubscriptionItemId, BillingError>> + Send;

    /// Give up on an add whose outcome never became known: no later replay
    /// may send it, including one never sent (it is fenced). Returns the computer's item if the add (or another)
    /// put one on the subscription, `None` if nothing was charged.
    fn settle_computer_add(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
        idempotency_key: &str,
    ) -> impl Future<Output = Result<Option<SubscriptionItemId>, BillingError>> + Send;

    /// Where the change keyed `idempotency_key` stands; `None` if it was never sent.
    fn charge_status(
        &self,
        idempotency_key: &str,
    ) -> impl Future<Output = Result<Option<ChargeStatus>, BillingError>> + Send;

    /// The item carrying `computer_id`, if the subscription has one.
    fn computer_item(
        &self,
        team_id: Uuid,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<Option<SubscriptionItemId>, BillingError>> + Send;

    /// Remove one computer's item without proration (no refund). An item
    /// that is already gone counts as removed.
    fn remove_computer(
        &self,
        team_id: Uuid,
        subscription_item: &SubscriptionItemId,
        idempotency_key: &str,
    ) -> impl Future<Output = Result<(), BillingError>> + Send;

    /// Refuse a team whose subscription is trialing with
    /// [`BillingError::TeamOnTrial`]: every computer item (purchase, undo,
    /// restore) is for paying teams only.
    fn require_paid_plan(
        &self,
        team_id: Uuid,
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
    /// Adapter failure type.
    type Err: FleetError;

    /// Stable owner of every instance this fleet creates and lists.
    fn control_plane_id(&self) -> &ControlPlaneId;

    /// Create lazily: an existing guest with the same generation and claimed
    /// pairing completes without polling `enrollment.issue()`. An unclaimed
    /// guest gets a fresh payload and restarts its enrollment units, preserving guest uptime.
    /// A new guest gets the fleet's configured image and a data disk, reusing
    /// one a lost guest left (the guest enrolls again for the newer
    /// generation). Returns the image the guest runs.
    fn create(
        &self,
        computer: &Computer,
        generation: EnrollmentGeneration,
        enrollment: &impl FleetEnrollment,
        start: bool,
    ) -> impl Future<Output = Result<GuestImage, Self::Err>> + Send;

    /// Start the guest if stopped.
    fn start(&self, computer_id: ComputerId) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Stop the guest if running.
    fn stop(&self, computer_id: ComputerId) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Restart the guest.
    fn restart(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Restart macrod without rebooting the guest.
    fn restart_macrod(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
    /// Delete the instance, then its data disk. Missing ones are not an error.
    fn destroy(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Delete the one-time enrollment once macrod has used it.
    fn clear_enrollment(
        &self,
        computer_id: ComputerId,
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Whether enforced fleet limits still match the recorded sale. Never resize here.
    fn resources_match(
        &self,
        computer: &Computer,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// Only instances stamped with this fleet's control-plane identity.
    fn instances(&self) -> impl Future<Output = Result<Vec<FleetInstance>, Self::Err>> + Send;

    /// The host this fleet drives, for registration.
    fn host(&self) -> impl Future<Output = Result<HostRegistration, Self::Err>> + Send;

    /// Run `argv` in the guest as its [`GUEST_USER`], without a TTY. Resolves
    /// once the program started; a missing guest is [`FleetError::is_missing`].
    fn exec(
        &self,
        computer_id: ComputerId,
        argv: &[&str],
    ) -> impl Future<Output = Result<GuestProcess<Self::Err>, Self::Err>> + Send;
}

/// The guest account [`Fleet::exec`] runs programs as.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct GuestUser {
    /// Numeric user id.
    pub uid: u32,
    /// Numeric group id.
    pub gid: u32,
    /// `HOME`, also the working directory.
    pub home: &'static str,
    /// `PATH`: setuid wrappers, then the system profile.
    pub path: &'static str,
}

/// The image's `macro` user.
pub const GUEST_USER: GuestUser = GuestUser {
    uid: 1000,
    gid: 1000,
    home: "/home/macro",
    path: "/run/wrappers/bin:/run/current-system/sw/bin",
};

/// A program running in a guest as [`GUEST_USER`], without a TTY.
///
/// Stderr is not streamed: the adapter keeps a bounded tail and logs it at
/// debug on a non-zero exit. Read `stdout` while awaiting `exit`; a full
/// stdout blocks the program like a full pipe. Dropping the process kills or
/// detaches it.
pub struct GuestProcess<Err> {
    /// The program's stdin; dropping it closes the program's stdin.
    pub stdin: Pin<Box<dyn tokio::io::AsyncWrite + Send>>,
    /// The program's stdout.
    pub stdout: Pin<Box<dyn tokio::io::AsyncRead + Send>>,
    /// The exit code, once the program ended and stdout is drained.
    pub exit: Pin<Box<dyn Future<Output = Result<i32, Err>> + Send>>,
}

impl<Err: 'static> GuestProcess<Err> {
    /// The same process, its exit failure converted with `map`.
    pub fn map_err<Other>(
        self,
        map: impl FnOnce(Err) -> Other + Send + 'static,
    ) -> GuestProcess<Other> {
        let exit = self.exit;
        GuestProcess {
            stdin: self.stdin,
            stdout: self.stdout,
            exit: Box::pin(async move { exit.await.map_err(map) }),
        }
    }
}

impl<Err> std::fmt::Debug for GuestProcess<Err> {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter
            .debug_struct("GuestProcess")
            .finish_non_exhaustive()
    }
}

/// Ownership and age observed on the guest, independent of the computer row.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct FleetInstance {
    /// Computer this operation addresses.
    pub computer_id: ComputerId,
    /// Observed guest status.
    pub status: InstanceStatus,
    /// Owner identity shared by control-plane replicas.
    pub control_plane_id: ControlPlaneId,
    /// Missing or malformed timestamps never permit orphan deletion.
    pub created_at: Option<DateTime<Utc>>,
}

/// A harness pre-approved for a computer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostedPairing {
    /// One-time enrollment pairing.
    pub pairing_id: PairingId,
    /// Secret used to claim the pairing.
    pub device_secret: DeviceSecret,
}

/// What a computer's buyer hears when its first setup ends.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SetupNotice {
    /// The computer that was set up.
    pub computer_id: ComputerId,
    /// The team that owns the computer.
    pub team_id: Uuid,
    /// The computer's harness, once created.
    pub harness_id: Option<HarnessId>,
    /// The computer's name when the notice is sent.
    pub computer_name: String,
    /// Who bought the computer.
    pub buyer: macro_user_id::user_id::MacroUserIdStr<'static>,
    /// Ready, or why setup failed.
    pub outcome: SetupOutcome,
}

/// Telling a buyer how setup ended.
pub trait SetupNotices: Send + Sync + 'static {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Deliver `notice`. Delivering the same notice again (an effect
    /// retried or redelivered) must not notify twice.
    fn send(&self, notice: SetupNotice) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// The harness registry macrod pairs with.
pub trait Harnesses: Send + Sync + 'static {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Create, or re-key, the team harness for a computer.
    fn create_hosted_pairing(
        &self,
        computer: &Computer,
    ) -> impl Future<Output = Result<HostedPairing, Self::Err>> + Send;

    /// Whether this exact pairing has been claimed, independently of presence.
    fn pairing_claimed(
        &self,
        pairing_id: PairingId,
    ) -> impl Future<Output = Result<bool, Self::Err>> + Send;

    /// The computer a harness runs on, if it is a computer's.
    fn computer_for(
        &self,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<Option<ComputerId>, Self::Err>> + Send;

    /// Delete the computer's harness, its credential and every agent bound
    /// to it, so no agent is left on a machine that is gone; absent is fine.
    /// Safe to repeat: a retry still finds agents bound to a deleted harness.
    fn revoke(&self, computer: &Computer) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Give the team a coding agent on the computer's harness, created by the
    /// buyer. Skips when an agent is already bound to the harness.
    fn create_default_agent(
        &self,
        computer: &Computer,
        harness_id: HarnessId,
    ) -> impl Future<Output = Result<DefaultAgent, Self::Err>> + Send;
}

/// What [`Harnesses::create_default_agent`] did.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum DefaultAgent {
    /// A new team agent now runs on the harness.
    Created {
        /// The new agent's bot.
        agent_id: BotId,
    },
    /// The harness already had an agent; nothing was created.
    AlreadyBound,
}

/// Server-side eligibility for complimentary computers.
pub trait CompPolicy: Send + Sync + 'static {
    /// Adapter failure type.
    type Err: std::error::Error + Send + Sync + 'static;

    /// Return the server-selected comp reason, if eligible.
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

/// A lazy one-time enrollment, requested only after the fleet checks its guest.
/// It borrows the operator for the duration of one Create effect.
pub trait FleetEnrollment: Send + Sync {
    /// Check the persisted pairing claim, not WebSocket presence.
    fn claimed(
        &self,
        pairing: PairingId,
    ) -> impl Future<Output = Result<bool, EnrollmentIssueError>> + Send;

    /// Rotate credentials and pairing, without retaining or replaying plaintext.
    fn issue(&self) -> impl Future<Output = Result<Enrollment, EnrollmentIssueError>> + Send;
}
