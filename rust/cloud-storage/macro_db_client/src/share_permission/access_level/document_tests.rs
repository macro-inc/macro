use super::*;

#[sqlx::test(fixtures(
    path = "../../../fixtures",
    scripts("highest_access_level_for_document")
))]
async fn test_highest_level_is_from_explicit_access(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    // SCENARIO: Get highest access for 'user-1' on 'd-child'.
    // EXPLICIT ACCESS: view (direct), edit (parent), owner (grandparent). Max is 'owner'.
    // PUBLIC ACCESS: view (parent), edit (grandparent). Max is 'edit'.
    // EXPECTATION: The overall highest level should be 'owner' from the explicit grant.

    let highest_level = get_highest_access_level_for_document(&pool, "d-child", "user-1").await?;

    assert_eq!(
        highest_level,
        Some(AccessLevel::Owner),
        "Expected highest level to be 'owner' from an explicit UserItemAccess record"
    );

    // highest public access is edit via grandparent

    let highest_level =
        get_highest_access_level_for_document(&pool, "d-child", "user-public-access-only").await?;

    assert_eq!(
        highest_level,
        Some(AccessLevel::Edit),
        "Expected highest level to be 'edit' from a public SharePermission record"
    );

    Ok(())
}

#[sqlx::test(fixtures(
    path = "../../../fixtures",
    scripts("highest_access_level_for_document")
))]
async fn test_user_scoping_is_correct(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
    // SCENARIO: Get highest access for 'user-2' on 'd-child'.
    // EXPLICIT ACCESS: 'user-2' only has 'view' access.
    // PUBLIC ACCESS: view (parent), edit (grandparent). Max is 'edit'.
    // EXPECTATION: The overall highest level is 'edit' (from public), not 'owner' (from user-1's grant).

    let highest_level = get_highest_access_level_for_document(&pool, "d-child", "user-2").await?;

    assert_eq!(
        highest_level,
        Some(AccessLevel::Edit),
        "User-2's highest access should be 'edit' from public, not 'owner' from user-1's explicit grant"
    );

    Ok(())
}

#[sqlx::test(fixtures(
    path = "../../../fixtures",
    scripts("highest_access_level_for_document")
))]
async fn test_simple_uia_case(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
    // SCENARIO: User has edit UIA access on private document
    // EXPECTATION: The user should have edit access to document

    let highest_level =
        get_highest_access_level_for_document(&pool, "d-standalone", "user-3").await?;

    assert_eq!(
        highest_level,
        Some(AccessLevel::Edit),
        "User-3's highest access should be 'edit' from explicit grant"
    );

    Ok(())
}

#[sqlx::test(fixtures(
    path = "../../../fixtures",
    scripts("highest_access_level_for_document")
))]
async fn test_no_permissions_returns_none(pool: sqlx::Pool<sqlx::Postgres>) -> anyhow::Result<()> {
    // SCENARIO: Get access for any user on 'd-private'.
    // This document has no project, no UserItemAccess, and no SharePermission records.
    // EXPECTATION: The query should return an empty list, resulting in `None`.

    let highest_level = get_highest_access_level_for_document(&pool, "d-private", "user-1").await?;

    assert_eq!(
        highest_level, None,
        "Expected None for a document with no permissions"
    );

    Ok(())
}

// --- Email thread inheritance tests ---

#[sqlx::test(fixtures(
    path = "../../../fixtures",
    scripts("document_access_via_email_thread")
))]
async fn test_thread_access_grants_document_access(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    // SCENARIO: user-thread-access has 'view' on the email thread but no direct document access.
    // The document is an email attachment of that thread.
    // EXPECTATION: The user should get 'view' access to the document via thread inheritance.

    let highest_level =
        get_highest_access_level_for_document(&pool, "d-attachment", "user-thread-access").await?;

    assert_eq!(
        highest_level,
        Some(AccessLevel::View),
        "User should get 'view' access to the attachment document via thread access"
    );

    Ok(())
}

#[sqlx::test(fixtures(
    path = "../../../fixtures",
    scripts("document_access_via_email_thread")
))]
async fn test_no_thread_access_means_no_document_access(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    // SCENARIO: user-no-access has no access to the thread or the document.
    // EXPECTATION: Should return None.

    let highest_level =
        get_highest_access_level_for_document(&pool, "d-attachment", "user-no-access").await?;

    assert_eq!(
        highest_level, None,
        "User with no thread access should have no access to the attachment document"
    );

    Ok(())
}

#[sqlx::test(fixtures(
    path = "../../../fixtures",
    scripts("document_access_via_email_thread")
))]
async fn test_thread_access_combined_with_direct_access(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    // SCENARIO: user-both-access has direct 'view' on the document AND 'edit' on the thread.
    // EXPECTATION: The highest level should be 'edit' from the thread, not 'view' from direct.

    let highest_level = get_highest_access_level_for_document(
        &pool,
        "d-attachment-with-direct",
        "user-both-access",
    )
    .await?;

    assert_eq!(
        highest_level,
        Some(AccessLevel::Edit),
        "Thread access ('edit') should be higher than direct document access ('view')"
    );

    Ok(())
}

#[sqlx::test(fixtures(
    path = "../../../fixtures",
    scripts("document_access_via_email_thread")
))]
async fn test_non_attachment_document_unaffected(
    pool: sqlx::Pool<sqlx::Postgres>,
) -> anyhow::Result<()> {
    // SCENARIO: d-not-attachment is a regular document not linked to any email.
    // No user has any permissions on it.
    // EXPECTATION: Thread inheritance should not apply; result should be None.

    let highest_level =
        get_highest_access_level_for_document(&pool, "d-not-attachment", "user-thread-access")
            .await?;

    assert_eq!(
        highest_level, None,
        "Non-attachment documents should not get access from thread permissions"
    );

    Ok(())
}
