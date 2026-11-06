//! Contains the service logic for roles and permissions
use macro_user_id::{email::Email, lowercased::Lowercase, user_id::MacroUserIdStr};

use crate::domain::{
    model::{ProductTier, RoleId, SubscriptionStatus, UserRolesAndPermissionsError},
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
        product_tier: ProductTier,
    ) -> Result<(), UserRolesAndPermissionsError> {
        let user_id = self.user_repository.get_user_id_by_email(&email).await?;

        let sub_role = product_tier.role();

        let roles = [RoleId::ProfessionalSubscriber, sub_role.clone()];

        match subscription_status {
            SubscriptionStatus::Active => {
                self.user_roles_and_permissions_repository
                    .add_roles_to_user(&user_id, &roles)
                    .await?;
                // A plan change (Premium <-> Max) arrives as an activation of the
                // new tier; drop the other tier roles so exactly one tier remains.
                let other_tiers: Vec<RoleId> = ProductTier::ALL
                    .iter()
                    .map(ProductTier::role)
                    .filter(|role| *role != sub_role)
                    .collect();
                self.user_roles_and_permissions_repository
                    .remove_roles_from_user(&user_id, &other_tiers)
                    .await
            }
            SubscriptionStatus::Canceled
            | SubscriptionStatus::IncompleteExpired
            | SubscriptionStatus::PastDue
            | SubscriptionStatus::Paused
            | SubscriptionStatus::Unpaid => {
                self.user_roles_and_permissions_repository
                    .remove_roles_from_user(&user_id, &roles)
                    .await
            }
            _ => Err(UserRolesAndPermissionsError::InvalidSubscriptionStatus(
                subscription_status,
            )),
        }
    }

    async fn dangerous_upsert_roles_for_user(
        &self,
        user_id: &MacroUserIdStr<'_>,
        role_ids: non_empty::NonEmpty<&[RoleId]>,
    ) -> Result<(), UserRolesAndPermissionsError> {
        self.user_roles_and_permissions_repository
            .add_roles_to_user(user_id, role_ids.as_ref())
            .await
    }

    async fn dangerous_remove_roles_from_user(
        &self,
        user_id: &MacroUserIdStr<'_>,
        role_ids: &non_empty::NonEmpty<&[RoleId]>,
    ) -> Result<(), UserRolesAndPermissionsError> {
        self.user_roles_and_permissions_repository
            .remove_roles_from_user(user_id, role_ids.as_ref())
            .await
    }
    #[tracing::instrument(skip(self), err)]
    async fn get_user_permissions(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<std::collections::HashSet<super::model::PermissionId>, UserRolesAndPermissionsError>
    {
        Ok(self
            .user_roles_and_permissions_repository
            .get_user_permissions(user_id)
            .await?
            .into_iter()
            .map(|p| p.id)
            .collect())
    }

    #[tracing::instrument(skip(self), err)]
    async fn get_user_roles(
        &self,
        user_id: &MacroUserIdStr<'_>,
    ) -> Result<std::collections::HashSet<RoleId>, UserRolesAndPermissionsError> {
        self.user_roles_and_permissions_repository
            .get_user_roles(user_id)
            .await
    }
}
