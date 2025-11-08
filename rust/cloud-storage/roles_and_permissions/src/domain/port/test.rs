///! Tests for the port logic for roles and permissions
use super::*;

use macro_user_id::email::ReadEmailParts;

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
struct MockUserRolesAndPermissionsRepository {}

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
        Ok(())
    }

    async fn remove_roles_from_user(
        &self,
        _user_id: &MacroUserId<Lowercase<'_>>,
        _role_ids: &[RoleId],
    ) -> Result<(), UserRolesAndPermissionsError> {
        Ok(())
    }
}

#[tokio::test]
async fn test_get_user_permissions() -> anyhow::Result<()> {
    let user_roles_and_permissions_repository = MockUserRolesAndPermissionsRepository::default();

    let permissions = user_roles_and_permissions_repository
        .get_user_permissions(&MacroUserId::parse_from_str("macro|user@user.com")?.lowercase())
        .await?;

    assert_eq!(permissions.len(), 0);

    Ok(())
}

#[tokio::test]
async fn test_user_respository_get_user_id_by_email() -> anyhow::Result<()> {
    let user_repository = MockUserRepository::default();

    let email = Email::parse_from_str("UsEr@uSeR.com")?.lowercase();

    let user_id = user_repository.get_user_id_by_email(&email).await?;

    assert_eq!(user_id.as_ref(), "macro|user@user.com");

    match user_repository
        .get_user_id_by_email(&Email::parse_from_str("doesnotexist@doesnotexist.com")?.lowercase())
        .await
        .err()
        .unwrap()
    {
        UserRolesAndPermissionsError::UserDoesNotExist => (),
        _ => anyhow::bail!("unexpected error"),
    }

    match user_repository
        .get_user_id_by_email(&Email::parse_from_str("bad@user.com")?.lowercase())
        .await
        .err()
        .unwrap()
    {
        UserRolesAndPermissionsError::StorageLayerError(_) => (),
        _ => anyhow::bail!("unexpected error"),
    }

    Ok(())
}

#[tokio::test]
async fn test_add_roles_to_user() -> anyhow::Result<()> {
    let user_roles_and_permissions_repository = MockUserRolesAndPermissionsRepository::default();

    let roles = vec![RoleId::ProfessionalSubscriber];

    user_roles_and_permissions_repository
        .add_roles_to_user(
            &MacroUserId::parse_from_str("macro|user2@user.com")?.lowercase(),
            &roles,
        )
        .await?;

    Ok(())
}

#[tokio::test]
async fn test_remove_roles_from_user() -> anyhow::Result<()> {
    let user_roles_and_permissions_repository = MockUserRolesAndPermissionsRepository::default();

    let roles = vec![RoleId::ProfessionalSubscriber];

    // Remove role
    user_roles_and_permissions_repository
        .remove_roles_from_user(
            &MacroUserId::parse_from_str("macro|user@user.com")?.lowercase(),
            &roles,
        )
        .await?;

    Ok(())
}
