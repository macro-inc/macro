use super::*;

#[sqlx::test(fixtures(
    path = "../../../fixtures",
    scripts("highest_access_level_for_project")
))]
async fn test_highest_level_is_from_explicit_access_on_project(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    // SCENARIO: Get highest access for 'user-1' on 'p-child'.
    // EXPLICIT ACCESS: view (direct on p-child), owner (inherited from p-grandparent). Max is 'owner'.
    // PUBLIC ACCESS: view (from p-parent), edit (from p-grandparent). Max is 'edit'.
    // EXPECTATION: The overall highest level should be 'owner' from the explicit grant on the grandparent.

    let highest_level = get_highest_access_level_for_project(&pool, "p-child", "user-1").await?;

    assert_eq!(
        highest_level,
        Some(AccessLevel::Owner),
        "Expected highest level to be 'owner' from an inherited UserItemAccess record"
    );

    Ok(())
}

#[sqlx::test(fixtures(
    path = "../../../fixtures",
    scripts("highest_access_level_for_project")
))]
async fn test_highest_level_is_from_public_access_on_project(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    // SCENARIO: Get highest access for 'user-public-access-only' on 'p-child'.
    // This user has no explicit access grants.
    // PUBLIC ACCESS: view (from p-parent), edit (from p-grandparent). Max is 'edit'.
    // EXPECTATION: The overall highest level must be 'edit' from a public SharePermission.

    let highest_level =
        get_highest_access_level_for_project(&pool, "p-child", "user-public-access-only").await?;

    assert_eq!(
        highest_level,
        Some(AccessLevel::Edit),
        "Expected highest level to be 'edit' from a public SharePermission record"
    );

    Ok(())
}

#[sqlx::test(fixtures(
    path = "../../../fixtures",
    scripts("highest_access_level_for_project")
))]
async fn test_user_scoping_is_correct_on_project(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    // SCENARIO: Get highest access for 'user-2' on 'p-child'.
    // EXPLICIT ACCESS: 'user-2' has 'comment' access inherited from p-parent.
    // PUBLIC ACCESS: view (from p-parent), edit (from p-grandparent). Max is 'edit'.
    // EXPECTATION: The overall highest level is 'edit' (from public), which is higher than
    // the user's explicit 'comment' grant.

    let highest_level = get_highest_access_level_for_project(&pool, "p-child", "user-2").await?;

    assert_eq!(
        highest_level,
        Some(AccessLevel::Edit),
        "User-2's highest access should be 'edit' from public, which is higher than their explicit 'comment' grant"
    );

    Ok(())
}

#[sqlx::test(fixtures(
    path = "../../../fixtures",
    scripts("highest_access_level_for_project")
))]
async fn test_private_share_permissions_are_ignored_on_project(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    // SCENARIO: A private 'owner' SharePermission is attached directly to 'p-child'.
    // Get access for a user who would otherwise only have public access.
    // EXPECTATION: The private permission must be ignored.

    let highest_level =
        get_highest_access_level_for_project(&pool, "p-child", "user-public-access-only").await?;

    assert_ne!(
        highest_level,
        Some(AccessLevel::Owner),
        "A private SharePermission should not grant owner access"
    );
    assert_eq!(
        highest_level,
        Some(AccessLevel::Edit),
        "The highest access should still come from the public grandparent permission"
    );

    Ok(())
}

#[sqlx::test(fixtures(
    path = "../../../fixtures",
    scripts("highest_access_level_for_project")
))]
async fn test_no_permissions_returns_none_for_project(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    // SCENARIO: Get access for any user on 'p-isolated'.
    // This project has no permissions of any kind for user-1 and no public access.
    // EXPECTATION: The query should return an empty list, resulting in `None`.

    let highest_level = get_highest_access_level_for_project(&pool, "p-isolated", "user-1").await?;

    assert_eq!(
        highest_level, None,
        "Expected None for a project with no permissions for the user"
    );

    Ok(())
}
