//! Computers, hosts, purchases and what the team sees.

use macro_user_id::user_id::MacroUserIdStr;

use harness_id::HarnessId;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::ids::ComputerId;
use crate::domain::lifecycle::{Billing, ComputerState, HostId, PaymentOutcome, Phase, Power};
use crate::domain::size::{CatalogEntryId, ComputerResources, ComputerSize};

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

/// A roster computer's durable status and current operator availability.
#[derive(Debug)]
pub struct RosterComputerStatus {
    /// Durable lifecycle status, even while the fleet is detached.
    pub status: ComputerStatus,
    /// Advisory operator presence.
    pub availability: FleetAttachment,
}

/// Stable identity shared by replicas of one computer control plane.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
#[serde(transparent)]
pub struct ControlPlaneId(String);

/// An identity that cannot safely be used in fleet ownership metadata.
#[derive(Debug, thiserror::Error)]
#[error("COMPUTERS_CONTROL_PLANE_ID must be nonempty ASCII alphanumerics, hyphens or underscores")]
pub struct InvalidControlPlaneId;

impl ControlPlaneId {
    /// Reject empty identities and characters outside ASCII letters, digits, `_` and `-`.
    pub fn parse(value: String) -> Result<Self, InvalidControlPlaneId> {
        if value.is_empty()
            || !value
                .bytes()
                .all(|byte| byte.is_ascii_alphanumeric() || matches!(byte, b'-' | b'_'))
        {
            return Err(InvalidControlPlaneId);
        }
        Ok(Self(value))
    }

    /// The exact identity written into fleet ownership metadata.
    pub fn as_str(&self) -> &str {
        &self.0
    }
}

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
    /// Stripe price saved for billing replay.
    pub price_id: Option<stripe::PriceId>,
    /// Persisted lifecycle state.
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
    /// Stored size identifier.
    pub size: String,
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
}

impl From<&Computer> for ComputerDisplayMetadata {
    fn from(computer: &Computer) -> Self {
        Self {
            name: computer.name.as_str().to_owned(),
            size: computer.size.as_ref().to_owned(),
            vcpus: i64::from(computer.resources.vcpus.get()),
            memory_gib: i64::from(computer.resources.memory_gib.get()),
            disk_gib: i64::from(computer.resources.disk_gib.get()),
            catalog_entry: computer.catalog_entry.as_str().to_owned(),
            created_at: computer.created_at,
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

/// A computer to reserve units for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewComputer {
    /// Purchase funding or billing state.
    pub billing: PurchaseBilling,
    /// Persisted in the payment confirmation outbox for exact purchase replay.
    pub extra_items: Vec<SubscriptionItem>,
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
    /// Stripe price saved for billing replay.
    pub price_id: Option<stripe::PriceId>,
    /// Macro user who purchased the computer.
    pub created_by: MacroUserIdStr<'static>,
}

/// A buy request. For Stripe purchases, `extra_items` join the computer's
/// item in the same subscription update. Comped purchases require no extra items.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PurchaseRequest {
    /// Purchase funding or billing state.
    pub billing: PurchaseBilling,
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
    /// Root disk size in GiB.
    pub disk_gb: u32,
    /// Price for one computer.
    pub quote: Quote,
    /// Whether no host can currently sell this size.
    pub sold_out: bool,
    /// The caller asked to hear when this size is back.
    pub notify_requested: bool,
}

/// A fleet host, counted in resource units.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Host {
    /// Stable resource identity.
    pub id: HostId,
    /// Display name.
    pub name: String,
    /// Units available for awake guests.
    pub awake_capacity_units: u32,
    /// Units available for purchase.
    pub sold_capacity_units: u32,
}

/// What a host reports when it registers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostRegistration {
    /// Display name.
    pub name: String,
    /// Memory in GiB.
    pub memory_gb: u32,
    /// RAM kept for the host itself.
    pub reserve_gb: u32,
    /// How many units are sold per awake unit.
    pub oversell_factor: u32,
}

impl HostRegistration {
    /// Compute awake capacity after reserving host memory.
    pub fn awake_capacity_units(&self) -> u32 {
        self.memory_gb.saturating_sub(self.reserve_gb) / 8
    }

    /// Compute sellable capacity with overselling.
    pub fn sold_capacity_units(&self) -> u32 {
        self.awake_capacity_units() * self.oversell_factor
    }
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
    /// Guest is starting.
    Starting,
    /// Guest is shutting down.
    Stopping,
    /// Guest is powered off.
    Stopped,
    /// Guest needs a retry or operator attention.
    Failed,
    /// Purchase payment was refused.
    PaymentFailed,
    /// Guest has been released.
    Released,
}

/// Steps a new computer goes through, in order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum SetupStep {
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
    pub size: String,
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
    /// Latched purchase outcome; unknown for quarantined records.
    pub payment: Option<PaymentOutcome>,
    /// Present for a comped purchase, including after release.
    pub comp_reason: Option<String>,
    /// Present until the computer first connects.
    pub setup: Option<SetupProgress>,
    /// Whether validated state requests power on; false for quarantined records.
    pub powered_on: bool,
    /// When billing stops, for a computer canceled at period end.
    pub cancels_at: Option<DateTime<Utc>>,
    /// When the disk is destroyed, for a canceled computer.
    pub retained_until: Option<DateTime<Utc>>,
    /// Harness claimed by this guest.
    #[cfg_attr(feature = "inbound", schema(value_type = Option<Uuid>))]
    pub harness_id: Option<HarnessId>,
    /// Time the computer was reserved.
    pub created_at: DateTime<Utc>,
}

impl Computer {
    /// Project lifecycle state into the team-facing status.
    pub fn status(&self) -> ComputerStatus {
        let waiting_for_capacity = self.state.waiting_for_capacity();
        let setup_step = match self.state.phase {
            _ if waiting_for_capacity => None,
            _ if self.enrolled_at.is_some() => None,
            Phase::PendingPayment { .. } => Some(SetupStep::Creating),
            Phase::Provisioning { .. } if self.harness_id.is_none() => Some(SetupStep::Creating),
            Phase::Provisioning { .. } => Some(SetupStep::Booting),
            Phase::Booting { .. } | Phase::Restarting { .. } => Some(SetupStep::Connecting),
            _ => None,
        };
        let status = match self.state.phase {
            _ if waiting_for_capacity => ComputerStatusKind::WaitingForCapacity,
            _ if setup_step.is_some() => ComputerStatusKind::SettingUp,
            Phase::Running { .. } => ComputerStatusKind::Ready,
            Phase::Booting { .. } | Phase::Restarting { .. } => ComputerStatusKind::Starting,
            Phase::Stopped { .. } if self.state.wake_requested => ComputerStatusKind::Starting,
            Phase::Stopping { .. } => ComputerStatusKind::Stopping,
            Phase::Stopped { .. } => ComputerStatusKind::Stopped,
            Phase::Failed { .. } => ComputerStatusKind::Failed,
            Phase::PaymentFailed => ComputerStatusKind::PaymentFailed,
            Phase::Destroyed => ComputerStatusKind::Released,
            Phase::PendingPayment { .. } | Phase::Provisioning { .. } => {
                ComputerStatusKind::SettingUp
            }
        };
        let setup = setup_step.map(|step| SetupProgress {
            step,
            position: step as u8 + 1,
            total: SetupStep::Ready as u8 + 1,
        });
        let (cancels_at, retained_until) = match self.state.billing {
            Billing::Active => (None, None),
            Billing::CancelAtPeriodEnd { at } => (Some(at), None),
            Billing::Canceled { retained_until } => (None, Some(retained_until)),
        };

        ComputerStatus {
            id: self.id,
            name: self.name.as_str().to_owned(),
            size: self.size.as_ref().to_owned(),
            vcpus: i64::from(self.resources.vcpus.get()),
            memory_gib: i64::from(self.resources.memory_gib.get()),
            disk_gib: i64::from(self.resources.disk_gib.get()),
            catalog_entry: self.catalog_entry.as_str().to_owned(),
            status,
            payment: Some(self.state.payment),
            comp_reason: self.state.comp_reason.clone(),
            setup,
            powered_on: self.state.power == Power::On,
            cancels_at,
            retained_until,
            harness_id: self.harness_id,
            created_at: self.created_at,
        }
    }
}

impl ComputerRecord {
    /// Expose quarantine without inventing metadata from an invalid payload.
    pub fn status(&self) -> ComputerStatus {
        match self {
            Self::Healthy(computer) => computer.status(),
            Self::NeedsAttention { id, display, .. } => ComputerStatus {
                id: *id,
                status: ComputerStatusKind::NeedsAttention,
                name: display.name.clone(),
                size: display.size.clone(),
                vcpus: display.vcpus,
                memory_gib: display.memory_gib,
                disk_gib: display.disk_gib,
                catalog_entry: display.catalog_entry.clone(),
                payment: None,
                comp_reason: None,
                setup: None,
                powered_on: false,
                cancels_at: None,
                retained_until: None,
                harness_id: None,
                created_at: display.created_at,
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

impl TryFrom<String> for ControlPlaneId {
    type Error = InvalidControlPlaneId;
    fn try_from(value: String) -> Result<Self, Self::Error> {
        Self::parse(value)
    }
}

impl<'de> Deserialize<'de> for ComputerName {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::try_from(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

impl<'de> Deserialize<'de> for ControlPlaneId {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        Self::try_from(String::deserialize(deserializer)?).map_err(serde::de::Error::custom)
    }
}

#[cfg(test)]
mod test;
