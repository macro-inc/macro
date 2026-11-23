use super::{PaidPlan, StripePrices};
use teams::domain::model::CustomerError;

fn prices() -> StripePrices {
    StripePrices {
        premium: "price_premium".to_string(),
        max: Some("price_max".to_string()),
    }
}

#[test]
fn every_purchasable_plan_resolves_to_its_configured_price() {
    assert_eq!(
        prices()
            .seat_prices()
            .unwrap()
            .price_id(PaidPlan::Premium)
            .unwrap()
            .as_str(),
        "price_premium"
    );
    assert_eq!(
        prices()
            .seat_prices()
            .unwrap()
            .price_id(PaidPlan::Max)
            .unwrap()
            .as_str(),
        "price_max"
    );
}

#[test]
fn max_is_unavailable_until_its_price_is_configured() {
    let prices = StripePrices {
        premium: "price_premium".to_string(),
        max: None,
    };
    assert!(matches!(
        prices.seat_prices().unwrap().price_id(PaidPlan::Max),
        Err(CustomerError::PlanUnavailable(PaidPlan::Max))
    ));
    assert_eq!(
        prices
            .seat_prices()
            .unwrap()
            .price_id(PaidPlan::Premium)
            .unwrap()
            .as_str(),
        "price_premium"
    );
}
