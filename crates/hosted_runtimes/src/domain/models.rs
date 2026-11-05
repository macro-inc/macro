//! Computers, hosts, purchases and what the team sees.

use std::collections::BTreeMap;

use chrono::{DateTime, Utc};
use serde::{Deserialize, Serialize};
use uuid::Uuid;

use crate::domain::enrollment::Persona;
use crate::domain::lifecycle::{Billing, ComputerState, HostId, Phase, Power};
use crate::domain::size::ComputerSize;

/// One computer a team pays for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Computer {
    pub id: Uuid,
    pub team_id: Uuid,
    pub name: String,
    pub size: ComputerSize,
    pub state: ComputerState,
    /// The harness macrod claims, created when the instance is created.
    pub harness_id: Option<Uuid>,
    pub persona: Option<Persona>,
    pub created_by: String,
    pub created_at: DateTime<Utc>,
    /// When macrod first connected; setup is over from then on.
    pub enrolled_at: Option<DateTime<Utc>>,
}

/// A computer to reserve units for.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct NewComputer {
    pub id: Uuid,
    pub team_id: Uuid,
    pub name: String,
    pub size: ComputerSize,
    pub persona: Option<Persona>,
    pub created_by: String,
}

/// A buy request. `extra_items` join the computer's item in the same
/// subscription update, e.g. the seat of an agent teammate invited with it.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PurchaseRequest {
    pub team_id: Uuid,
    /// The admin or owner buying it.
    pub created_by: String,
    pub size: ComputerSize,
    /// Display name; defaults to the persona's name, then "Macro computer".
    pub name: Option<String>,
    pub persona: Option<Persona>,
    pub extra_items: Vec<SubscriptionItem>,
}

/// A Stripe price and how many of it to add to the team subscription.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[cfg_attr(feature = "inbound", derive(utoipa::ToSchema))]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionItem {
    pub price_id: String,
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
    pub price_id: String,
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

/// A fleet host, counted in size units.
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
        self.memory_gb.saturating_sub(self.reserve_gb) / ComputerSize::Standard.memory_gb()
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
    pub id: Uuid,
    pub name: String,
    pub size: ComputerSize,
    pub status: ComputerStatusKind,
    /// Present until the computer first connects.
    pub setup: Option<SetupProgress>,
    pub powered_on: bool,
    /// When billing stops, for a computer canceled at period end.
    pub cancels_at: Option<DateTime<Utc>>,
    /// When the disk is destroyed, for a canceled computer.
    pub retained_until: Option<DateTime<Utc>>,
    pub harness_id: Option<Uuid>,
    pub persona_name: Option<String>,
    pub created_at: DateTime<Utc>,
}

impl Computer {
    pub fn status(&self) -> ComputerStatus {
        let setup_step = match self.state.phase {
            _ if self.enrolled_at.is_some() => None,
            Phase::Reserved { .. } => Some(SetupStep::Paying),
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
            Phase::Destroyed => ComputerStatusKind::Released,
            Phase::Reserved { .. } | Phase::Provisioning { .. } => ComputerStatusKind::SettingUp,
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
            status,
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
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub struct EnrollmentDefaults {
    /// `OVERRIDE_*` service URLs for stacks the image's default environment
    /// can't reach (local stacks); empty in dev and prod.
    pub service_url_overrides: BTreeMap<String, String>,
}
