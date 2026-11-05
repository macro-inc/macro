//! Provider prices and owning-domain billing facts for subscription status.
use crate::{
    domain::computer_billing::ComputerPrices,
    service::{
        subscription_plan::PlanChangeError,
        subscription_status::{
            SubscriptionNextInvoice,
            billing_facts::{
                BillingAccess, BillingComputer, BillingSeat, RecurringItem, RecurringItemKind,
                SubscriptionBillingFacts,
            },
        },
    },
};
use ai_billing::domain::SubscriptionScope;
use hosted_runtimes::domain::{
    lifecycle::{PaymentOutcome, Phase},
    ports::ComputerRepo,
};
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;
use team_agents::domain::{
    models::{BillingInterval, ComputerSize},
    ports::TeamAgentRepository,
};
use teams::domain::{
    model::{SeatPrices, TeamRole},
    team_repo::TeamRepository,
};

#[derive(Clone)]
pub struct StripeBillingReader<Teams, Computers, Agents> {
    db: sqlx::PgPool,
    teams: Teams,
    computers: Computers,
    agents: Agents,
    seat_prices: SeatPrices,
    computer_prices: ComputerPrices,
}

impl<Teams: TeamRepository, Computers: ComputerRepo, Agents: TeamAgentRepository>
    StripeBillingReader<Teams, Computers, Agents>
{
    pub fn new(
        db: sqlx::PgPool,
        teams: Teams,
        computers: Computers,
        agents: Agents,
        seat_prices: SeatPrices,
        computer_prices: ComputerPrices,
    ) -> Self {
        Self {
            db,
            teams,
            computers,
            agents,
            seat_prices,
            computer_prices,
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
        let mut provider_items = subscription.items.data.clone();
        if subscription.items.has_more {
            let mut params = stripe::ListSubscriptionItems::new(subscription.id.clone());
            params.limit = Some(100);
            params.starting_after = provider_items.last().map(|item| item.id.clone());
            loop {
                let page = stripe::SubscriptionItem::list(stripe, &params)
                    .await
                    .map_err(anyhow::Error::from)?;
                let last = page.data.last().map(|item| item.id.clone());
                provider_items.extend(page.data);
                if !page.has_more {
                    break;
                }
                params.starting_after =
                    Some(last.ok_or_else(|| anyhow::anyhow!("missing subscription item cursor"))?);
            }
        }
        let mut currency = None;
        let mut interval = None;
        let mut items = Vec::new();
        for item in provider_items {
            let Some(price) = item.price else {
                return Ok(None);
            };
            let Some(fixed) = fixed_price(&price) else {
                return Ok(None);
            };
            if currency
                .as_ref()
                .is_some_and(|value| value != &fixed.currency)
                || interval.is_some_and(|value| value != fixed.interval)
            {
                return Ok(None);
            }
            currency = Some(fixed.currency);
            interval = Some(fixed.interval);
            let unit_amount = fixed.unit_amount;
            let kind = if let Some(plan) = self.seat_prices.plan_for_price(price.id.as_str()) {
                RecurringItemKind::Seat(plan)
            } else if let Some(size) = self.computer_prices.size_for_price(price.id.as_str()) {
                RecurringItemKind::Computer(agent_size(size))
            } else {
                RecurringItemKind::Other
            };
            items.push(RecurringItem {
                kind,
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
                let info = macro_db_client::user::get::get_legacy_user_info(&self.db, user).await?;
                // The price determines the plan for a personal subscription; one seat belongs to its caller.
                Ok((
                    BillingAccess::Personal,
                    vec![BillingSeat {
                        plan: None,
                        agent: info.is_agent,
                        included: false,
                    }],
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
                let mut seats = Vec::new();
                for member in members {
                    let info =
                        macro_db_client::user::get::get_legacy_user_info(&self.db, &member.user_id)
                            .await?;
                    let included = self
                        .teams
                        .is_seat_included(&team_id, &member.user_id)
                        .await
                        .map_err(anyhow::Error::from)?;
                    seats.push(BillingSeat {
                        plan: Some(member.plan),
                        agent: info.is_agent,
                        included,
                    });
                }
                let agents = self
                    .agents
                    .list_for_team(team_id)
                    .await
                    .map_err(anyhow::Error::from)?;
                let mut computers = Vec::new();
                for computer in self
                    .computers
                    .list_for_team(team_id)
                    .await
                    .map_err(anyhow::Error::from)?
                {
                    if computer.state.phase == Phase::Destroyed
                        || (computer.state.payment == PaymentOutcome::Paid
                            && matches!(
                                computer.state.billing,
                                hosted_runtimes::domain::lifecycle::Billing::Canceled { .. }
                            ))
                        || !matches!(
                            computer.state.payment,
                            PaymentOutcome::Paid | PaymentOutcome::Comped
                        )
                    {
                        continue;
                    }
                    let agent = agents
                        .iter()
                        .find(|agent| agent.computer_id == Some(computer.id));
                    let status = computer.status().status;
                    computers.push(BillingComputer {
                        id: computer.id,
                        agent_user_id: agent.map(|agent| agent.user_id.clone()),
                        size: agent_size(computer.size),
                        name: computer.name,
                        status,
                        included: computer.state.payment == PaymentOutcome::Comped,
                    });
                }
                Ok((BillingAccess::Team(role), seats, computers))
            }
        }
    }
}

fn agent_size(size: hosted_runtimes::domain::size::ComputerSize) -> ComputerSize {
    match size {
        hosted_runtimes::domain::size::ComputerSize::Standard => ComputerSize::Standard,
        hosted_runtimes::domain::size::ComputerSize::Large => ComputerSize::Large,
        hosted_runtimes::domain::size::ComputerSize::Xl => ComputerSize::Xl,
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
