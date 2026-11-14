///! Tests for the port logic for roles and permissions
use super::*;

#[derive(Debug, Clone, Default)]
struct MockUserRolesAndPermissionsRepository {}

impl UserRolesAndPermissionsRepository for MockUserRolesAndPermissionsRepository {
    async fn get_user_roles(
        &self,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<HashSet<RoleId>, UserRolesAndPermissionsError> {
        Ok(HashSet::from([RoleId::SelfServe]))
    }

    async fn get_user_permissions(
        &self,
        _user_id: &MacroUserIdStr<'_>,
    ) -> Result<HashSet<Permission>, UserRolesAndPermissionsError> {
        Ok(HashSet::new())
    }

    async fn add_roles_to_user(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _role_ids: &[RoleId],
    ) -> Result<(), UserRolesAndPermissionsError> {
        Ok(())
    }

    async fn remove_roles_from_user(
        &self,
        _user_id: &MacroUserIdStr<'_>,
        _role_ids: &[RoleId],
    ) -> Result<(), UserRolesAndPermissionsError> {
        Ok(())
    }
}

#[tokio::test]
async fn test_get_user_permissions() -> anyhow::Result<()> {
    let user_roles_and_permissions_repository = MockUserRolesAndPermissionsRepository::default();

    let permissions = user_roles_and_permissions_repository
        .get_user_permissions(&MacroUserIdStr::parse_from_str("macro|user@user.com")?)
        .await?;

    assert_eq!(permissions.len(), 0);

    Ok(())
}

#[tokio::test]
async fn test_add_roles_to_user() -> anyhow::Result<()> {
    let user_roles_and_permissions_repository = MockUserRolesAndPermissionsRepository::default();

    let roles = vec![RoleId::ProfessionalSubscriber];

    user_roles_and_permissions_repository
        .add_roles_to_user(
            &MacroUserIdStr::parse_from_str("macro|user2@user.com")?,
            &roles,
        )
        .await?;

    Ok(())
}

#[tokio::test]
async fn test_get_user_roles() -> anyhow::Result<()> {
    let user_roles_and_permissions_repository = MockUserRolesAndPermissionsRepository::default();

    let roles = user_roles_and_permissions_repository
        .get_user_roles(&MacroUserIdStr::parse_from_str("macro|user@user.com")?)
        .await?;

    assert_eq!(roles.len(), 1);
    assert!(roles.contains(&RoleId::SelfServe));

    Ok(())
}

#[tokio::test]
async fn test_remove_roles_from_user() -> anyhow::Result<()> {
    let user_roles_and_permissions_repository = MockUserRolesAndPermissionsRepository::default();

    let roles = vec![RoleId::ProfessionalSubscriber];

    // Remove role
    user_roles_and_permissions_repository
        .remove_roles_from_user(
            &MacroUserIdStr::parse_from_str("macro|user@user.com")?,
            &roles,
        )
        .await?;

    Ok(())
}
