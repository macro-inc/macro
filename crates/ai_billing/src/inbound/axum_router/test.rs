use super::{
    ReturnUrlError, SettleRequest, SubscriptionPeriodQuery, get_plans_handler, scope_from_query,
    validate_return_url,
};
use crate::domain::{AiPricing, PlanTier, SubscriptionScope};
use axum::extract::{Query, State};
use macro_uuid::Uuid;

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

#[test]
fn subscription_period_query_selects_the_scope() {
    let Query(team) = Query::<SubscriptionPeriodQuery>::try_from_uri(
        &"/internal/ai-billing/subscription-period?customerId=cus_123&teamId=00000000-0000-0000-0000-000000000007"
            .parse()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(team.customer_id, "cus_123");
    assert_eq!(
        scope_from_query(team.team_id),
        SubscriptionScope::Team {
            team_id: Uuid::from_u128(7)
        }
    );

    let Query(personal) = Query::<SubscriptionPeriodQuery>::try_from_uri(
        &"/internal/ai-billing/subscription-period?customerId=cus_123"
            .parse()
            .unwrap(),
    )
    .unwrap();
    assert_eq!(personal.customer_id, "cus_123");
    assert_eq!(
        scope_from_query(personal.team_id),
        SubscriptionScope::Personal
    );
}

#[test]
fn settle_request_reads_the_camel_case_user_id() {
    let request: SettleRequest = serde_json::from_str(r#"{"userId":"macro|a@b.c"}"#).unwrap();
    assert_eq!(request.user_id, "macro|a@b.c");
}
