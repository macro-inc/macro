//! Billing allocation and access policy over provider and owning-domain facts.
use super::billing::{
    SubscriptionBilling, SubscriptionBillingLineItem, SubscriptionBillingLineKind,
    SubscriptionNextInvoice, SubscriptionSeatTotal,
};
use hosted_runtimes::domain::{
    ids::ComputerId,
    models::{BillingInterval, ComputerName, ComputerStatusKind},
    size::CatalogEntry,
};
use teams::domain::model::{SeatPlan, SeatPrices, TeamRole};

#[derive(Clone)]
pub enum BillingAccess {
    Personal,
    Team(Option<TeamRole>),
}

impl BillingAccess {
    pub fn can_view(&self) -> bool {
        matches!(
            self,
            Self::Personal | Self::Team(Some(TeamRole::Owner | TeamRole::Admin))
        )
    }
}

#[derive(Clone)]
pub struct SubscriptionBillingFacts {
    pub access: BillingAccess,
    pub currency: String,
    pub interval: BillingInterval,
    pub items: Vec<RecurringItem>,
    pub seats: Vec<BillingSeat>,
    pub computers: Vec<BillingComputer>,
    pub next_invoice: Option<SubscriptionNextInvoice>,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub enum RecurringItemKind {
    Seat(SeatPlan),
    Other,
}

#[derive(Clone)]
pub struct RecurringItem {
    pub kind: RecurringItemKind,
    pub price_id: stripe::PriceId,
    pub computer_id: Option<ComputerId>,
    pub quantity: u64,
    pub unit_amount: i64,
    pub name: String,
}

#[derive(Clone)]
pub struct BillingSeat {
    pub plan: Option<SeatPlan>,
}

#[derive(Clone)]
pub struct BillingComputer {
    pub id: ComputerId,
    pub catalog_entry: CatalogEntry,
    pub price_id: Option<stripe::PriceId>,
    pub name: ComputerName,
    pub status: ComputerStatusKind,
    pub included: bool,
}

impl RecurringItemKind {
    /// Recorded computer identity wins over current price-table classifications.
    pub fn for_provider_price(
        seats: &SeatPrices,
        computers: &[BillingComputer],
        price_id: &stripe::PriceId,
        computer_id: Option<ComputerId>,
    ) -> Self {
        if computers.iter().any(|computer| {
            computer_id.map_or_else(
                || computer.price_id.as_ref() == Some(price_id),
                |id| computer.id == id,
            )
        }) {
            return Self::Other;
        }
        if let Some(plan) = seats.plan_for_price(price_id.as_str()) {
            return Self::Seat(plan);
        }
        Self::Other
    }
}

impl SubscriptionBillingFacts {
    /// Allocate actual billed quantities; unmatched or ambiguous quantities stay other.
    pub fn render(self) -> Option<SubscriptionBilling> {
        if !self.access.can_view() {
            return None;
        }
        let mut result = SubscriptionBilling {
            currency: self.currency,
            interval: self.interval,
            human_seats: SubscriptionSeatTotal::default(),
            line_items: Vec::new(),
            subscription_total: 0,
            next_invoice: self.next_invoice,
        };
        let items = self.items;
        for item in &items {
            let amount = item
                .unit_amount
                .checked_mul(i64::try_from(item.quantity).ok()?)?;
            result.subscription_total = result.subscription_total.checked_add(amount)?;
            let mut remaining = item.quantity;
            match &item.kind {
                RecurringItemKind::Seat(plan) => {
                    let seats: Vec<_> = self
                        .seats
                        .iter()
                        .filter(|seat| seat.plan.is_none_or(|seat_plan| seat_plan == *plan))
                        .collect();
                    let matching_items = items.iter().filter(|other| matches!(other.kind, RecurringItemKind::Seat(other_plan) if other_plan == *plan)).count();
                    let personal_items = items
                        .iter()
                        .filter(|other| matches!(other.kind, RecurringItemKind::Seat(_)))
                        .count();
                    if matching_items == 1
                        && (!matches!(self.access, BillingAccess::Personal) || personal_items == 1)
                        && u64::try_from(seats.len()).ok()? <= remaining
                    {
                        let quantity = u64::try_from(seats.len()).ok()?;
                        if quantity > 0 {
                            let amount = item
                                .unit_amount
                                .checked_mul(i64::try_from(quantity).ok()?)?;
                            let total = &mut result.human_seats;
                            total.quantity = total.quantity.checked_add(quantity)?;
                            total.amount = total.amount.checked_add(amount)?;
                            result.line_items.push(SubscriptionBillingLineItem {
                                kind: SubscriptionBillingLineKind::HumanSeat,
                                plan: Some(*plan),
                                quantity,
                                unit_amount: Some(item.unit_amount),
                                amount,
                                computer_id: None,
                                name: "Human seats".to_owned(),
                                size: None,
                                status: None,
                                included: false,
                            });
                            remaining -= quantity;
                        }
                    }
                }
                RecurringItemKind::Other => {
                    let computers: Vec<_> = self
                        .computers
                        .iter()
                        .filter(|computer| computer.matches(item))
                        .collect();
                    if u64::try_from(computers.len()).ok()? <= remaining
                        && computers.iter().all(|computer| {
                            items.iter().filter(|other| computer.matches(other)).count() == 1
                        })
                    {
                        for computer in computers {
                            result.line_items.push(computer.row(item.unit_amount));
                            remaining -= 1;
                        }
                    }
                }
            }
            if remaining > 0 {
                result.line_items.push(SubscriptionBillingLineItem {
                    kind: SubscriptionBillingLineKind::Other,
                    plan: None,
                    quantity: remaining,
                    unit_amount: Some(item.unit_amount),
                    amount: item
                        .unit_amount
                        .checked_mul(i64::try_from(remaining).ok()?)?,
                    computer_id: None,
                    name: item.name.clone(),
                    size: None,
                    status: None,
                    included: false,
                });
            }
        }
        for computer in self.computers.iter().filter(|computer| computer.included) {
            result.line_items.push(computer.row(0));
        }
        Some(result)
    }
}

impl BillingComputer {
    fn matches(&self, item: &RecurringItem) -> bool {
        !self.included
            && item.computer_id.map_or_else(
                || self.price_id.as_ref() == Some(&item.price_id),
                |id| self.id == id,
            )
    }

    fn row(&self, unit_amount: i64) -> SubscriptionBillingLineItem {
        SubscriptionBillingLineItem {
            kind: SubscriptionBillingLineKind::Computer,
            plan: None,
            quantity: 1,
            unit_amount: Some(unit_amount),
            amount: unit_amount,
            computer_id: Some(self.id.as_uuid()),
            name: self.name.as_str().to_owned(),
            size: Some(self.catalog_entry.size),
            status: Some(self.status),
            included: self.included,
        }
    }
}

#[cfg(test)]
mod test;
