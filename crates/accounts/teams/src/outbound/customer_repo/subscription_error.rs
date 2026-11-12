//! Typed failures for subscription item and pricing data.
use crate::domain::model::CustomerError;

#[derive(Debug, thiserror::Error)]
pub(super) enum SubscriptionDataError {
    #[error("subscription has no recurring item")]
    MissingRecurringItem,
    #[error("invalid subscription period end")]
    InvalidPeriodEnd,
    #[error("price has no unit amount")]
    MissingUnitAmount,
    #[error("price has no currency")]
    MissingCurrency,
    #[error("item quantity overflow")]
    QuantityOverflow,
    #[error("{0}")]
    Internal(rootcause::Report),
}

impl From<SubscriptionDataError> for CustomerError {
    fn from(error: SubscriptionDataError) -> Self {
        Self::StorageLayerError(error.into())
    }
}
