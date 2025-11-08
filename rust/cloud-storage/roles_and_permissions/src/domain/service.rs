//! Contains the service logic for roles and permissions
use macro_user_id::{email::Email, lowercased::Lowercase, user_id::MacroUserId};

use crate::domain::{
    model::{RoleId, SubscriptionStatus, UserRolesAndPermissionsError},
    port::{UserRepository, UserRolesAndPermissionsRepository, UserRolesAndPermissionsService},
};

#[cfg(test)]
mod test;

/// Implementation of the UserRolesAndPermissionsService using a UserRolesAndPermissionsRepository and a UserRepository
#[derive(Debug, Clone)]
pub struct UserRolesAndPermissionsServiceImpl<URPR, UR>
where
    URPR: UserRolesAndPermissionsRepository,
    UR: UserRepository,
{
    /// The underlying user roles and permissions repository
    user_roles_and_permissions_repository: URPR,
    /// The underlying user repository
    user_repository: UR,
}

impl<URPR, UR> UserRolesAndPermissionsServiceImpl<URPR, UR>
where
    URPR: UserRolesAndPermissionsRepository,
    UR: UserRepository,
{
    /// Creates a new UserRolesAndPermissionsService
    pub fn new(user_roles_and_permissions_repository: URPR, user_repository: UR) -> Self {
        Self {
            user_roles_and_permissions_repository,
            user_repository,
        }
    }
}

impl<URPR, UR> UserRolesAndPermissionsService for UserRolesAndPermissionsServiceImpl<URPR, UR>
where
    URPR: UserRolesAndPermissionsRepository,
    UR: UserRepository,
{
    /// Given a user id and a subscription status, update the user's roles accordingly
    async fn update_user_roles_and_permissions_for_subscription(
        &self,
        email: Email<Lowercase<'_>>,
        subscription_status: SubscriptionStatus,
    ) -> Result<(), UserRolesAndPermissionsError> {
        let user_id = self.user_repository.get_user_id_by_email(&email).await?;
        match subscription_status {
            SubscriptionStatus::Active => {
                self.user_roles_and_permissions_repository
                    .add_roles_to_user(&user_id, &[RoleId::ProfessionalSubscriber])
                    .await
            }
            SubscriptionStatus::Canceled
            | SubscriptionStatus::Paused
            | SubscriptionStatus::Unpaid => {
                self.user_roles_and_permissions_repository
                    .remove_roles_from_user(&user_id, &[RoleId::ProfessionalSubscriber])
                    .await
            }
            _ => Err(UserRolesAndPermissionsError::InvalidSubscriptionStatus(
                subscription_status,
            )),
        }
    }

    async fn dangerous_upsert_roles_for_user(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        role_ids: non_empty::NonEmpty<&[RoleId]>,
    ) -> Result<(), UserRolesAndPermissionsError> {
        self.user_roles_and_permissions_repository
            .add_roles_to_user(user_id, role_ids.as_ref())
            .await
    }

    async fn dangerous_remove_roles_from_user(
        &self,
        user_id: &MacroUserId<Lowercase<'_>>,
        role_ids: &non_empty::NonEmpty<&[RoleId]>,
    ) -> Result<(), UserRolesAndPermissionsError> {
        self.user_roles_and_permissions_repository
            .remove_roles_from_user(user_id, role_ids.as_ref())
            .await
    }
}
