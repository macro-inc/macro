//! Tests for the pgpool implementation for roles and permissions

use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::{Pool, Postgres};

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn test_get_user_id_from_email(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let macro_db = MacroDB::new(pool);

    let email = Email::parse_from_str("UsEr@uSeR.com")?.lowercase();

    let user_id = macro_db.get_user_id_from_email(&email).await?;

    assert_eq!(user_id.as_ref(), "macro|user@user.com");

    let result = macro_db
        .get_user_id_from_email(&Email::parse_from_str("bad@user.com")?.lowercase())
        .await
        .err()
        .unwrap();

    assert_eq!(
        result.to_string(),
        "no rows returned by a query that expected to return at least one row".to_string()
    );

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn test_add_roles_to_user(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let macro_db = MacroDB::new(pool);

    let roles = vec!["professional_subscriber".to_string()];

    macro_db
        .add_roles_to_user(
            &MacroUserIdStr::parse_from_str("macro|user2@user.com")?,
            &roles,
        )
        .await?;

    let permissions = macro_db
        .get_user_permissions(&MacroUserIdStr::parse_from_str("macro|user2@user.com")?)
        .await?;

    let permissions = permissions
        .into_iter()
        .map(|p| p.id.to_string())
        .collect::<Vec<String>>();

    assert_eq!(permissions.len(), 3);
    assert!(permissions.contains(&"read:professional_features".to_string()));

    // add role to user that already has role
    macro_db
        .add_roles_to_user(
            &MacroUserIdStr::parse_from_str("macro|user@user.com")?,
            &roles,
        )
        .await?;

    let permissions = macro_db
        .get_user_permissions(&MacroUserIdStr::parse_from_str("macro|user@user.com")?)
        .await?;

    let permissions = permissions
        .into_iter()
        .map(|p| p.id.to_string())
        .collect::<Vec<String>>();

    assert_eq!(permissions.len(), 3);

    // add role to user that doesn't exist
    let err = macro_db
        .add_roles_to_user(
            &MacroUserIdStr::parse_from_str("macro|user3@user.com")?,
            &roles,
        )
        .await
        .err()
        .unwrap();

    assert!(err.to_string().contains("insert or update on table \"RolesOnUsers\" violates foreign key constraint \"RolesOnUsers_userId_fkey\""));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn test_remove_roles_from_user(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let macro_db = MacroDB::new(pool);

    let roles = vec!["professional_subscriber".to_string()];

    // Remove role
    macro_db
        .remove_roles_from_user(
            &MacroUserIdStr::parse_from_str("macro|user@user.com")?,
            &roles,
        )
        .await?;

    let permissions = macro_db
        .get_user_permissions(&MacroUserIdStr::parse_from_str("macro|user@user.com")?)
        .await?;

    let permissions = permissions
        .into_iter()
        .map(|p| p.id.to_string())
        .collect::<Vec<String>>();

    assert_eq!(permissions.len(), 2);
    assert!(permissions.contains(&"read:professional_features".to_string()));

    // Remove role that doesn't exist
    macro_db
        .remove_roles_from_user(
            &MacroUserIdStr::parse_from_str("macro|user2@user.com")?,
            &roles,
        )
        .await?;

    let permissions = macro_db
        .get_user_permissions(&MacroUserIdStr::parse_from_str("macro|user2@user.com")?)
        .await?;

    let permissions = permissions
        .into_iter()
        .map(|p| p.id.to_string())
        .collect::<Vec<String>>();

    assert_eq!(permissions.len(), 2);
    assert!(permissions.contains(&"read:professional_features".to_string()));

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn test_get_user_roles(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let macro_db = MacroDB::new(pool);

    // user@user.com has professional_subscriber and corporate
    let roles = UserRolesAndPermissionsRepository::get_user_roles(
        &macro_db,
        &MacroUserIdStr::parse_from_str("macro|user@user.com")?,
    )
    .await?;

    assert_eq!(roles.len(), 2);
    assert!(roles.contains(&RoleId::ProfessionalSubscriber));
    assert!(roles.contains(&RoleId::Corporate));

    // user2@user.com has only corporate
    let roles = UserRolesAndPermissionsRepository::get_user_roles(
        &macro_db,
        &MacroUserIdStr::parse_from_str("macro|user2@user.com")?,
    )
    .await?;

    assert_eq!(roles.len(), 1);
    assert!(roles.contains(&RoleId::Corporate));

    // user that doesn't exist returns empty set
    let roles = UserRolesAndPermissionsRepository::get_user_roles(
        &macro_db,
        &MacroUserIdStr::parse_from_str("macro|user3@user.com")?,
    )
    .await?;

    assert!(roles.is_empty());

    Ok(())
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("users"))
)]
async fn test_get_user_roles_after_add_and_remove(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let macro_db = MacroDB::new(pool);

    // Add a role and verify it shows up
    macro_db
        .add_roles_to_user(
            &MacroUserIdStr::parse_from_str("macro|user2@user.com")?,
            &["self_serve".to_string()],
        )
        .await?;

    let roles = UserRolesAndPermissionsRepository::get_user_roles(
        &macro_db,
        &MacroUserIdStr::parse_from_str("macro|user2@user.com")?,
    )
    .await?;

    assert_eq!(roles.len(), 2);
    assert!(roles.contains(&RoleId::Corporate));
    assert!(roles.contains(&RoleId::SelfServe));

    // Remove the role and verify it's gone
    macro_db
        .remove_roles_from_user(
            &MacroUserIdStr::parse_from_str("macro|user2@user.com")?,
            &["self_serve".to_string()],
        )
        .await?;

    let roles = UserRolesAndPermissionsRepository::get_user_roles(
        &macro_db,
        &MacroUserIdStr::parse_from_str("macro|user2@user.com")?,
    )
    .await?;

    assert_eq!(roles.len(), 1);
    assert!(roles.contains(&RoleId::Corporate));

    Ok(())
}
