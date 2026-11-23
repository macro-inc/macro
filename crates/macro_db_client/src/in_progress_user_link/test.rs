use super::*;
use sqlx::{Pool, Postgres};

async fn insert_macro_user(pool: &Pool<Postgres>, id: Uuid) -> anyhow::Result<()> {
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, 'tester', 'tester@example.com', 'cus_test')
        "#,
        &id
    )
    .execute(pool)
    .await?;
    Ok(())
}

#[sqlx::test]
async fn set_linked_email_then_get(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let macro_user_id = macro_uuid::generate_uuid_v7();
    insert_macro_user(&pool, macro_user_id).await?;

    let link_id = create_in_progress_user_link(&pool, &macro_user_id.to_string()).await?;

    let pre = get_in_progress_user_link(&pool, &link_id).await?;
    assert_eq!(pre.macro_user_id, macro_user_id);
    assert!(pre.linked_email.is_none());
    assert!(pre.requested_google_scopes.is_empty());
    assert!(pre.granted_google_scopes.is_empty());

    set_linked_email(&pool, &link_id, "linked@example.com").await?;

    let post = get_in_progress_user_link(&pool, &link_id).await?;
    assert_eq!(post.macro_user_id, macro_user_id);
    assert_eq!(post.linked_email.as_deref(), Some("linked@example.com"));

    Ok(())
}

#[sqlx::test]
async fn google_link_records_requested_and_granted_scopes(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let macro_user_id = macro_uuid::generate_uuid_v7();
    insert_macro_user(&pool, macro_user_id).await?;
    let requested = vec!["gmail".to_string(), "calendar".to_string()];
    let granted = vec!["gmail".to_string()];

    let link_id =
        create_in_progress_google_link(&pool, &macro_user_id.to_string(), &requested).await?;
    set_linked_google_grant(&pool, &link_id, "linked@example.com", &granted, false).await?;

    let link = get_in_progress_user_link(&pool, &link_id).await?;
    assert_eq!(link.requested_google_scopes, requested);
    assert_eq!(link.granted_google_scopes, granted);
    assert_eq!(link.linked_email.as_deref(), Some("linked@example.com"));

    Ok(())
}

#[sqlx::test]
async fn count_excludes_expired_links(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let macro_user_id = macro_uuid::generate_uuid_v7();
    insert_macro_user(&pool, macro_user_id).await?;

    // A link created just over 24 hours ago should no longer count toward the cap.
    let expired_link_id = create_in_progress_user_link(&pool, &macro_user_id.to_string()).await?;
    let stale_created_at = chrono::Utc::now().naive_utc() - chrono::Duration::hours(25);
    sqlx::query!(
        r#"
            UPDATE in_progress_user_link
            SET created_at = $1
            WHERE id = $2
        "#,
        stale_created_at,
        expired_link_id
    )
    .execute(&pool)
    .await?;

    // A freshly created link should still count.
    create_in_progress_user_link(&pool, &macro_user_id.to_string()).await?;

    let count =
        count_existing_in_progress_user_links_for_user(&pool, &macro_user_id.to_string()).await?;
    assert_eq!(
        count, 1,
        "in-progress links older than 24 hours should not count toward the cap"
    );

    Ok(())
}

#[sqlx::test]
async fn delete_clears_row(pool: Pool<Postgres>) -> anyhow::Result<()> {
    let macro_user_id = macro_uuid::generate_uuid_v7();
    insert_macro_user(&pool, macro_user_id).await?;

    let link_id = create_in_progress_user_link(&pool, &macro_user_id.to_string()).await?;
    set_linked_email(&pool, &link_id, "linked@example.com").await?;
    delete_in_progress_user_link(&pool, &link_id).await?;

    let err = get_in_progress_user_link(&pool, &link_id).await;
    assert!(err.is_err(), "row should be gone after delete");

    Ok(())
}

#[sqlx::test]
async fn a_refused_attempt_waits_for_its_identity_release_only_if_it_linked_one(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let owner = macro_uuid::generate_uuid_v7();
    insert_macro_user(&pool, owner).await?;
    let granted = vec!["gmail".to_string()];
    let linked = create_in_progress_google_link(&pool, &owner.to_string(), &granted).await?;
    set_linked_google_grant(&pool, &linked, "new@example.com", &granted, true).await?;
    let existing = create_in_progress_google_link(&pool, &owner.to_string(), &granted).await?;
    set_linked_google_grant(&pool, &existing, "old@example.com", &granted, false).await?;
    let pending = create_in_progress_google_link(&pool, &owner.to_string(), &granted).await?;
    set_linked_google_grant(&pool, &pending, "pending@example.com", &granted, true).await?;

    discard_owned_in_progress_user_link(&pool, linked, &owner.to_string()).await?;
    discard_owned_in_progress_user_link(&pool, existing, &owner.to_string()).await?;
    discard_owned_in_progress_user_link(&pool, pending, &Uuid::now_v7().to_string()).await?;

    let due = identity_link_attempts_to_release(&pool, 100).await?;
    assert_eq!(
        due.iter()
            .map(|attempt| (attempt.id, attempt.linked_email.as_str()))
            .collect::<Vec<_>>(),
        [(linked, "new@example.com")],
        "an attempt that linked nothing is deleted, another owner's is untouched"
    );
    assert_eq!(due[0].fusionauth_user_id, owner);
    assert!(get_in_progress_user_link(&pool, &existing).await.is_err());
    assert_eq!(
        count_existing_in_progress_user_links_for_user(&pool, &owner.to_string()).await?,
        1,
        "a refused attempt no longer counts toward the cap"
    );

    Ok(())
}

#[sqlx::test]
async fn a_lapsed_attempt_that_linked_an_identity_is_left_for_its_release(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let owner = macro_uuid::generate_uuid_v7();
    insert_macro_user(&pool, owner).await?;
    let granted = vec!["gmail".to_string()];
    let linked = create_in_progress_google_link(&pool, &owner.to_string(), &granted).await?;
    set_linked_google_grant(&pool, &linked, "new@example.com", &granted, true).await?;
    let plain = create_in_progress_google_link(&pool, &owner.to_string(), &granted).await?;
    set_linked_google_grant(&pool, &plain, "old@example.com", &granted, false).await?;
    let lapsed = chrono::Utc::now().naive_utc() - chrono::Duration::hours(25);
    sqlx::query!(
        "UPDATE in_progress_user_link SET created_at = $1 WHERE id = ANY($2)",
        lapsed,
        &[linked, plain]
    )
    .execute(&pool)
    .await?;

    assert_eq!(
        identity_link_attempts_to_release(&pool, 100)
            .await?
            .iter()
            .map(|attempt| attempt.id)
            .collect::<Vec<_>>(),
        [linked]
    );
    delete_day_old_in_progress_user_links(&pool).await?;
    assert!(get_in_progress_user_link(&pool, &plain).await.is_err());
    assert!(
        get_in_progress_user_link(&pool, &linked).await.is_ok(),
        "the day-old cleanup leaves it to the identity release"
    );

    Ok(())
}
