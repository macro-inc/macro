use macro_db_migrator::MACRO_DB_MIGRATIONS;
use uuid::Uuid;

use super::*;

async fn account(pool: &PgPool, email: &str, is_verified: bool) -> Uuid {
    let id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        "INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $3, $4)",
        id,
        id.to_string(),
        email,
        format!("cus_{id}"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO macro_user_email_verification (macro_user_id, email, is_verified) VALUES ($1, $2, $3)",
        id,
        email,
        is_verified,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

async fn is_verified(pool: &PgPool, email: &str) -> bool {
    sqlx::query_scalar!(
        "SELECT is_verified FROM macro_user_email_verification WHERE email = $1",
        email
    )
    .fetch_one(pool)
    .await
    .unwrap()
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_the_first_proof_claims(pool: PgPool) {
    let id = account(&pool, "new@team.example", false).await;

    let first = claim_first_proof(&pool, &id.to_string(), "new@team.example").await;
    let second = claim_first_proof(&pool, &id.to_string(), "new@team.example").await;

    assert!(first.unwrap());
    assert!(!second.unwrap());
    assert!(is_verified(&pool, "new@team.example").await);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_address_verified_at_signup_claims_nothing(pool: PgPool) {
    let id = account(&pool, "sso@team.example", true).await;

    let claimed = claim_first_proof(&pool, &id.to_string(), "sso@team.example").await;

    assert!(!claimed.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn another_accounts_address_claims_nothing(pool: PgPool) {
    account(&pool, "new@team.example", false).await;
    let other = account(&pool, "other@team.example", false).await;

    let claimed = claim_first_proof(&pool, &other.to_string(), "new@team.example").await;
    let missing = claim_first_proof(&pool, &other.to_string(), "missing@team.example").await;

    assert!(!claimed.unwrap());
    assert!(!missing.unwrap());
    assert!(!is_verified(&pool, "new@team.example").await);
}
