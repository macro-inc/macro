//! Authenticated customer lookup and Stripe subscription translation.
use crate::service::subscription_plan::{
    PersonalSubscription, PlanAction, PlanChangeError, PlanGateway,
};
use crate::service::subscription_status::{SubscriptionPlanFacts, SubscriptionStatusGateway};
use ai_billing::domain::SubscriptionScope;
use macro_user_id::user_id::MacroUserIdStr;
use sqlx::PgPool;
use std::sync::Arc;
use teams::domain::{
    customer_repo::CustomerRepository,
    model::{SeatPlan, SeatPrices},
};
/// Composed with the owning billing adapter through its domain port.
#[derive(Clone)]
pub struct StripePlanGateway<C> {
    db: PgPool,
    stripe: Arc<stripe::Client>,
    prices: SeatPrices,
    customer: C,
}
impl<C> StripePlanGateway<C> {
    /// Inject customer storage, provider client and billing domain capabilities.
    pub fn new(db: PgPool, stripe: Arc<stripe::Client>, prices: SeatPrices, customer: C) -> Self {
        Self {
            db,
            stripe,
            prices,
            customer,
        }
    }

    async fn subscription(
        &self,
        customer: &str,
        scope: SubscriptionScope,
    ) -> Result<Option<stripe::Subscription>, PlanChangeError> {
        let mut params = stripe::ListSubscriptions::new();
        params.customer = Some(customer.parse().map_err(anyhow::Error::from)?);
        params.limit = Some(100);
        let mut found = None;
        loop {
            let page = stripe::Subscription::list(&self.stripe, &params)
                .await
                .map_err(anyhow::Error::from)?;
            let last = page.data.last().map(|s| s.id.clone());
            for subscription in page.data {
                let matches_scope = match scope {
                    SubscriptionScope::Personal => !subscription.metadata.contains_key("team_id"),
                    SubscriptionScope::Team { team_id } => {
                        subscription.metadata.get("team_id") == Some(&team_id.to_string())
                    }
                };
                if matches_scope
                    && matches!(
                        subscription.status,
                        stripe::SubscriptionStatus::Active | stripe::SubscriptionStatus::Trialing
                    )
                {
                    if found.is_some() {
                        return Err(PlanChangeError::AmbiguousSubscription);
                    }
                    found = Some(subscription);
                }
            }
            if !page.has_more {
                break;
            }
            params.starting_after =
                Some(last.ok_or_else(|| anyhow::anyhow!("missing pagination cursor"))?);
        }
        Ok(found)
    }
}
impl<C: CustomerRepository> PlanGateway for StripePlanGateway<C> {
    async fn personal_subscription(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> Result<PersonalSubscription, PlanChangeError> {
        let id = macro_db_client::user::get::get_stripe_customer_id_by_user_id(&self.db, user)
            .await
            .map_err(anyhow::Error::from)?
            .ok_or(PlanChangeError::MissingCustomer)?;
        let subscription = self
            .subscription(&id, SubscriptionScope::Personal)
            .await?
            .ok_or(PlanChangeError::NoSubscription)?;
        let seats = subscription
            .items
            .data
            .iter()
            .filter_map(|item| {
                let plan = item
                    .price
                    .as_ref()
                    .and_then(|p| self.prices.plan_for_price(p.id.as_str()))?;
                Some((plan, item.quantity.unwrap_or(1)))
            })
            .collect::<Vec<_>>();
        let plan = match seats.as_slice() {
            [(plan, 1)] => *plan,
            [] => return Err(PlanChangeError::NoSubscription),
            _ => return Err(PlanChangeError::AmbiguousSubscription),
        };
        Ok(PersonalSubscription {
            id: subscription.id.to_string(),
            plan,
        })
    }
    async fn apply(
        &self,
        user: &MacroUserIdStr<'_>,
        subscription: PersonalSubscription,
        target: SeatPlan,
        action: PlanAction,
    ) -> Result<(), PlanChangeError> {
        self.prices
            .price_id(target)
            .map_err(|_| PlanChangeError::PlanUnavailable)?;
        let id = subscription.id.parse().map_err(anyhow::Error::from)?;
        match action {
            PlanAction::ScheduleDowngrade => {
                self.customer
                    .schedule_seat_plan(&id, user, Some(target))
                    .await
            }
            PlanAction::KeepCurrent => self.customer.schedule_seat_plan(&id, user, None).await,
            PlanAction::Upgrade => {
                self.customer
                    .schedule_seat_plan(&id, user, None)
                    .await
                    .map_err(anyhow::Error::from)?;
                self.customer.upgrade_personal_plan(&id, target).await
            }
        }
        .map_err(anyhow::Error::from)?;
        Ok(())
    }
}

impl<C: CustomerRepository> SubscriptionStatusGateway for StripePlanGateway<C> {
    async fn status(
        &self,
        customer: &str,
        scope: SubscriptionScope,
        user: &MacroUserIdStr<'_>,
    ) -> Result<Option<SubscriptionPlanFacts>, PlanChangeError> {
        let Some(subscription) = self.subscription(customer, scope).await? else {
            return Ok(None);
        };
        let period_end = chrono::DateTime::from_timestamp(subscription.current_period_end, 0)
            .ok_or_else(|| anyhow::anyhow!("invalid subscription renewal date"))?;
        let scheduled_change = match subscription.schedule.as_ref() {
            Some(schedule) => self
                .customer
                .scheduled_seat_plan(&subscription.id, &schedule.id(), user)
                .await
                .map_err(anyhow::Error::from)?,
            None => None,
        };
        Ok(Some(SubscriptionPlanFacts {
            period_end,
            scheduled_change,
        }))
    }
}
