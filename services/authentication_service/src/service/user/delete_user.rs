//! Fail-closed ordering for the durable part of account deletion.

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Owning services and persistence needed to remove an account.
pub trait UserDeletionGateway: Send + Sync {
    /// Stop future scheduled work before tearing down sessions.
    fn delete_scheduled_actions(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Delete sessions through the harness so live resources are released first.
    fn delete_agent_sessions(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Delete the teams the user owns and leave the rest through the teams
    /// service, so subscriptions, member roles, and team events are handled
    /// instead of the membership silently cascading away with the profile.
    fn leave_teams(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Delete documents, chats, and projects through their owning service.
    fn delete_items(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Delete the profile's onboarding-flow row. It is keyed by the profile id
    /// with no foreign key to the profile, so it would otherwise outlive it.
    fn delete_onboarding(
        &self,
        user: &MacroUserIdStr<'static>,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Delete the profile only after all owning services have succeeded.
    fn delete_profile(
        &self,
        user: &MacroUserIdStr<'static>,
        account: &Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Delete the account's billing customer once every profile is gone and
    /// before the account row that remembers the customer, so a failure here
    /// is retried instead of orphaning the customer. Deleting the customer
    /// also cancels any subscription it still has, so this must run after the
    /// team subscription has been handled through `leave_teams`.
    fn delete_billing_customer(
        &self,
        account: &Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Delete the account only after all profiles have been cleaned up.
    fn delete_account(&self, account: &Uuid) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Cleanup is retryable: failures preserve the profile/account and never fall
/// through to a cascading delete. Callers must await this and report failure.
pub async fn delete_user_data(
    gateway: &impl UserDeletionGateway,
    account: &Uuid,
    users: &[MacroUserIdStr<'static>],
) -> Result<(), Report> {
    for user in users {
        gateway.delete_scheduled_actions(user).await?;
        gateway.delete_agent_sessions(user).await?;
        gateway.leave_teams(user).await?;
        gateway.delete_items(user).await?;
        gateway.delete_onboarding(user).await?;
        gateway.delete_profile(user, account).await?;
    }
    gateway.delete_billing_customer(account).await?;
    gateway.delete_account(account).await
}
