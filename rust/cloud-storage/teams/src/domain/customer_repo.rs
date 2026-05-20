//! Contains the domain logic for teams handling the customers

use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::model::{
    CreateSubscriptionArgs, CustomerError, TeamCheckoutSessionRequest, TeamPlan,
};

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

    /// Create a new subscription for a customer
    fn create_subscription(
        &self,
        args: CreateSubscriptionArgs,
    ) -> impl Future<Output = Result<stripe::SubscriptionId, CustomerError>> + Send;

    /// Cancels a subscription immediately.
    fn cancel_subscription(
        &self,
        subscription_id: &stripe::SubscriptionId,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send;

    /// Update the plan for the team
    fn update_team_plan(
        &self,
        subscription_id: &stripe::SubscriptionId,
        current_team_plan: Option<TeamPlan>,
        team_plan: TeamPlan,
    ) -> impl Future<Output = Result<(), CustomerError>> + Send;

    /// Creates the team plan checkout session
    /// Returns the checkout url
    fn create_team_checkout_session(
        &self,
        team_id: &uuid::Uuid,
        customer_id: stripe::CustomerId,
        req: &TeamCheckoutSessionRequest,
        has_trialed: bool,
    ) -> impl Future<Output = Result<String, CustomerError>> + Send;
}
