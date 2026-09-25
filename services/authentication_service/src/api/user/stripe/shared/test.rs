use super::{PaidPlan, StripeOperationError, StripePrices};

fn prices() -> StripePrices {
    StripePrices {
        premium: "price_premium".to_string(),
        max: Some("price_max".to_string()),
    }
}

#[test]
fn premium_remains_available_for_purchase() {
    assert_eq!(
        prices().price_id(PaidPlan::Premium).unwrap(),
        "price_premium"
    );
}

#[test]
fn max_is_rejected_as_a_purchase_target() {
    assert!(matches!(
        prices().price_id(PaidPlan::Max),
        Err(StripeOperationError::PlanUnavailable)
    ));
}

#[test]
fn configured_max_prices_are_still_recognized() {
    assert_eq!(prices().plan_for_price("price_max"), Some(PaidPlan::Max));
}
