use super::{PaidPlan, StripeOperationError, StripePrices};

fn prices() -> StripePrices {
    StripePrices {
        premium: "price_premium".to_string(),
        max: Some("price_max".to_string()),
    }
}

#[test]
fn every_purchasable_plan_resolves_to_its_configured_price() {
    assert_eq!(
        prices().price_id(PaidPlan::Premium).unwrap(),
        "price_premium"
    );
    assert_eq!(prices().price_id(PaidPlan::Max).unwrap(), "price_max");
}

#[test]
fn max_is_unavailable_until_its_price_is_configured() {
    let prices = StripePrices {
        premium: "price_premium".to_string(),
        max: None,
    };
    assert!(matches!(
        prices.price_id(PaidPlan::Max),
        Err(StripeOperationError::PlanUnavailable)
    ));
    assert_eq!(prices.price_id(PaidPlan::Premium).unwrap(), "price_premium");
}

#[test]
fn configured_prices_are_recognized_by_plan() {
    assert_eq!(
        prices().plan_for_price("price_premium"),
        Some(PaidPlan::Premium)
    );
    assert_eq!(prices().plan_for_price("price_max"), Some(PaidPlan::Max));
    assert_eq!(prices().plan_for_price("price_other"), None);
}
