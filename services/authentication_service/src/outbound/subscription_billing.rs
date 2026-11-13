//! Provider prices and owning-domain billing facts for subscription status.
use crate::service::{
    subscription_plan::PlanChangeError,
    subscription_status::{
        SubscriptionNextInvoice,
        billing_facts::{
            BillingAccess, BillingComputer, BillingSeat, RecurringItem, RecurringItemKind,
            SubscriptionBillingFacts,
        },
    },
};
use ai_billing::domain::SubscriptionScope;
use hosted_runtimes::domain::{
    ids::ComputerId, lifecycle::Billing as ComputerBilling, models::BillingInterval,
    ports::ComputerRepo, size::CatalogEntry,
};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use teams::domain::{
    model::{SeatPrices, TeamRole},
    team_repo::TeamRepository,
};

#[derive(Clone)]
pub struct StripeBillingReader<Teams, Computers> {
    teams: Teams,
    computers: Computers,
    seat_prices: SeatPrices,
}

impl<Teams: TeamRepository, Computers: ComputerRepo> StripeBillingReader<Teams, Computers> {
    pub fn new(teams: Teams, computers: Computers, seat_prices: SeatPrices) -> Self {
        Self {
            teams,
            computers,
            seat_prices,
        }
    }

    /// Return ownership/role facts without fetching provider financial data.
    pub async fn access(
        &self,
        scope: SubscriptionScope,
        user: &MacroUserIdStr<'_>,
    ) -> Result<BillingAccess, PlanChangeError> {
        match scope {
            SubscriptionScope::Personal => Ok(BillingAccess::Personal),
            SubscriptionScope::Team { team_id } => {
                let owner = self
                    .teams
                    .get_team_owner(&team_id)
                    .await
                    .map_err(anyhow::Error::from)?;
                let members = self
                    .teams
                    .get_team_members(&team_id)
                    .await
                    .map_err(anyhow::Error::from)?;
                let role = if owner == *user {
                    Some(TeamRole::Owner)
                } else {
                    members
                        .iter()
                        .find(|member| member.user_id == *user)
                        .map(|member| member.role)
                };
                Ok(BillingAccess::Team(role))
            }
        }
    }

    #[tracing::instrument(name = "billing.subscription.read", skip_all, err)]
    pub async fn read(
        &self,
        stripe: &Arc<stripe::Client>,
        subscription: &stripe::Subscription,
        scope: SubscriptionScope,
        user: &MacroUserIdStr<'_>,
    ) -> Result<Option<SubscriptionBillingFacts>, PlanChangeError> {
        let (access, seats, computers) = self.directory(scope, user).await?;
        let provider_items = if subscription.items.has_more {
            teams::outbound::customer_repo::list_subscription_items(stripe, &subscription.id)
                .await
                .map_err(anyhow::Error::from)?
        } else {
            subscription.items.data.clone()
        };
        let mut currency = None;
        let mut interval = None;
        let mut items = Vec::new();
        for item in provider_items {
            // A computer's own price carries its id too (schedule phases drop item metadata).
            let computer_id = teams::outbound::customer_repo::item_computer_uuid(&item)
                .map(ComputerId::new_from_uuid);
            // Any of these hides the whole breakdown; say which item did.
            let Some(price) = item.price else {
                tracing::warn!(subscription_item = %item.id, "billing breakdown dropped: item has no price");
                return Ok(None);
            };
            let Some(fixed) = fixed_price(&price) else {
                tracing::warn!(subscription_item = %item.id, "billing breakdown dropped: item price is not fixed");
                return Ok(None);
            };
            if currency
                .as_ref()
                .is_some_and(|value| value != &fixed.currency)
                || interval.is_some_and(|value| value != fixed.interval)
            {
                tracing::warn!(subscription_item = %item.id, "billing breakdown dropped: items mix currencies or intervals");
                return Ok(None);
            }
            currency = Some(fixed.currency);
            interval = Some(fixed.interval);
            let unit_amount = fixed.unit_amount;
            let price_id = price.id.clone();
            let kind = RecurringItemKind::for_provider_price(
                &self.seat_prices,
                &computers,
                &price_id,
                computer_id,
            );
            items.push(RecurringItem {
                kind,
                price_id,
                computer_id,
                quantity: item.quantity.unwrap_or(1),
                unit_amount,
                name: price
                    .nickname
                    .unwrap_or_else(|| "Subscription item".to_owned()),
            });
        }
        let (Some(currency), Some(interval)) = (currency, interval) else {
            return Ok(None);
        };
        let next_invoice = upcoming_invoice(stripe, subscription, &currency).await?;
        Ok(Some(SubscriptionBillingFacts {
            access,
            currency,
            interval,
            items,
            seats,
            computers,
            next_invoice,
        }))
    }

    #[tracing::instrument(name = "billing.subscription.directory", skip_all, err)]
    async fn directory(
        &self,
        scope: SubscriptionScope,
        user: &MacroUserIdStr<'_>,
    ) -> Result<(BillingAccess, Vec<BillingSeat>, Vec<BillingComputer>), PlanChangeError> {
        match scope {
            SubscriptionScope::Personal => {
                // The price determines the plan for a personal subscription; one seat belongs to its caller.
                Ok((
                    BillingAccess::Personal,
                    vec![BillingSeat { plan: None }],
                    vec![],
                ))
            }
            SubscriptionScope::Team { team_id } => {
                let owner = self
                    .teams
                    .get_team_owner(&team_id)
                    .await
                    .map_err(anyhow::Error::from)?;
                let members = self
                    .teams
                    .get_team_members(&team_id)
                    .await
                    .map_err(anyhow::Error::from)?;
                let role = if owner == *user {
                    Some(TeamRole::Owner)
                } else {
                    members
                        .iter()
                        .find(|member| member.user_id == *user)
                        .map(|member| member.role)
                };
                let seats = members
                    .iter()
                    .map(|member| BillingSeat {
                        plan: Some(member.plan),
                    })
                    .collect();
                let mut computers = Vec::new();
                for record in self
                    .computers
                    .list_for_team(team_id)
                    .await
                    .map_err(anyhow::Error::from)?
                {
                    let Ok(computer) = record.into_healthy() else {
                        continue;
                    };
                    // A computer whose billing ended is no longer on the bill.
                    if !computer.state.is_live()
                        || matches!(computer.state.billing, ComputerBilling::EndsAt { .. })
                    {
                        continue;
                    }
                    let status = computer
                        .status(0, chrono::Utc::now(), self.computers.policy())
                        .status;
                    let price_id = match computer.funding() {
                        Some(hosted_runtimes::domain::models::Funding::Stripe { price_id }) => {
                            Some(price_id.clone())
                        }
                        Some(hosted_runtimes::domain::models::Funding::Comped { .. }) | None => {
                            None
                        }
                    };
                    computers.push(BillingComputer {
                        id: computer.id,
                        catalog_entry: CatalogEntry {
                            id: computer.catalog_entry,
                            size: computer.size,
                            resources: computer.resources,
                        },
                        price_id,
                        name: computer.name,
                        status,
                        included: matches!(computer.state.billing, ComputerBilling::Comped { .. }),
                    });
                }
                Ok((BillingAccess::Team(role), seats, computers))
            }
        }
    }
}

struct FixedRecurringPrice {
    currency: String,
    interval: BillingInterval,
    unit_amount: i64,
}

/// Shapes for which raw licensed quantity times unit price is exact.
fn fixed_price(price: &stripe::Price) -> Option<FixedRecurringPrice> {
    if price.billing_scheme != Some(stripe::PriceBillingScheme::PerUnit)
        || price.transform_quantity.is_some()
    {
        return None;
    }
    let recurring = price.recurring.as_ref()?;
    if recurring.interval_count != 1 || recurring.usage_type != stripe::RecurringUsageType::Licensed
    {
        return None;
    }
    let interval = match recurring.interval {
        stripe::RecurringInterval::Month => BillingInterval::Month,
        stripe::RecurringInterval::Year => BillingInterval::Year,
        _ => return None,
    };
    let unit_amount = price.unit_amount?;
    if price
        .unit_amount_decimal
        .as_ref()
        .is_some_and(|decimal| decimal != &unit_amount.to_string())
    {
        return None;
    }
    Some(FixedRecurringPrice {
        currency: price.currency?.to_string(),
        interval,
        unit_amount,
    })
}

#[cfg(test)]
mod test;

#[tracing::instrument(name = "billing.subscription.invoice_preview", skip_all, err)]
async fn upcoming_invoice(
    stripe: &stripe::Client,
    subscription: &stripe::Subscription,
    currency: &str,
) -> Result<Option<SubscriptionNextInvoice>, PlanChangeError> {
    let mut params = stripe::RetrieveUpcomingInvoice::new(subscription.customer.id());
    params.subscription = Some(subscription.id.clone());
    let next_invoice = match stripe::Invoice::upcoming(stripe, params).await {
        Ok(invoice)
            if invoice
                .currency
                .as_ref()
                .is_some_and(|value| value.to_string() == currency) =>
        {
            invoice.amount_due.map(|amount| SubscriptionNextInvoice {
                amount,
                date: invoice
                    .next_payment_attempt
                    .or(invoice.due_date)
                    .and_then(|time| chrono::DateTime::from_timestamp(time, 0)),
            })
        }
        Ok(_) => None,
        Err(stripe::StripeError::Stripe(error))
            if error.code == Some(stripe::ErrorCode::InvoiceUpcomingNone) =>
        {
            None
        }
        Err(error) => return Err(anyhow::Error::from(error).into()),
    };
    Ok(next_invoice)
}
