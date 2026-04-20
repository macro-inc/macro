use super::*;

#[sqlx::test(fixtures(
    path = "../../../fixtures",
    scripts("highest_access_level_for_document")
))]
async fn test_highest_level_is_from_explicit_access(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    // SCENARIO: Get highest access for 'user-1' on d-child (dddddddd-dddd-dddd-dddd-000000000001).
    // EXPLICIT ACCESS: view (direct), edit (parent), owner (grandparent). Max is 'owner'.
    // PUBLIC ACCESS: view (parent), edit (grandparent). Max is 'edit'.
    // EXPECTATION: The overall highest level should be 'owner' from the explicit grant.

    let highest_level = get_highest_access_level_for_document(
        &pool,
        "dddddddd-dddd-dddd-dddd-000000000001",
        "user-1",
    )
    .await?;

    assert_eq!(
        highest_level,
        Some(AccessLevel::Owner),
        "Expected highest level to be 'owner' from an explicit entity_access record"
    );

    // highest public access is edit via grandparent

    let highest_level = get_highest_access_level_for_document(
        &pool,
        "dddddddd-dddd-dddd-dddd-000000000001",
        "user-public-access-only",
    )
    .await?;

    assert_eq!(
        highest_level,
        Some(AccessLevel::Edit),
        "Expected highest level to be 'edit' from a public SharePermission record"
    );

    Ok(())
}
