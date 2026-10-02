//! Fail-closed ordering for the durable part of account deletion.

use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Owning services and persistence needed to remove an account.
pub trait UserDeletionGateway: Send + Sync {
    /// Every profile that belongs to the account.
    fn list_profiles(
        &self,
        account: &Uuid,
    ) -> impl Future<Output = Result<Vec<MacroUserIdStr<'static>>, Report>> + Send;
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
    /// Delete the profile only after all owning services have succeeded.
    fn delete_profile(
        &self,
        user: &MacroUserIdStr<'static>,
        account: &Uuid,
    ) -> impl Future<Output = Result<(), Report>> + Send;
    /// Delete the account only after all profiles have been cleaned up.
    fn delete_account(&self, account: &Uuid) -> impl Future<Output = Result<(), Report>> + Send;
    /// Delete the sign-in identity. Its deletion webhook finishes the cleanup
    /// with [`delete_user_data`].
    fn delete_identity(&self, account: &Uuid) -> impl Future<Output = Result<(), Report>> + Send;
}

/// Deletes an account at its owner's request.
///
/// Deleting the sign-in identity cannot be undone or retried by the owner, and
/// FusionAuth redelivers a failed delete webhook only briefly, if at all.
/// Cleanup that fails after it strands profiles pointing at an identity that no
/// longer exists, so everything fallible runs first and a failure leaves an
/// account the owner can still sign in to and delete again.
pub async fn delete_requested_account(
    gateway: &impl UserDeletionGateway,
    account: &Uuid,
) -> Result<(), Report> {
    for user in &gateway.list_profiles(account).await? {
        release_owned_resources(gateway, user).await?;
    }
    gateway.delete_identity(account).await
}

/// Cleanup is retryable: failures preserve the profile/account and never fall
/// through to a cascading delete. Callers must await this and report failure.
pub async fn delete_user_data(
    gateway: &impl UserDeletionGateway,
    account: &Uuid,
    users: &[MacroUserIdStr<'static>],
) -> Result<(), Report> {
    for user in users {
        release_owned_resources(gateway, user).await?;
        gateway.delete_profile(user, account).await?;
    }
    gateway.delete_account(account).await
}

async fn release_owned_resources(
    gateway: &impl UserDeletionGateway,
    user: &MacroUserIdStr<'static>,
) -> Result<(), Report> {
    gateway.delete_scheduled_actions(user).await?;
    gateway.delete_agent_sessions(user).await?;
    gateway.leave_teams(user).await?;
    gateway.delete_items(user).await
}
