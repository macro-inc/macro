use super::delete_user;

const ACCOUNT: uuid::Uuid = uuid::uuid!("00000000-0000-4000-8000-00000000000e");

#[sqlx::test]
async fn deletes_a_profile_whose_stored_id_has_capitals(pool: sqlx::PgPool) {
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'e', 'E@example.com', 'cus_fixture_e')",
        ACCOUNT,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|E@example.com', 'E@example.com', $1)"#,
        ACCOUNT,
    )
    .execute(&pool)
    .await
    .unwrap();

    let deleted = delete_user(&pool, "macro|e@example.com", &ACCOUNT)
        .await
        .unwrap();

    assert_eq!(deleted.id, "macro|E@example.com");
    let remaining = sqlx::query_scalar!(r#"SELECT count(*) AS "count!" FROM "User""#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(remaining, 0);
}

#[sqlx::test]
async fn keeps_a_profile_of_another_account(pool: sqlx::PgPool) {
    let other_account = uuid::uuid!("00000000-0000-4000-8000-00000000000f");
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, 'e', 'e@example.com', 'cus_fixture_e'), ($2, 'f', 'f@example.com', 'cus_fixture_f')",
        ACCOUNT,
        other_account,
    )
    .execute(&pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ('macro|e@example.com', 'e@example.com', $1)"#,
        other_account,
    )
    .execute(&pool)
    .await
    .unwrap();

    let deleted = delete_user(&pool, "macro|e@example.com", &ACCOUNT).await;

    assert!(matches!(deleted, Err(sqlx::Error::RowNotFound)));
}
