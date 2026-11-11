//! Provider-backed recurring subscription and upcoming invoice presentation.

use chrono::{DateTime, Utc};
use hosted_runtimes::domain::{
    models::{BillingInterval, ComputerStatusKind},
    size::ComputerSize,
};
use teams::domain::model::SeatPlan;

/// Actual current recurring items and the provider's next invoice preview.
#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionBilling {
    /// The subscription's ISO currency, as returned by the provider.
    pub currency: String,
    /// The actual recurring billing interval shared by these items.
    pub interval: BillingInterval,
    /// Paid seat allocations.
    pub human_seats: SubscriptionSeatTotal,
    /// Real provider line items, allocated only when their ownership is known.
    pub line_items: Vec<SubscriptionBillingLineItem>,
    /// Recurring item subtotal in minor units, before invoice adjustments.
    pub subscription_total: i64,
    /// Provider invoice preview, absent when no upcoming invoice is available.
    pub next_invoice: Option<SubscriptionNextInvoice>,
}

/// Billed seat quantity and current recurring amount in minor units.
#[derive(Debug, Clone, Default, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionSeatTotal {
    /// Actual billed quantity allocated to this seat kind.
    pub quantity: u64,
    /// Actual recurring price times allocated quantity, in minor units.
    pub amount: i64,
}

/// What an actual subscription item pays for.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "snake_case")]
pub enum SubscriptionBillingLineKind {
    /// A human account's seat.
    HumanSeat,
    /// An identified team's computer.
    Computer,
    /// A provider item that cannot be attributed to a known seat or computer.
    Other,
}

/// An allocated provider item or an explicitly included computer.
#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionBillingLineItem {
    /// Actual billing category; unmatched quantities stay `other`.
    pub kind: SubscriptionBillingLineKind,
    /// Seat plan, where applicable.
    pub plan: Option<SeatPlan>,
    /// Actual subscription quantity allocated to this row.
    pub quantity: u64,
    /// Provider price per unit in minor units, when fixed.
    pub unit_amount: Option<i64>,
    /// Current recurring amount for this allocated quantity, in minor units.
    pub amount: i64,
    /// Identified computer, absent for aggregate or unattributed items.
    pub computer_id: Option<uuid::Uuid>,
    /// Entity name or provider item description.
    pub name: String,
    /// Identified computer's catalog size.
    pub size: Option<ComputerSize>,
    /// Computer status supplied by its owning service.
    #[schema(value_type = Option<String>)]
    pub status: Option<ComputerStatusKind>,
    /// Included without a subscription charge.
    pub included: bool,
}

/// Provider-confirmed next invoice, including its adjustments and credits.
#[derive(Debug, Clone, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct SubscriptionNextInvoice {
    /// Provider's next payment or due date, when supplied.
    pub date: Option<DateTime<Utc>>,
    /// Actual upcoming invoice amount due in minor units.
    pub amount: i64,
}
