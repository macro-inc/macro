use std::collections::HashSet;

use super::mark_agent;
use crate::user::create_user::create_user;

const EMAIL: &str = "agent@signup.test";

#[sqlx::test]
async fn marks_the_account_with_that_email_as_an_agent(pool: sqlx::PgPool) {
    create_user(
        &pool,
        &uuid::Uuid::new_v4().to_string(),
        EMAIL,
        EMAIL,
        false,
        "cus_agent",
        None,
        None,
        HashSet::new(),
        false,
    )
    .await
    .unwrap();

    mark_agent(&pool, EMAIL).await.unwrap();

    let is_agent = sqlx::query_scalar!(r#"SELECT "isAgent" FROM "User" WHERE email = $1"#, EMAIL)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert!(is_agent);
}
