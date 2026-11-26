//! Computers, hosts, purchases and what the team sees.

use macro_user_id::user_id::MacroUserIdStr;

use bot_id::BotId;
use harness_id::HarnessId;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::ids::ComputerId;
use crate::domain::lifecycle::{
    Billing, BillingPolicy, ComputerState, HostId, Phase, Power, SubscriptionItemId,
};
use crate::domain::size::{CatalogEntryId, ComputerResources, ComputerSize};

mod host;
pub use host::{
    Host, HostAllocation, HostConnection, HostName, HostRecord, HostRegistration, InvalidHostName,
};

/// How long a host heartbeat advertises an attached operator.
pub const HOST_HEARTBEAT_FRESHNESS: chrono::Duration = chrono::Duration::minutes(5);

/// Advisory presence of a computer fleet operator.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FleetAttachment {
    /// At least one operator has a fresh heartbeat.
    Attached,
    /// No operator has a fresh heartbeat.
    Detached,
}

impl FleetAttachment {
    /// Convert observed operator presence to attachment.
    pub fn from_operator_present(present: bool) -> Self {
        if present {
            Self::Attached
        } else {
            Self::Detached
        }
    }

    /// Refuse user operations while the fleet is detached.
    pub fn require_attached(self) -> Result<(), FleetUnavailable> {
        match self {
            Self::Attached => Ok(()),
            Self::Detached => Err(FleetUnavailable),
        }
    }
}

/// The fleet currently has no attached operator.
#[derive(Debug, thiserror::Error)]
#[error("computers are not available")]
pub struct FleetUnavailable;

pub use computer_types::{ControlPlaneId, InvalidControlPlaneId};

/// One computer allocated to a team.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Computer {
    /// Stable resource identity.
    pub id: ComputerId,
    /// Team that owns the computer.
    pub team_id: Uuid,
    /// Display name.
    pub name: ComputerName,
    /// Purchased catalog size.
    pub size: ComputerSize,
    /// Resource limits saved at purchase.
    pub resources: ComputerResources,
    /// Versioned catalog entry saved at purchase.
    pub catalog_entry: CatalogEntryId,
    /// How the purchase was funded: the saved Stripe price, or the comp reason.
    pub funding: Funding,
    /// The fleet host holding the computer.
    pub host: HostId,
    /// Persisted lifecycle state: the machine phase and its billing.
    pub state: ComputerState,
    /// The harness macrod claims, created when the instance is created.
    pub harness_id: Option<HarnessId>,
    /// Last guest creation begun by the fleet; retries keep the same generation.
    pub enrollment_generation: crate::domain::enrollment::EnrollmentGeneration,
    /// Macro user who purchased the computer.
    pub created_by: MacroUserIdStr<'static>,
    /// Time the computer was reserved.
    pub created_at: DateTime<Utc>,
    /// When macrod first connected; setup is over from then on.
    pub enrolled_at: Option<DateTime<Utc>>,
    /// When overcommit relief hibernated it, until it wakes. A hibernated
    /// guest runs no macrod but stays `Running` to its team: a prompt wakes it.
    pub hibernated_at: Option<DateTime<Utc>>,
    /// When the team finished the guided setup after buying it.
    pub setup_completed_at: Option<DateTime<Utc>>,
    /// The coding agent the computer came with, once created. Bots are
    /// soft-deleted, so it can name an agent the team since deleted.
    pub default_agent_id: Option<BotId>,
    /// The image the guest was created from; `None` until the first
    /// creation finishes.
    pub image: Option<crate::domain::image::GuestImage>,
}

/// A persisted row, including identities whose payload cannot be trusted.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum ComputerRecord {
    /// Fully validated computer, eligible for lifecycle processing.
    Healthy(Box<Computer>),
    /// Preserved identity, excluded from lifecycle processing until repaired.
    NeedsAttention {
        /// Stable resource identity.
        id: ComputerId,
        /// Owning team.
        team_id: Uuid,
        /// Host recorded independently of the lifecycle payload.
        host_id: Option<HostId>,
        /// Field and validation rule, without stored values.
        reason: SanitizedReason,
        /// Uninterpreted display metadata; never used for lifecycle decisions.
        display: ComputerDisplayMetadata,
    },
}

/// Display-only purchase metadata retained even when the domain payload is invalid.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ComputerDisplayMetadata {
    /// Stored display name.
    pub name: String,
    /// Purchased catalog size.
    pub size: ComputerSize,
    /// Recorded virtual CPU count.
    pub vcpus: i64,
    /// Recorded memory in GiB.
    pub memory_gib: i64,
    /// Recorded disk size in GiB.
    pub disk_gib: i64,
    /// Stored catalog identifier.
    pub catalog_entry: String,
    /// Reservation timestamp.
    pub created_at: DateTime<Utc>,
    /// The Macro user who bought it.
    pub purchased_by: String,
}

impl From<&Computer> for ComputerDisplayMetadata {
    fn from(computer: &Computer) -> Self {
        Self {
            name: computer.name.as_str().to_owned(),
            size: computer.size,
            vcpus: i64::from(computer.resources.vcpus.get()),
            memory_gib: i64::from(computer.resources.memory_gib.get()),
            disk_gib: i64::from(computer.resources.disk_gib.get()),
            catalog_entry: computer.catalog_entry.as_str().to_owned(),
            created_at: computer.created_at,
            purchased_by: computer.created_by.to_string(),
        }
    }
}

/// A static field-and-rule diagnostic; parser errors and stored values cannot enter it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("{0}")]
pub struct SanitizedReason(&'static str);

impl SanitizedReason {
    /// Construct a diagnostic from a static field-and-rule message.
    pub const fn new(reason: &'static str) -> Self {
        Self(reason)
    }
}

impl ComputerRecord {
    /// Identity survives payload decoding failure.
    pub fn id(&self) -> ComputerId {
        match self {
            Self::Healthy(computer) => computer.id,
            Self::NeedsAttention { id, .. } => *id,
        }
    }

    /// Ownership survives payload decoding failure.
    pub fn team_id(&self) -> Uuid {
        match self {
            Self::Healthy(computer) => computer.team_id,
            Self::NeedsAttention { team_id, .. } => *team_id,
        }
    }

    /// Borrow a validated computer; quarantined records are never lifecycle inputs.
    pub fn healthy(&self) -> Option<&Computer> {
        match self {
            Self::Healthy(computer) => Some(computer),
            Self::NeedsAttention { .. } => None,
        }
    }

    /// Take the validated computer, preserving quarantine as an explicit error.
    pub fn into_healthy(self) -> Result<Computer, SanitizedReason> {
        match self {
            Self::Healthy(computer) => Ok(*computer),
            Self::NeedsAttention { reason, .. } => Err(reason),
        }
    }
}

impl From<Computer> for ComputerRecord {
    fn from(computer: Computer) -> Self {
        Self::Healthy(Box::new(computer))
    }
}

/// How a purchase is funded, saved with it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Funding {
    /// Billed on the team subscription at this saved price.
    Stripe {
        /// Stripe price saved at purchase, for restores and quotes.
        price_id: stripe::PriceId,
    },
    /// Provided without a charge.
    Comped {
        /// Why the computer is free.
        reason: String,
    },
}

impl Funding {
    /// `"comped"` or `"stripe"`, for telemetry.
    pub fn kind(&self) -> &'static str {
        match self {
            Self::Stripe { .. } => "stripe",
            Self::Comped { .. } => "comped",
        }
    }
}

/// The buyer's key for one purchase: one per Buy dialog, reused when the
/// purchase is retried, so a retry never buys a second computer.
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize)]
#[serde(transparent)]
pub struct PurchaseKey(String);

/// An empty, overlong or non-printable purchase key.
#[derive(Debug, thiserror::Error)]
#[error("purchaseKey must be 1..=128 printable ASCII characters")]
pub struct InvalidPurchaseKey;

impl PurchaseKey {
    /// Validate a client key.
    pub fn try_new(value: String) -> Result<Self, InvalidPurchaseKey> {
        if value.is_empty() || value.len() > 128 || !value.bytes().all(|b| b.is_ascii_graphic()) {
            return Err(InvalidPurchaseKey);
        }
        Ok(Self(value))
    }

    /// Borrow the key.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

impl TryFrom<String> for PurchaseKey {
    type Error = InvalidPurchaseKey;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(value)
    }
}

impl<'de> Deserialize<'de> for PurchaseKey {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::try_from(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

/// A purchase to hold capacity for while its charge is confirmed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewReservation {
    /// The future computer's id.
    pub id: ComputerId,
    /// Team that owns the computer.
    pub team_id: Uuid,
    /// The buyer's key for this purchase.
    pub purchase_key: PurchaseKey,
    /// Display name.
    pub name: ComputerName,
    /// Purchased catalog size.
    pub size: ComputerSize,
    /// Resource limits saved at purchase.
    pub resources: ComputerResources,
    /// Versioned catalog entry saved at purchase.
    pub catalog_entry: CatalogEntryId,
    /// The saved price, or the comp reason.
    pub funding: Funding,
    /// Macro user who purchased the computer.
    pub created_by: MacroUserIdStr<'static>,
    /// Joined into the computer's subscription update, replayed exactly.
    pub extra_items: Vec<SubscriptionItem>,
    /// The purchase's trace context, carried to the computer.
    pub provision_traceparent: Option<String>,
    /// The agent teammate the computer is bought for, if any.
    pub agent: Option<MacroUserIdStr<'static>>,
}

/// Capacity held on a host for a purchase whose charge is being confirmed.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Reservation {
    /// The future computer's id.
    pub id: ComputerId,
    /// Team that owns the computer.
    pub team_id: Uuid,
    /// Host holding the capacity.
    pub host: HostId,
    /// The buyer's key for this purchase.
    pub purchase_key: PurchaseKey,
    /// Display name.
    pub name: ComputerName,
    /// Purchased catalog size.
    pub size: ComputerSize,
    /// Resource limits saved at purchase.
    pub resources: ComputerResources,
    /// Versioned catalog entry saved at purchase.
    pub catalog_entry: CatalogEntryId,
    /// The saved price, or the comp reason.
    pub funding: Funding,
    /// Macro user who purchased the computer.
    pub created_by: MacroUserIdStr<'static>,
    /// Joined into the computer's subscription update, replayed exactly.
    pub extra_items: Vec<SubscriptionItem>,
    /// The purchase's trace context, carried to the computer.
    pub provision_traceparent: Option<String>,
    /// After this the confirm worker settles the charge and stops replaying it.
    pub expires_at: DateTime<Utc>,
    /// The agent teammate the computer is bought for, if any.
    pub agent: Option<MacroUserIdStr<'static>>,
    /// When the purchase began.
    pub created_at: DateTime<Utc>,
}

/// The Stripe idempotency key of a purchase's charge, the same on every
/// attempt; a reservation's id is its computer's.
pub fn charge_key(computer_id: ComputerId) -> String {
    format!("computer-add:{computer_id}")
}

impl Reservation {
    /// The Stripe idempotency key of this purchase's charge.
    pub fn charge_key(&self) -> String {
        charge_key(self.id)
    }

    /// A reservation as its team sees it: purchasing, setup step
    /// Billing, since a reservation exists only while its charge is
    /// being confirmed.
    pub fn status(&self) -> ComputerStatus {
        ComputerStatus {
            id: self.id,
            name: self.name.as_str().to_owned(),
            size: self.size,
            vcpus: i64::from(self.resources.vcpus.get()),
            memory_gib: i64::from(self.resources.memory_gib.get()),
            disk_gib: i64::from(self.resources.disk_gib.get()),
            catalog_entry: self.catalog_entry.as_str().to_owned(),
            status: ComputerStatusKind::Purchasing,
            billing: Some(BillingStatus::Purchasing),
            comp_reason: match &self.funding {
                Funding::Comped { reason } => Some(reason.clone()),
                Funding::Stripe { .. } => None,
            },
            setup: Some(SetupProgress::of(SetupStep::Billing, Some(self.created_at))),
            failure_reason: None,
            powered_on: true,
            cancels_at: None,
            can_undo_cancel: false,
            retained_until: None,
            can_restore: false,
            past_due_since: None,
            harness_id: None,
            created_at: self.created_at,
            purchased_by: self.created_by.to_string(),
            setup_completed_at: None,
            default_agent_id: None,
            agent_count: 0,
        }
    }
}

/// What a purchase key already led to.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Reserved {
    /// A new reservation now holds capacity.
    New(Reservation),
    /// This key's charge is still being confirmed.
    Pending(Reservation),
    /// This key already bought a computer.
    Purchased(Box<ComputerRecord>),
}

/// How a purchase ended in the request that made it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Purchase {
    /// The computer exists and is being set up.
    Ready(ComputerId),
    /// The charge's outcome is not known yet: the computer is purchasing
    /// until it is, then billed or (refused) released and gone from lists.
    Confirming(ComputerId),
}

impl Purchase {
    /// `"ready"` or `"confirming"`, for telemetry.
    pub fn outcome(&self) -> &'static str {
        match self {
            Self::Ready(_) => "ready",
            Self::Confirming(_) => "confirming",
        }
    }

    /// The purchased (or future) computer.
    pub fn computer_id(self) -> ComputerId {
        match self {
            Self::Ready(id) | Self::Confirming(id) => id,
        }
    }
}

/// A buy request. For Stripe purchases, `extra_items` join the computer's
/// item in the same subscription update. Comped purchases require no extra items.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PurchaseRequest {
    /// Purchase funding or billing state.
    pub billing: PurchaseBilling,
    /// The buyer's key for this purchase.
    pub purchase_key: PurchaseKey,
    /// Team that owns the computer.
    pub team_id: Uuid,
    /// The admin or owner buying it.
    pub created_by: MacroUserIdStr<'static>,
    /// Purchased catalog size.
    pub size: ComputerSize,
    /// Display name; defaults to "Macro computer".
    pub name: Option<String>,
    /// Additional subscription items included in the purchase.
    pub extra_items: Vec<SubscriptionItem>,
}

/// Server-selected purchase funding. Team clients cannot select this value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PurchaseBilling {
    /// Charge the team subscription.
    Stripe,
    /// Provide the computer without a charge.
    Comped {
        /// Reason for this decision or failure.
        reason: String,
    },
}

/// A Stripe price and how many of it to add to the team subscription.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionItem {
    /// Stripe price saved for billing replay.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub price_id: stripe::PriceId,
    /// Added to the item's current quantity.
    pub quantity: u32,
}

/// How often the team subscription bills.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum BillingInterval {
    /// Monthly billing.
    Month,
    /// Annual billing.
    Year,
}

/// What one computer of a size costs the team.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    /// Purchased catalog size.
    pub size: ComputerSize,
    /// Stripe price saved for billing replay.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub price_id: stripe::PriceId,
    /// In the currency's smallest unit.
    pub amount: i64,
    /// Billing currency code.
    pub currency: String,
    /// Subscription billing interval.
    pub interval: BillingInterval,
}

/// A size with its resources, price and whether it can be bought now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SizeOffer {
    /// Purchased catalog size.
    pub size: ComputerSize,
    /// Virtual CPU count.
    pub vcpus: u32,
    /// Memory in GiB.
    pub memory_gb: u32,
    /// Whole disk quota in GiB: root and `/home` together.
    pub disk_gb: u32,
    /// Price for one computer.
    pub quote: Quote,
    /// Whether no host can currently sell this size.
    pub sold_out: bool,
}

/// What the buy dialog shows before a purchase: each size with what buying
/// it charges today, when the full price bills from, and the card charged.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct PurchaseOffers {
    /// Every size some host can run awake.
    pub sizes: Vec<PurchaseSizeOffer>,
    /// When the current billing period ends: each computer bills its full
    /// `quote.amount` every `quote.interval` from then.
    pub renews_at: DateTime<Utc>,
    /// The card purchases are charged to; `None` when there is no card on
    /// file, the team pays another way, or it is comped.
    pub card: Option<PaymentCard>,
}

/// A size on sale and what buying it charges today.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct PurchaseSizeOffer {
    /// The size, its price and availability, as `/team/computers/offers` lists it.
    #[serde(flatten)]
    pub offer: SizeOffer,
    /// The prorated rest of the current period, invoiced at purchase, in the
    /// currency's smallest unit, less the team's credit balance; 0 when the
    /// team is comped. The charge itself is prorated to the second it is
    /// bought.
    pub due_today: i64,
}

/// A card as its owner recognizes it: "Visa ending 4242".
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct PaymentCard {
    /// Card network.
    pub brand: CardBrand,
    /// Last four digits.
    pub last4: String,
}

/// A card network.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, strum::Display)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum CardBrand {
    /// American Express.
    Amex,
    /// Diners Club.
    Diners,
    /// Discover.
    Discover,
    /// eftpos Australia.
    EftposAu,
    /// JCB.
    Jcb,
    /// Mastercard.
    Mastercard,
    /// UnionPay.
    Unionpay,
    /// Visa.
    Visa,
    /// A network the payment provider doesn't name.
    Unknown,
}

/// What buying each of some sizes would charge a team now, read in one go.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PurchaseTerms {
    /// One per size asked for, in order.
    pub quotes: Vec<PurchaseQuote>,
    /// When the current billing period ends.
    pub renews_at: DateTime<Utc>,
    /// The card purchases are charged to.
    pub card: Option<PaymentCard>,
}

/// The price of one computer of a size and what buying it charges today.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PurchaseQuote {
    /// Its recurring price.
    pub quote: Quote,
    /// In the currency's smallest unit.
    pub due_today: i64,
}

/// Why a purchase was refused, as a stable code the buy and add-agent dialogs
/// show their own way. One vocabulary for `/team/computers` and
/// `/team_agents`.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, strum::Display, strum::AsRefStr)]
#[cfg_attr(feature = "schema", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum PurchaseRefusalCode {
    /// The team's subscription is trialing; computers are for paying teams.
    TeamOnTrial,
    /// The card was declined; nothing was bought.
    PaymentDeclined,
    /// No host has room for the size, checked before any charge; nothing
    /// was bought.
    NoRoom,
    /// An earlier request with the same purchase key is still under way;
    /// retry with that key.
    InviteInProgress,
}

/// An agent teammate's computer as the team roster sees it.
#[derive(Debug, Clone)]
pub struct RosterStatus {
    /// The computer's status.
    pub status: ComputerStatus,
    /// The fleet's current availability.
    pub attachment: FleetAttachment,
    /// Its first start waits on the agent reporting online. False for
    /// computers bought before agents reported, which are up once ready.
    pub awaiting_agent: bool,
}

/// The coarse status the team sees.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ComputerStatusKind {
    /// Initial setup is in progress.
    SettingUp,
    /// Stored data requires operator repair.
    NeedsAttention,
    /// Power-on is blocked by the host's awake capacity.
    WaitingForCapacity,
    /// Guest is connected and ready.
    Ready,
    /// Past setup but not answering: macrod was missing at a fleet check
    /// while the guest runs, or the guest crashed and is restarting. It
    /// comes back by itself; only a give-up is [`Self::Failed`].
    Unhealthy,
    /// Guest is starting.
    Starting,
    /// Guest is shutting down.
    Stopping,
    /// Guest is powered off.
    Stopped,
    /// Guest needs a retry or operator attention.
    Failed,
    /// The purchase's charge is being confirmed; no computer exists yet.
    Purchasing,
    /// Guest has been released.
    Released,
}

/// Where a computer's billing stands, as its team sees it.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum BillingStatus {
    /// The purchase's charge is being confirmed.
    Purchasing,
    /// Billed on the team subscription.
    Active,
    /// The team subscription is behind on payment (`pastDueSince`).
    PastDue,
    /// Canceled; billed and running until `cancelsAt`.
    Ending,
    /// No longer billed; kept stopped until `retainedUntil`, restorable.
    Ended,
    /// Provided without a charge (`compReason`).
    Comped,
}

/// Steps a new computer goes through, in order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum SetupStep {
    /// The purchase is being charged on the team's subscription: a
    /// reservation whose subscription change is not confirmed yet (it may be
    /// waiting on another change to the subscription to finish).
    Billing,
    /// Creating the guest.
    Creating,
    /// Starting the guest operating system.
    Booting,
    /// Waiting for macrod to connect.
    Connecting,
    /// Guest is connected and ready.
    Ready,
}

/// Setup progress, for invite and purchase flows to show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SetupProgress {
    /// Current setup stage.
    pub step: SetupStep,
    /// 1-based position of `step`.
    pub position: u8,
    /// Number of setup stages.
    pub total: u8,
    /// When `step` began; null when it is not recorded.
    pub step_started_at: Option<DateTime<Utc>>,
}

impl SetupProgress {
    /// Progress at `step`, which began at `step_started_at`.
    pub fn of(step: SetupStep, step_started_at: Option<DateTime<Utc>>) -> Self {
        Self {
            step,
            position: step as u8 + 1,
            total: SetupStep::Ready as u8 + 1,
            step_started_at,
        }
    }
}

/// A computer as its team sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ComputerStatus {
    /// Stable resource identity.
    #[cfg_attr(feature = "inbound", schema(value_type = Uuid))]
    pub id: ComputerId,
    /// Display name.
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub name: String,
    /// Purchased catalog size.
    pub size: ComputerSize,
    /// Virtual CPU count.
    pub vcpus: i64,
    /// Memory limit saved at purchase.
    pub memory_gib: i64,
    /// Root disk limit saved at purchase.
    pub disk_gib: i64,
    /// Versioned catalog entry saved at purchase.
    pub catalog_entry: String,
    /// Observed guest status.
    pub status: ComputerStatusKind,
    /// Where billing stands; unknown for quarantined records.
    pub billing: Option<BillingStatus>,
    /// Present for a comped purchase, including after release.
    pub comp_reason: Option<String>,
    /// Present until the computer first connects.
    pub setup: Option<SetupProgress>,
    /// Why the computer failed, as a short sentence safe to show; present
    /// when it failed and the cause is known. The full error is only in the logs.
    pub failure_reason: Option<String>,
    /// Whether validated state requests power on; false for quarantined records.
    pub powered_on: bool,
    /// When billing stops, for a computer canceled at period end.
    pub cancels_at: Option<DateTime<Utc>>,
    /// Whether a cancel at period end can still be undone (until `cancelsAt`).
    pub can_undo_cancel: bool,
    /// When the disk is destroyed, for a computer whose billing ended.
    pub retained_until: Option<DateTime<Utc>>,
    /// Whether the computer can be restored (`POST .../restore`): billing
    /// ended and the disk is still retained.
    pub can_restore: bool,
    /// Since when the team subscription is past due.
    pub past_due_since: Option<DateTime<Utc>>,
    /// Harness claimed by this guest.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<Uuid>))]
    pub harness_id: Option<HarnessId>,
    /// Time the computer was reserved.
    pub created_at: DateTime<Utc>,
    /// The Macro user who bought it. The team's owner and admins, not the
    /// buyer, finish its setup and manage its Claude account.
    pub purchased_by: String,
    /// When the team finished the guided setup; null while it is unfinished.
    pub setup_completed_at: Option<DateTime<Utc>>,
    /// Bot id of the coding agent the computer came with; null until macrod
    /// first connects. It can name an agent the team since deleted.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<Uuid>))]
    pub default_agent_id: Option<BotId>,
    /// Agents bound to the computer's live harness, teammates' private ones
    /// included: the ones releasing it deletes.
    pub agent_count: u32,
}

impl Computer {
    /// The saved comp reason, for a comped purchase.
    pub fn comp_reason(&self) -> Option<&str> {
        match &self.funding {
            Funding::Comped { reason } => Some(reason),
            Funding::Stripe { .. } => None,
        }
    }

    /// Project lifecycle state into the team-facing status at `now`, with
    /// the number of agents bound to its harness.
    pub fn status(
        &self,
        agent_count: u32,
        now: DateTime<Utc>,
        policy: BillingPolicy,
    ) -> ComputerStatus {
        let waiting_for_capacity = self.state.waiting_for_capacity();
        let setup_step = match self.state.phase {
            _ if waiting_for_capacity => None,
            _ if self.enrolled_at.is_some() => None,
            Phase::Provisioning { .. } if self.harness_id.is_none() => Some(SetupStep::Creating),
            Phase::Provisioning { .. } => Some(SetupStep::Booting),
            Phase::Booting | Phase::Crashed { retry: Some(_), .. } => Some(SetupStep::Connecting),
            Phase::Running
            | Phase::Crashed { retry: None, .. }
            | Phase::Stopping
            | Phase::Stopped
            | Phase::Destroying => None,
        };
        // Before the first connection the same signs are setup still going.
        // A missed check, not the disconnect itself, so a reconnect flap
        // stays ready; a hibernated guest is asleep, not missing. Crashes
        // count inside the lifecycle's own window: the list is pruned only on
        // the next crash.
        let unhealthy = self.enrolled_at.is_some()
            && match self.state.phase {
                Phase::Running => {
                    self.hibernated_at.is_none()
                        && !self.state.macrod_connected
                        && self.state.macrod_misses >= 1
                }
                Phase::Crashed { retry: Some(_), .. } => true,
                // Restarting after a crash, or a boot whose macrod has
                // already missed a check. A retry clears the crashes and
                // reads Starting; so does a power-on or a move with no crash
                // inside the window.
                Phase::Booting => {
                    self.state.macrod_misses >= 1
                        || self
                            .state
                            .recent_crashes
                            .iter()
                            .any(|at| now - *at < crate::domain::lifecycle::CRASH_WINDOW)
                }
                Phase::Provisioning { .. }
                | Phase::Crashed { retry: None, .. }
                | Phase::Stopping
                | Phase::Stopped
                | Phase::Destroying => false,
            };
        let status = match self.state.phase {
            _ if waiting_for_capacity => ComputerStatusKind::WaitingForCapacity,
            _ if setup_step.is_some() => ComputerStatusKind::SettingUp,
            _ if unhealthy => ComputerStatusKind::Unhealthy,
            Phase::Running => ComputerStatusKind::Ready,
            Phase::Booting | Phase::Crashed { retry: Some(_), .. } => ComputerStatusKind::Starting,
            Phase::Stopped if self.state.power_on_requested => ComputerStatusKind::Starting,
            Phase::Stopping => ComputerStatusKind::Stopping,
            Phase::Stopped => ComputerStatusKind::Stopped,
            Phase::Crashed { retry: None, .. } => ComputerStatusKind::Failed,
            Phase::Destroying => ComputerStatusKind::Released,
            Phase::Provisioning { .. } => ComputerStatusKind::SettingUp,
        };
        let (billing, cancels_at, retained_until, past_due_since) = match &self.state.billing {
            Billing::Active { .. } => (BillingStatus::Active, None, None, None),
            Billing::PastDue { since, .. } => (BillingStatus::PastDue, None, None, Some(*since)),
            Billing::EndsAt { at } if now < *at => (BillingStatus::Ending, Some(*at), None, None),
            Billing::EndsAt { at } => (
                BillingStatus::Ended,
                None,
                Some(*at + policy.retention),
                None,
            ),
            Billing::Comped { .. } => (BillingStatus::Comped, None, None, None),
            // Provisioning already; the purchase's charge has not settled.
            Billing::Charging { .. } => (BillingStatus::Purchasing, None, None, None),
        };
        let live = self.state.is_live();

        ComputerStatus {
            id: self.id,
            name: self.name.as_str().to_owned(),
            size: self.size,
            vcpus: i64::from(self.resources.vcpus.get()),
            memory_gib: i64::from(self.resources.memory_gib.get()),
            disk_gib: i64::from(self.resources.disk_gib.get()),
            catalog_entry: self.catalog_entry.as_str().to_owned(),
            status,
            billing: Some(billing),
            comp_reason: self.comp_reason().map(str::to_owned),
            setup: setup_step.map(|step| {
                let timeline = self.state.setup.as_ref();
                SetupProgress::of(
                    step,
                    match step {
                        SetupStep::Billing => timeline.map(|setup| setup.reserved_at),
                        SetupStep::Creating => timeline.map(|setup| {
                            setup.provisioning_started_at().unwrap_or(setup.reserved_at)
                        }),
                        SetupStep::Connecting => timeline.and_then(|setup| setup.booting_at),
                        SetupStep::Booting | SetupStep::Ready => None,
                    },
                )
            }),
            failure_reason: match self.state.phase {
                Phase::Crashed { retry: None, .. } => self
                    .state
                    .failure
                    .map(|failure| failure.reason().to_owned()),
                _ => None,
            },
            powered_on: self.state.power == Power::On,
            cancels_at,
            can_undo_cancel: live && billing == BillingStatus::Ending,
            retained_until: retained_until.filter(|_| live),
            can_restore: live && billing == BillingStatus::Ended,
            past_due_since,
            harness_id: self.harness_id,
            created_at: self.created_at,
            purchased_by: self.created_by.to_string(),
            setup_completed_at: self.setup_completed_at,
            default_agent_id: self.default_agent_id,
            agent_count,
        }
    }

    /// The subscription item this computer is billed on, if it is.
    pub fn subscription_item(&self) -> Option<&SubscriptionItemId> {
        self.state.billing.subscription_item()
    }
}

impl ComputerRecord {
    /// Expose quarantine without inventing metadata from an invalid payload.
    pub fn status(
        &self,
        agent_count: u32,
        now: DateTime<Utc>,
        policy: BillingPolicy,
    ) -> ComputerStatus {
        match self {
            Self::Healthy(computer) => computer.status(agent_count, now, policy),
            Self::NeedsAttention { id, display, .. } => ComputerStatus {
                id: *id,
                status: ComputerStatusKind::NeedsAttention,
                name: display.name.clone(),
                size: display.size,
                vcpus: display.vcpus,
                memory_gib: display.memory_gib,
                disk_gib: display.disk_gib,
                catalog_entry: display.catalog_entry.clone(),
                billing: None,
                comp_reason: None,
                setup: None,
                failure_reason: None,
                powered_on: false,
                cancels_at: None,
                can_undo_cancel: false,
                retained_until: None,
                can_restore: false,
                past_due_since: None,
                harness_id: None,
                created_at: display.created_at,
                purchased_by: display.purchased_by.clone(),
                setup_completed_at: None,
                default_agent_id: None,
                agent_count,
            },
        }
    }
}

/// A trimmed computer display name containing 1 through 64 Unicode characters.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct ComputerName(String);

/// An empty or overlong computer display name.
#[derive(Debug, thiserror::Error)]
#[error("name must be 1..=64 characters")]
pub struct InvalidComputerName;

impl ComputerName {
    /// Trim and validate a display name.
    pub fn try_new(value: &str) -> Result<Self, InvalidComputerName> {
        let value = value.trim();
        if value.is_empty() || value.chars().count() > 64 {
            return Err(InvalidComputerName);
        }
        Ok(Self(value.to_owned()))
    }
    /// Borrow the display name.
    pub fn as_str(&self) -> &str {
        &self.0
    }
    /// Take the display name.
    pub fn into_inner(self) -> String {
        self.0
    }
}

impl TryFrom<String> for ComputerName {
    type Error = InvalidComputerName;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::try_new(&value)
    }
}

impl std::fmt::Display for ComputerName {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.write_str(self.as_str())
    }
}

impl<'de> Deserialize<'de> for ComputerName {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::try_from(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod test;
