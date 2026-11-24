use super::{PaidPlan, StripePrices};
use teams::domain::model::{BillingCadence, CustomerError};

fn prices() -> StripePrices {
    StripePrices {
        premium: "price_premium".to_string(),
        max: Some("price_max".to_string()),
        ..Default::default()
    }
}

#[test]
fn every_purchasable_plan_resolves_to_its_configured_price() {
    let prices = StripePrices {
        business_monthly: Some("price_business".to_string()),
        business_yearly: Some("price_business_year".to_string()),
        max_yearly: Some("price_max_year".to_string()),
        ..prices()
    }
    .seat_prices()
    .unwrap();
    let price = |plan, cadence| prices.price_id(plan, cadence).unwrap().as_str().to_owned();

    assert_eq!(
        price(PaidPlan::Premium, BillingCadence::Month),
        "price_premium"
    );
    assert_eq!(
        price(PaidPlan::Business, BillingCadence::Month),
        "price_business"
    );
    assert_eq!(
        price(PaidPlan::Business, BillingCadence::Year),
        "price_business_year"
    );
    assert_eq!(price(PaidPlan::Max, BillingCadence::Month), "price_max");
    assert_eq!(price(PaidPlan::Max, BillingCadence::Year), "price_max_year");
}

#[test]
fn max_is_unavailable_until_its_price_is_configured() {
    let prices = StripePrices {
        max: None,
        ..prices()
    }
    .seat_prices()
    .unwrap();
    assert!(matches!(
        prices.price_id(PaidPlan::Max, BillingCadence::Month),
        Err(CustomerError::PlanUnavailable(PaidPlan::Max))
    ));
    assert_eq!(
        prices
            .price_id(PaidPlan::Premium, BillingCadence::Month)
            .unwrap()
            .as_str(),
        "price_premium"
    );
}

#[test]
fn premium_is_never_sold_annually_and_business_waits_for_its_prices() {
    let prices = prices().seat_prices().unwrap();
    assert!(matches!(
        prices.price_id(PaidPlan::Premium, BillingCadence::Year),
        Err(CustomerError::PlanUnavailable(PaidPlan::Premium))
    ));
    assert!(matches!(
        prices.price_id(PaidPlan::Business, BillingCadence::Month),
        Err(CustomerError::PlanUnavailable(PaidPlan::Business))
    ));
    assert!(!prices.is_sold(PaidPlan::Business));
}

#[test]
fn a_new_monthly_max_price_keeps_the_original_for_its_subscribers() {
    let prices = StripePrices {
        max_monthly: Some("price_max_220".to_string()),
        ..prices()
    }
    .seat_prices()
    .unwrap();

    assert_eq!(
        prices
            .price_id(PaidPlan::Max, BillingCadence::Month)
            .unwrap()
            .as_str(),
        "price_max_220"
    );
    assert_eq!(prices.plan_for_price("price_max"), Some(PaidPlan::Max));
    assert_eq!(prices.plan_for_price("price_max_220"), Some(PaidPlan::Max));
}

#[test]
fn annual_prices_are_configured_together() {
    let only_max = StripePrices {
        max_yearly: Some("price_max_year".to_string()),
        ..prices()
    };
    assert!(only_max.seat_prices().is_err());
}

#[test]
fn blank_prices_count_as_unset_and_malformed_ones_are_refused() {
    let blank = StripePrices {
        business_monthly: Some("  ".to_string()),
        ..prices()
    }
    .seat_prices()
    .unwrap();
    assert!(!blank.is_sold(PaidPlan::Business));

    let malformed = StripePrices {
        business_yearly: Some("prod_not_a_price".to_string()),
        ..prices()
    };
    assert!(malformed.seat_prices().is_err());
}
