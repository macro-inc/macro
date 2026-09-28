//! Contains the domain logic for teams handling the customers

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::model::{CustomerError, SeatPlan};

/// The CustomerRepository defines a set of actions to perform on customer data
///
/// A team subscription carries one seat item per [`SeatPlan`] in use, each
/// with `quantity` = the members on that plan. Implementations add the item
/// when the first seat on a plan appears and drop it when the last one goes.
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

    /// Add `amount` seats on `plan` to a subscription.
    fn increment_seat_count(
        &self,
        subscription_id: &stripe::SubscriptionId,
        plan: SeatPlan,
        amount: u64,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send;

    /// Remove `amount` seats on `plan` from a subscription.
    ///
    /// Implementations must not let the subscription's total seat count
    /// drop below one.
    fn decrement_seat_count(
        &self,
        subscription_id: &stripe::SubscriptionId,
        plan: SeatPlan,
        amount: u64,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send;

    /// Move one seat from `from` to `to`, invoicing the proration at once.
    /// Both items change in a single update so the customer sees one
    /// adjustment.
    fn move_seat(
        &self,
        subscription_id: &stripe::SubscriptionId,
        from: SeatPlan,
        to: SeatPlan,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send;

    /// Cancels a subscription immediately.
    fn cancel_subscription(
        &self,
        subscription_id: &stripe::SubscriptionId,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send;
}
