use sqlx::{Pool, Postgres};

use super::get_user_macro_user_id_and_id_by_email;

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
