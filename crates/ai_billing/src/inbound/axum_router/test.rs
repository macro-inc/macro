use super::{ReturnUrlError, get_plans_handler, validate_return_url};
use crate::domain::{AiPricing, PlanTier};
use axum::extract::State;

#[test]
fn return_urls_must_be_https_on_the_calling_origin() {
    let origin = Some("https://macro.com");
    assert_eq!(
        validate_return_url("https://macro.com/app/settings/billing?x=1", origin),
        Ok(())
    );
    // Without an Origin header any https URL without credentials passes.
    assert_eq!(
        validate_return_url("https://preview.macro.com/app", None),
        Ok(())
    );
    assert_eq!(
        validate_return_url("http://localhost:3000/app", Some("http://localhost:3000")),
        Ok(())
    );
    assert_eq!(
        validate_return_url("https://macro.com:443/app", origin),
        Ok(())
    );
    assert_eq!(
        validate_return_url("https://macro.com:8443/app", origin),
        Err(ReturnUrlError::Origin)
    );
    assert_eq!(
        validate_return_url("https://evil.example/app", origin),
        Err(ReturnUrlError::Origin)
    );
    assert_eq!(
        validate_return_url("http://macro.com/app", None),
        Err(ReturnUrlError::Scheme)
    );
    assert_eq!(
        validate_return_url("javascript:alert(1)", None),
        Err(ReturnUrlError::Unparseable)
    );
    assert_eq!(
        validate_return_url("/app/settings/billing", None),
        Err(ReturnUrlError::Unparseable)
    );
    assert_eq!(
        validate_return_url("https://user:pw@macro.com/app", None),
        Err(ReturnUrlError::Credentials)
    );
}

#[tokio::test]
async fn plan_catalog_lists_every_tier_and_marks_the_purchasable_ones() {
    let pricing = AiPricing::testing();
    let plans = get_plans_handler(State(pricing)).await.0.plans;
    let summary = plans
        .iter()
        .map(|plan| (plan.tier, plan.purchasable, plan.included_ai_cents_per_seat))
        .collect::<Vec<_>>();

    // The frontend reads allowances from here, so every tier it can display is listed.
    assert_eq!(
        summary,
        vec![
            (PlanTier::Free, false, 0),
            (PlanTier::Premium, true, pricing.included_allowance_cents()),
            (PlanTier::Max, false, pricing.included_allowance_cents()),
        ]
    );
}
