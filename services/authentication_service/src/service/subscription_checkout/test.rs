use super::*;
use std::sync::Mutex;

#[derive(Default)]
struct FakeGateway {
    history: SubscriptionHistory,
    history_failure: bool,
    missing_customer: bool,
    invalid_promo: bool,
    invite: bool,
    created: Mutex<Vec<(CheckoutTerms, Option<String>)>>,
    promotion_reads: Mutex<u8>,
}

impl CheckoutGateway for FakeGateway {
    type Customer = ();
    type Promotion = String;
    type Error = std::io::Error;

    async fn customer(&self, _: &MacroUserIdStr<'_>) -> Result<Option<()>, Self::Error> {
        Ok((!self.missing_customer).then_some(()))
    }
    async fn history(&self, _: &()) -> Result<SubscriptionHistory, Self::Error> {
        if self.history_failure {
            return Err(std::io::Error::other("offline"));
        }
        Ok(self.history)
    }
    async fn invite_promotion(
        &self,
        _: &MacroUserIdStr<'_>,
    ) -> Result<Option<String>, Self::Error> {
        Ok(self.invite.then(|| "invite".into()))
    }
    async fn promotion(&self, code: &str) -> Result<Option<String>, Self::Error> {
        *self.promotion_reads.lock().unwrap() += 1;
        Ok((!self.invalid_promo).then(|| code.to_owned()))
    }
    async fn create_session(
        &self,
        _: (),
        _: CheckoutRequest<'_>,
        terms: CheckoutTerms,
        promotion: Option<String>,
    ) -> Result<String, Self::Error> {
        self.created.lock().unwrap().push((terms, promotion));
        Ok("https://checkout.stripe.com/test".into())
    }
}

fn request(trial: bool) -> CheckoutRequest<'static> {
    CheckoutRequest {
        user_id: MacroUserIdStr::parse_from_str("macro|test@example.com").unwrap(),
        plan: SeatPlan::Premium,
        onboarding_trial: trial,
        success_url: "https://macro.com/app/onboarding?subscriptionSuccess=true".into(),
        cancel_url: "https://macro.com/app/onboarding?subscriptionCancel=true".into(),
        discount: None,
        metadata: HashMap::new(),
    }
}

#[tokio::test]
async fn first_subscription_gets_trial_without_a_code_or_invite() {
    let service = CheckoutService::new(FakeGateway::default());
    let checkout = service.create(request(true)).await.unwrap();
    assert_eq!(checkout.trial_days, Some(30));
    assert_eq!(
        *service.gateway.created.lock().unwrap(),
        vec![(CheckoutTerms::Trial, None)]
    );
    assert_eq!(*service.gateway.promotion_reads.lock().unwrap(), 0);
}

#[tokio::test]
async fn canceled_subscription_does_not_get_another_trial_or_a_paid_fallback() {
    let service = CheckoutService::new(FakeGateway {
        history: SubscriptionHistory {
            has_previous_subscription: true,
            has_active_subscription: false,
        },
        ..Default::default()
    });
    assert!(matches!(
        service.create(request(true)).await,
        Err(CheckoutError::TrialUnavailable)
    ));
    assert!(service.gateway.created.lock().unwrap().is_empty());
}

#[tokio::test]
async fn active_and_trialing_customers_cannot_buy_a_second_subscription() {
    let service = CheckoutService::new(FakeGateway {
        history: SubscriptionHistory {
            has_previous_subscription: true,
            has_active_subscription: true,
        },
        ..Default::default()
    });
    for trial in [true, false] {
        assert!(matches!(
            service.create(request(trial)).await,
            Err(CheckoutError::AlreadySubscribed)
        ));
    }
    assert!(service.gateway.created.lock().unwrap().is_empty());
}

#[tokio::test]
async fn history_failure_cannot_turn_a_trial_into_an_immediate_charge() {
    let service = CheckoutService::new(FakeGateway {
        history_failure: true,
        ..Default::default()
    });
    assert!(matches!(
        service.create(request(true)).await,
        Err(CheckoutError::Gateway(_))
    ));
    assert!(service.gateway.created.lock().unwrap().is_empty());
}

#[tokio::test]
async fn ordinary_checkout_keeps_its_paid_terms_and_invite_promotion() {
    let service = CheckoutService::new(FakeGateway {
        invite: true,
        history: SubscriptionHistory {
            has_previous_subscription: true,
            has_active_subscription: false,
        },
        ..Default::default()
    });
    let checkout = service.create(request(false)).await.unwrap();
    assert_eq!(checkout.trial_days, None);
    assert_eq!(
        *service.gateway.created.lock().unwrap(),
        vec![(CheckoutTerms::Paid, Some("invite".into()))]
    );
}

#[tokio::test]
async fn explicit_invalid_discount_is_rejected_for_paid_checkout() {
    let service = CheckoutService::new(FakeGateway {
        invalid_promo: true,
        ..Default::default()
    });
    let mut input = request(false);
    input.discount = Some("bad-code".into());
    assert!(matches!(
        service.create(input).await,
        Err(CheckoutError::PromoCodeNotFound)
    ));
    assert!(service.gateway.created.lock().unwrap().is_empty());
}

#[tokio::test]
async fn trial_does_not_require_or_stack_an_invite_discount() {
    let service = CheckoutService::new(FakeGateway {
        invite: true,
        invalid_promo: true,
        ..Default::default()
    });
    let mut input = request(true);
    input.discount = Some("old-code".into());
    service.create(input).await.unwrap();
    assert_eq!(
        *service.gateway.created.lock().unwrap(),
        vec![(CheckoutTerms::Trial, None)]
    );
    assert_eq!(*service.gateway.promotion_reads.lock().unwrap(), 0);
}

#[tokio::test]
async fn missing_customer_and_unavailable_plan_never_create_checkout() {
    let service = CheckoutService::new(FakeGateway {
        missing_customer: true,
        ..Default::default()
    });
    assert!(matches!(
        service.create(request(true)).await,
        Err(CheckoutError::MissingCustomer)
    ));
    let mut input = request(true);
    input.plan = SeatPlan::Max;
    assert!(matches!(
        service.create(input).await,
        Err(CheckoutError::PlanUnavailable)
    ));
    assert!(service.gateway.created.lock().unwrap().is_empty());
}
