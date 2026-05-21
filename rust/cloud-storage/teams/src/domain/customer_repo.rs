//! Contains the domain logic for teams handling the customers

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::model::CustomerError;

/// The CustomerRepository defines a set of actions to perform on customer data
pub trait CustomerRepository: Clone + Send + Sync + 'static {
    /// Mark subscription as a team subscription
    fn convert_subscription_to_team(
        &self,
        subscription_id: &stripe::SubscriptionId,
        team_id: &uuid::Uuid,
        team_owner_id: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send;

    /// Get the customers subscription id
    fn get_subscription_id_for_customer(
        &self,
        customer_id: &stripe::CustomerId,
    ) -> impl Future<Output = Result<stripe::SubscriptionId, CustomerError>> + Send;

    /// Increment the seat count on a subscription by the provided amount.
    fn increment_seat_count(
        &self,
        subscription_id: &stripe::SubscriptionId,
        amount: u64,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send;

    /// Decrement the seat count on a subscription by the provided amount.
    ///
    /// Implementations must not let the resulting seat count drop below one.
    fn decrement_seat_count(
        &self,
        subscription_id: &stripe::SubscriptionId,
        amount: u64,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send;

    /// Cancels a subscription immediately.
    fn cancel_subscription(
        &self,
        subscription_id: &stripe::SubscriptionId,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send;
}
