//! Contains the port logic for roles and permissions

use std::collections::HashSet;

use macro_user_id::{email::Email, lowercased::Lowercase, user_id::MacroUserId};

use crate::domain::model::{Permission, RoleId, SubscriptionStatus, UserRolesAndPermissionsError};

#[cfg(test)]
mod test;

/// The UserRepository defines a set of actions to perform on the users
pub trait UserRepository: Clone + Send + Sync + 'static {
    /// Gets the user id for a given email
    fn get_user_id_by_email(
        &self,
        email: &Email<Lowercase<'_>>,
    ) -> impl Future<Output = Result<MacroUserId<Lowercase<'_>>, UserRolesAndPermissionsError>> + Send;
}

/// The UserRolesAndPermissionsRepository defines a set of actions to perform on the users roles and permissions
pub trait UserRolesAndPermissionsRepository: Clone + Send + Sync + 'static {
    /// Gets the permissiosn for a MacroUserID
    fn get_user_permissions(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<HashSet<Permission>, UserRolesAndPermissionsError>> + Send;
    /// Adds roles with the provided ids to a user
    fn add_roles_to_user(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        role_ids: &[RoleId],
    ) -> impl Future<Output = Result<(), UserRolesAndPermissionsError>> + Send;
    /// Removes roles from a user
    fn remove_roles_from_user(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        role_ids: &[RoleId],
    ) -> impl Future<Output = Result<(), UserRolesAndPermissionsError>> + Send;
}

/// The UserRolesAndPermissionsService defines a set of actions to perform on the users for their roles and permissions
pub trait UserRolesAndPermissionsService: Clone + Send + Sync + 'static {
    /// Given a user id and a subscription status, update the user's roles accordingly
    fn update_user_roles_and_permissions_for_subscription(
        &self,
        email: Email<Lowercase<'_>>,
        subscription_status: SubscriptionStatus,
    ) -> impl Future<Output = Result<(), UserRolesAndPermissionsError>> + Send;

    /// Given a user id, upserts the roles for the user
    fn dangerous_upsert_roles_for_user(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        role_ids: non_empty::NonEmpty<&[RoleId]>,
    ) -> impl Future<Output = Result<(), UserRolesAndPermissionsError>> + Send;

    /// Removes roles from a user
    fn dangerous_remove_roles_from_user(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        role_ids: &non_empty::NonEmpty<&[RoleId]>,
    ) -> impl Future<Output = Result<(), UserRolesAndPermissionsError>> + Send;
}
