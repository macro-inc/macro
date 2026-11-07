//! Subscription item quantities and provider error/interval mapping.

use super::*;

/// A declined error-if-incomplete update leaves the subscription unchanged.
pub(super) fn update_error(error: stripe::StripeError, error_if_incomplete: bool) -> CustomerError {
    match &error {
        stripe::StripeError::Stripe(request)
            if error_if_incomplete
                && (request.http_status == 402
                    || request.error_type == stripe::ErrorType::Card) =>
        {
            CustomerError::PaymentFailed
        }
        _ => storage(error),
    }
}

pub(super) fn cadence(interval: stripe::RecurringInterval) -> BillingCadence {
    match interval {
        stripe::RecurringInterval::Day => BillingCadence::Day,
        stripe::RecurringInterval::Week => BillingCadence::Week,
        stripe::RecurringInterval::Month => BillingCadence::Month,
        stripe::RecurringInterval::Year => BillingCadence::Year,
    }
}

/// Combine deltas by price, deleting an existing item when its quantity reaches zero.
pub(super) fn item_quantity_updates(
    subscription: &stripe::Subscription,
    changes: &[ItemQuantityChange],
) -> Result<Vec<UpdateSubscriptionItems>, CustomerError> {
    let mut deltas: Vec<(&str, i64)> = Vec::new();
    for change in changes {
        match deltas
            .iter_mut()
            .find(|(price, _)| *price == change.price_id.as_str())
        {
            Some((_, delta)) => {
                *delta = delta
                    .checked_add(change.delta)
                    .ok_or(SubscriptionDataError::QuantityOverflow)?
            }
            None => deltas.push((change.price_id.as_str(), change.delta)),
        }
    }
    let mut updates = Vec::new();
    for (price, delta) in deltas {
        if delta == 0 {
            continue;
        }
        let existing = subscription.items.data.iter().find(|item| {
            item.price
                .as_ref()
                .is_some_and(|candidate| candidate.id.as_str() == price)
        });
        let current = existing.map_or(0, |item| item.quantity.unwrap_or(1));
        let quantity = i64::try_from(current)
            .ok()
            .and_then(|current| current.checked_add(delta))
            .ok_or(SubscriptionDataError::QuantityOverflow)?;
        let quantity =
            u64::try_from(quantity).map_err(|_| CustomerError::QuantityBelowZero(price.into()))?;
        updates.push(match existing {
            Some(item) if quantity == 0 => UpdateSubscriptionItems {
                id: Some(item.id.to_string()),
                deleted: Some(true),
                ..Default::default()
            },
            Some(item) => UpdateSubscriptionItems {
                id: Some(item.id.to_string()),
                quantity: Some(quantity),
                ..Default::default()
            },
            None => UpdateSubscriptionItems {
                price: Some(price.to_string()),
                quantity: Some(quantity),
                ..Default::default()
            },
        });
    }
    Ok(updates)
}
