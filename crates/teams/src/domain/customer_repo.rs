//! Contains the domain logic for teams handling the customers

use std::collections::HashMap;

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::model::{CustomerError, ScheduledSeatPlan, SeatPlan};

/// The CustomerRepository defines a set of actions to perform on customer data
///
/// A team subscription carries one seat item per [`SeatPlan`] in use, each
/// with `quantity` = the members on that plan. Implementations add the item
/// when the first seat on a plan appears and drop it when the last one goes.
pub trait CustomerRepository: Clone + Send + Sync + 'static {
    /// Keeps one team's billing reconciliation and seat changes serialized across replicas.
    /// Dropping the guard releases the lock, including on errors or cancellation.
    type TeamBillingGuard: Send;

    /// Acquire before reading or changing effective membership plans or renewal facts.
    fn lock_team_billing(
        &self,
        team_id: &uuid::Uuid,
    ) -> impl Future<Output = Result<Self::TeamBillingGuard, CustomerError>> + Send;

    /// Read only this user's plan from an attached, Macro-owned schedule.
    fn scheduled_seat_plan(
        &self,
        subscription: &stripe::SubscriptionId,
        schedule: &stripe::SubscriptionScheduleId,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<ScheduledSeatPlan>, CustomerError>> + Send;

    /// Read this member's pending change from the subscription's attached schedule.
    /// Already applied phases do not count as pending changes.
    fn pending_seat_plan(
        &self,
        subscription: &stripe::SubscriptionId,
        user: &MacroUserIdStr<'_>,
    ) -> impl Future<Output = Result<Option<ScheduledSeatPlan>, CustomerError>> + Send;

    /// Read all pending seat changes from the attached, Macro-owned schedule.
    /// Already applied phases do not count as pending changes.
    fn pending_seat_plans(
        &self,
        subscription: &stripe::SubscriptionId,
    ) -> impl Future<Output = Result<HashMap<String, ScheduledSeatPlan>, CustomerError>> + Send;

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

    /// Schedule a seat downgrade at renewal, or cancel that seat's pending change.
    /// Current prices and entitlements remain unchanged.
    fn schedule_seat_plan(
        &self,
        subscription: &stripe::SubscriptionId,
        user: &MacroUserIdStr<'_>,
        plan: Option<SeatPlan>,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send;

    /// Cancel any pending downgrade and replace the personal price atomically with
    /// respect to other provider mutations, invoicing proration immediately.
    fn upgrade_personal_plan(
        &self,
        subscription: &stripe::SubscriptionId,
        plan: SeatPlan,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send;

    /// Member plans whose scheduled phase has actually started at the provider.
    fn renewed_seat_plans(
        &self,
        subscription: &stripe::SubscriptionId,
    ) -> impl Future<Output = Result<Vec<(String, SeatPlan)>, CustomerError>> + Send;

    /// Acknowledge successfully applied renewal changes; retries remain safe.
    fn acknowledge_renewed_seat_plans(
        &self,
        subscription: &stripe::SubscriptionId,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send;

    /// Cancels a subscription immediately. A subscription that is already
    /// cancelled or no longer exists counts as cancelled.
    fn cancel_subscription(
        &self,
        subscription_id: &stripe::SubscriptionId,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send;
}
