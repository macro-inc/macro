use super::*;

#[test]
fn transformed_and_tiered_provider_prices_are_not_flat_recurring_amounts() {
    let mut price = stripe::Price {
        currency: Some(stripe::Currency::USD),
        unit_amount: Some(2500),
        billing_scheme: Some(stripe::PriceBillingScheme::PerUnit),
        recurring: Some(stripe::Recurring {
            interval: stripe::RecurringInterval::Month,
            interval_count: 1,
            usage_type: stripe::RecurringUsageType::Licensed,
            ..Default::default()
        }),
        ..Default::default()
    };
    assert_eq!(fixed_price(&price).unwrap().unit_amount, 2500);
    price.transform_quantity = Some(stripe::TransformQuantity {
        divide_by: 5,
        round: stripe::TransformQuantityRound::Up,
    });
    assert!(fixed_price(&price).is_none());
    price.transform_quantity = None;
    price.billing_scheme = Some(stripe::PriceBillingScheme::Tiered);
    assert!(fixed_price(&price).is_none());
    price.billing_scheme = Some(stripe::PriceBillingScheme::PerUnit);
    price.unit_amount_decimal = Some("2500.5".to_owned());
    assert!(fixed_price(&price).is_none());
}
