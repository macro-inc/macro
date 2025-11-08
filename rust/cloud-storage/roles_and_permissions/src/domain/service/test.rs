use std::collections::HashSet;
use std::sync::{Arc, Mutex};

use super::UserRolesAndPermissionsServiceImpl;
use crate::domain::model::Permission;

///! Tests for the service logic for roles and permissions
use super::*;

use macro_user_id::email::ReadEmailParts;
use macro_user_id::user_id::MacroUserId;

#[derive(Debug, Clone, Default)]
struct MockUserRepository {}

impl UserRepository for MockUserRepository {
    async fn get_user_id_by_email(
        &self,
        email: &Email<Lowercase<'_>>,
    ) -> Result<MacroUserId<Lowercase<'_>>, UserRolesAndPermissionsError> {
        match email.email_str() {
            "doesnotexist@doesnotexist.com" => Err(UserRolesAndPermissionsError::UserDoesNotExist),
            "user@user.com" => Ok(MacroUserId::parse_from_str("macro|user@user.com")
                .unwrap()
                .lowercase()),
            _ => Err(UserRolesAndPermissionsError::StorageLayerError(
                anyhow::anyhow!("unexpected email"),
            )),
        }
    }
}

#[derive(Debug, Clone, Default)]
struct MockUserRolesAndPermissionsRepository {
    add_roles_to_user_calls: Arc<Mutex<usize>>,
    remove_roles_from_user_calls: Arc<Mutex<usize>>,
}

impl MockUserRolesAndPermissionsRepository {
    pub fn get_add_roles_to_user_calls(&self) -> usize {
        *self.add_roles_to_user_calls.lock().unwrap()
    }

    pub fn get_remove_roles_from_user_calls(&self) -> usize {
        *self.remove_roles_from_user_calls.lock().unwrap()
    }
}

impl UserRolesAndPermissionsRepository for MockUserRolesAndPermissionsRepository {
    async fn get_user_permissions(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
    ) -> Result<HashSet<Permission>, UserRolesAndPermissionsError> {
        Ok(HashSet::new())
    }

    async fn add_roles_to_user(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _role_ids: &[RoleId],
    ) -> Result<(), UserRolesAndPermissionsError> {
        *self.add_roles_to_user_calls.lock().unwrap() += 1;
        Ok(())
    }

    async fn remove_roles_from_user(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _role_ids: &[RoleId],
    ) -> Result<(), UserRolesAndPermissionsError> {
        *self.remove_roles_from_user_calls.lock().unwrap() += 1;
        Ok(())
    }
}

#[tokio::test]
async fn test_user_respository_get_user_id_by_email() -> anyhow::Result<()> {
    let mock_user_repository = MockUserRepository::default();
    let mock_user_roles_and_permissions_repository =
        MockUserRolesAndPermissionsRepository::default();

    let user_service = UserRolesAndPermissionsServiceImpl::new(
        mock_user_roles_and_permissions_repository.clone(),
        mock_user_repository,
    );

    user_service
        .update_user_roles_and_permissions_for_subscription(
            Email::parse_from_str("UsEr@uSeR.com")?.lowercase(),
            SubscriptionStatus::Active,
        )
        .await?;

    assert_eq!(
        mock_user_roles_and_permissions_repository.get_add_roles_to_user_calls(),
        1
    );

    user_service
        .update_user_roles_and_permissions_for_subscription(
            Email::parse_from_str("UsEr@uSeR.com")?.lowercase(),
            SubscriptionStatus::Paused,
        )
        .await?;

    assert_eq!(
        mock_user_roles_and_permissions_repository.get_remove_roles_from_user_calls(),
        1
    );
    Ok(())
}
