use sqlx::{Pool, Postgres};

use super::{
    get_user_macro_user_id_and_id_by_email, get_user_profile_by_fusionauth_user_id_and_email,
};

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("users")))]
async fn test_get_user_macro_user_id_and_id_by_email_success(pool: Pool<Postgres>) {
    let (macro_user_id, id) = get_user_macro_user_id_and_id_by_email(&pool, "user@user.com")
        .await
        .unwrap();

    assert_eq!(
        macro_user_id,
        uuid::Uuid::parse_str("a1111111-1111-1111-1111-111111111111").unwrap()
    );
    assert_eq!(id, "macro|user@user.com");
}

#[sqlx::test(fixtures(path = "../../../fixtures", scripts("users")))]
async fn test_get_user_macro_user_id_and_id_by_email_not_found(pool: Pool<Postgres>) {
    let result = get_user_macro_user_id_and_id_by_email(&pool, "nonexistent@user.com").await;

    assert!(matches!(result, Err(sqlx::Error::RowNotFound)));
}

#[sqlx::test]
async fn get_user_profile_by_fusionauth_user_id_and_email_matches_email_case_insensitively(
    pool: Pool<Postgres>,
) -> anyhow::Result<()> {
    let fusionauth_user_id = uuid::Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id)
           VALUES ($1, 'macro|support@external.test', 'Support@External.Test', 'cus_test')"#,
        fusionauth_user_id,
    )
    .execute(&pool)
    .await?;

    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id)
           VALUES ('macro|support@external.test', 'Support@External.Test', $1)"#,
        fusionauth_user_id,
    )
    .execute(&pool)
    .await?;

    let profile = get_user_profile_by_fusionauth_user_id_and_email(
        &pool,
        &fusionauth_user_id.to_string(),
        "support@external.test",
    )
    .await?;

    assert_eq!(
        profile,
        Some(("macro|support@external.test".to_string(), None))
    );

    Ok(())
}
