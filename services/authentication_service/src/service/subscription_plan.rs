//! Personal plan-change policy. Downgrades preserve already paid access until renewal.
use macro_user_id::user_id::MacroUserIdStr;
use teams::domain::model::SeatPlan;

/// Active personal subscription facts, with provider identity kept opaque.
pub struct PersonalSubscription {
    /// Provider subscription identifier supplied by the authenticated customer lookup.
    pub id: String,
    /// Currently effective tier, excluding future phases.
    pub plan: SeatPlan,
    /// The introductory Pro trial is still running. Max cannot inherit it.
    pub trialing: bool,
}
/// Operation selected by the service, never by an untrusted client.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PlanAction {
    /// Apply the higher plan immediately. A Pro trial ends and bills now.
    Upgrade {
        /// End the trial and start the new billing cycle instead of carrying it over.
        end_trial: bool,
    },
    /// Apply the lower plan at the next renewal.
    ScheduleDowngrade,
    /// Cancel a pending downgrade without changing the current price.
    KeepCurrent,
}
/// Errors independent of HTTP or the payment provider.
#[derive(Debug, thiserror::Error)]
pub enum PlanChangeError {
    #[error("User has no billing customer")]
    MissingCustomer,
    #[error("No active personal subscription")]
    NoSubscription,
    #[error("Multiple active personal subscriptions")]
    AmbiguousSubscription,
    #[error("Plan unavailable")]
    PlanUnavailable,
    #[error(transparent)]
    Gateway(#[from] anyhow::Error),
}
/// Capabilities for authenticated, customer-scoped personal subscriptions.
pub trait PlanGateway: Send + Sync {
    /// Load all live personal subscriptions belonging to this user.
    fn personal_subscription(
        &self,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<PersonalSubscription, PlanChangeError>> + Send;
    /// Execute exactly the timing selected by the service.
    fn apply(
        &self,
        user: &MacroUserIdStr<'_>,
        subscription: PersonalSubscription,
        target: SeatPlan,
        action: PlanAction,
    ) -> impl Future<Output = Result<(), PlanChangeError>> + Send;
}
/// Owns upgrade/downgrade timing; the gateway handles provider details.
pub struct PlanService<G> {
    gateway: G,
}
impl<G: PlanGateway> PlanService<G> {
    /// Compose policy with its provider port.
    pub fn new(gateway: G) -> Self {
        Self { gateway }
    }
    /// Select immediate upgrade, renewal downgrade or cancellation of a pending change.
    pub async fn change(
        &self,
        user: &MacroUserIdStr<'_>,
        target: SeatPlan,
    ) -> Result<SeatPlan, PlanChangeError> {
        if !SeatPlan::PURCHASABLE.contains(&target) {
            return Err(PlanChangeError::PlanUnavailable);
        }
        let subscription = self.gateway.personal_subscription(user).await?;
        let action = action(subscription.plan, target, subscription.trialing);
        let active = if matches!(action, PlanAction::Upgrade { .. }) {
            target
        } else {
            subscription.plan
        };
        self.gateway
            .apply(user, subscription, target, action)
            .await?;
        Ok(active)
    }
}
fn action(current: SeatPlan, target: SeatPlan, trialing: bool) -> PlanAction {
    if current == target {
        PlanAction::KeepCurrent
    } else if target == SeatPlan::Max {
        PlanAction::Upgrade {
            end_trial: trialing,
        }
    } else {
        PlanAction::ScheduleDowngrade
    }
}
#[cfg(test)]
mod test {
    use super::*;
    use std::sync::Mutex;
    struct Fake {
        calls: Mutex<Vec<PlanAction>>,
    }
    impl PlanGateway for Fake {
        async fn personal_subscription(
            &self,
            _: &MacroUserIdStr<'_>,
        ) -> Result<PersonalSubscription, PlanChangeError> {
            Ok(PersonalSubscription {
                id: "sub_test".into(),
                plan: SeatPlan::Max,
                trialing: false,
            })
        }
        async fn apply(
            &self,
            _: &MacroUserIdStr<'_>,
            _: PersonalSubscription,
            _: SeatPlan,
            action: PlanAction,
        ) -> Result<(), PlanChangeError> {
            self.calls.lock().unwrap().push(action);
            Ok(())
        }
    }
    #[tokio::test]
    async fn max_pro_max_schedules_then_cancels_without_an_upgrade() {
        let service = PlanService::new(Fake {
            calls: Mutex::new(Vec::new()),
        });
        let user = MacroUserIdStr::try_from("macro|max@example.com").unwrap();
        assert_eq!(
            service.change(&user, SeatPlan::Premium).await.unwrap(),
            SeatPlan::Max
        );
        assert_eq!(
            service.change(&user, SeatPlan::Max).await.unwrap(),
            SeatPlan::Max
        );
        assert_eq!(
            *service.gateway.calls.lock().unwrap(),
            vec![PlanAction::ScheduleDowngrade, PlanAction::KeepCurrent]
        );
    }
    #[test]
    fn pro_max_is_an_immediate_upgrade() {
        assert_eq!(
            action(SeatPlan::Premium, SeatPlan::Max, false),
            PlanAction::Upgrade { end_trial: false }
        );
    }

    #[test]
    fn pro_trial_to_max_ends_the_trial_instead_of_carrying_it() {
        assert_eq!(
            action(SeatPlan::Premium, SeatPlan::Max, true),
            PlanAction::Upgrade { end_trial: true }
        );
    }
}
