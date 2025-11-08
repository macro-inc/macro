//! Contains the domain logic for teams handling the customers

use crate::domain::model::{CreateSubscriptionArgs, CustomerError};

/// The CustomerRepository defines a set of actions to perform on customer data
pub trait CustomerRepository: Clone + Send + Sync + 'static {
    /// Create a new subscription for a customer
    fn create_subscription(
        &self,
        args: CreateSubscriptionArgs,
    ) -> impl Future<Output = Result<stripe::SubscriptionId, CustomerError>> + Send;

    /// Increases the quantity of a subscription
    fn increase_subscription_quantity(
        &self,
        subscription_id: &stripe::SubscriptionId,
        increase_amount: u64,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send;

    /// Decrement the quantity of a subscription
    fn decrease_subscription_quantity(
        &self,
        subscription_id: &stripe::SubscriptionId,
        decrease_amount: u64,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send;

    /// Cancels a subscription immediately.
    fn cancel_subscription(
        &self,
        subscription_id: &stripe::SubscriptionId,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send;
}
