//! Computers, hosts, purchases and what the team sees.

use harness_id::HarnessId;

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
pub use stripe_price_id::StripePriceId;
use uuid::Uuid;

use crate::domain::enrollment::Persona;
use crate::domain::ids::ComputerId;
use crate::domain::lifecycle::{Billing, ComputerState, HostId, PaymentOutcome, Phase, Power};
use crate::domain::size::{
    CatalogEntryId, ComputerResources, ComputerSize, DiskGib, MemoryGib, Vcpus,
};

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
    pub id: ComputerId,
    pub team_id: Uuid,
    pub name: ComputerName,
    pub size: ComputerSize,
    pub resources: ComputerResources,
    pub catalog_entry: CatalogEntryId,
    pub price_id: Option<StripePriceId>,
    pub state: ComputerState,
    /// The harness macrod claims, created when the instance is created.
    pub harness_id: Option<HarnessId>,
    pub persona: Option<Persona>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    /// When macrod first connected; setup is over from then on.
    pub enrolled_at: Option<DateTime<Utc>>,
}

/// A computer to reserve units for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewComputer {
    pub billing: PurchaseBilling,
    /// Persisted in the payment confirmation outbox for exact purchase replay.
    pub extra_items: Vec<SubscriptionItem>,
    pub id: ComputerId,
    pub team_id: Uuid,
    pub name: ComputerName,
    pub size: ComputerSize,
    pub resources: ComputerResources,
    pub catalog_entry: CatalogEntryId,
    pub price_id: Option<StripePriceId>,
    pub persona: Option<Persona>,
    pub created_by: String,
}

/// A buy request. For Stripe purchases, `extra_items` join the computer's
/// item in the same subscription update. Comped purchases require no extra items.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PurchaseRequest {
    pub billing: PurchaseBilling,
    pub team_id: Uuid,
    /// The admin or owner buying it.
    pub created_by: String,
    pub size: ComputerSize,
    /// Display name; defaults to the persona's name, then "Macro computer".
    pub name: Option<String>,
    pub persona: Option<Persona>,
    pub extra_items: Vec<SubscriptionItem>,
}

/// Server-selected purchase funding. Team clients cannot select this value.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum PurchaseBilling {
    Stripe,
    Comped { reason: String },
}

/// A Stripe price and how many of it to add to the team subscription.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionItem {
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub price_id: StripePriceId,
    /// Added to the item's current quantity.
    pub quantity: u32,
}

/// How often the team subscription bills.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum BillingInterval {
    Month,
    Year,
}

/// What one computer of a size costs the team.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct Quote {
    pub size: ComputerSize,
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub price_id: StripePriceId,
    /// In the currency's smallest unit.
    pub amount: i64,
    pub currency: String,
    pub interval: BillingInterval,
}

/// A size with its resources, price and whether it can be bought now.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SizeOffer {
    pub size: ComputerSize,
    pub vcpus: u32,
    pub memory_gb: u32,
    pub disk_gb: u32,
    pub quote: Quote,
    pub sold_out: bool,
    /// The caller asked to hear when this size is back.
    pub notify_requested: bool,
}

/// A fleet host, counted in resource units.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Host {
    pub id: HostId,
    pub name: String,
    pub awake_capacity_units: u32,
    pub sold_capacity_units: u32,
}

/// What a host reports when it registers.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct HostRegistration {
    pub name: String,
    pub memory_gb: u32,
    /// RAM kept for the host itself.
    pub reserve_gb: u32,
    /// How many units are sold per awake unit.
    pub oversell_factor: u32,
}

impl HostRegistration {
    pub fn awake_capacity_units(&self) -> u32 {
        self.memory_gb.saturating_sub(self.reserve_gb) / 8
    }

    pub fn sold_capacity_units(&self) -> u32 {
        self.awake_capacity_units() * self.oversell_factor
    }
}

/// The coarse status the team sees.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum ComputerStatusKind {
    SettingUp,
    Ready,
    Asleep,
    Waking,
    Stopping,
    Stopped,
    Failed,
    PaymentFailed,
    Released,
}

/// Steps a new computer goes through, in order.
#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "snake_case")]
pub enum SetupStep {
    Paying,
    Creating,
    Booting,
    Connecting,
    Ready,
}

/// Setup progress, for invite and purchase flows to show.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SetupProgress {
    pub step: SetupStep,
    /// 1-based position of `step`.
    pub position: u8,
    pub total: u8,
}

/// A computer as its team sees it.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct ComputerStatus {
    #[cfg_attr(feature = "inbound", schema(value_type = Uuid))]
    pub id: ComputerId,
    #[cfg_attr(feature = "inbound", schema(value_type = String))]
    pub name: ComputerName,
    pub size: ComputerSize,
    pub vcpus: Vcpus,
    pub memory_gib: MemoryGib,
    pub disk_gib: DiskGib,
    pub catalog_entry: CatalogEntryId,
    pub status: ComputerStatusKind,
    pub payment: PaymentOutcome,
    /// Present for a comped purchase, including after release.
    pub comp_reason: Option<String>,
    /// Present until the computer first connects.
    pub setup: Option<SetupProgress>,
    pub powered_on: bool,
    /// When billing stops, for a computer canceled at period end.
    pub cancels_at: Option<DateTime<Utc>>,
    /// When the disk is destroyed, for a canceled computer.
    pub retained_until: Option<DateTime<Utc>>,
    #[cfg_attr(feature = "inbound", schema(value_type = Option<Uuid>))]
    pub harness_id: Option<HarnessId>,
    pub persona_name: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl Computer {
    pub fn status(&self) -> ComputerStatus {
        let setup_step = match self.state.phase {
            _ if self.enrolled_at.is_some() => None,
            Phase::PendingPayment { .. } => Some(SetupStep::Paying),
            Phase::Provisioning { .. } if self.harness_id.is_none() => Some(SetupStep::Creating),
            Phase::Provisioning { .. } => Some(SetupStep::Booting),
            Phase::Booting { .. } | Phase::Restarting { .. } => Some(SetupStep::Connecting),
            _ => None,
        };
        let status = match self.state.phase {
            _ if setup_step.is_some() => ComputerStatusKind::SettingUp,
            Phase::Running { .. } => ComputerStatusKind::Ready,
            Phase::Frozen { .. } | Phase::Suspended { .. } if self.state.wake_requested => {
                ComputerStatusKind::Waking
            }
            Phase::Frozen { .. } | Phase::Suspended { .. } => ComputerStatusKind::Asleep,
            Phase::Booting { .. } | Phase::Restarting { .. } => ComputerStatusKind::Waking,
            Phase::Stopped { .. } if self.state.wake_requested => ComputerStatusKind::Waking,
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
            name: self.name.clone(),
            size: self.size,
            vcpus: self.resources.vcpus,
            memory_gib: self.resources.memory_gib,
            disk_gib: self.resources.disk_gib,
            catalog_entry: self.catalog_entry.clone(),
            status,
            payment: self.state.payment,
            comp_reason: self.state.comp_reason.clone(),
            setup,
            powered_on: self.state.power == Power::On,
            cancels_at,
            retained_until,
            harness_id: self.harness_id,
            persona_name: self.persona.as_ref().map(|persona| persona.name.clone()),
            created_at: self.created_at,
        }
    }
}

/// Values every computer's enrollment carries, set per environment.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EnrollmentDefaults {
    /// `OVERRIDE_*` service URLs for stacks the image's default environment
    /// can't reach (local stacks); empty in dev and prod.
    pub service_url_overrides: BTreeMap<String, String>,
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
