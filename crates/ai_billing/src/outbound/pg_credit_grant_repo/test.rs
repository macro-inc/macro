use super::*;
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_uuid::Uuid;
use std::num::NonZeroU32;

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn grant_adds_to_balance_once_per_id(pool: PgPool) {
    let repo = PgCreditGrantRepo::new(pool);
    let payer = MacroUserIdStr::try_from("macro|payer@example.com".to_string()).unwrap();
    let grant = CreditGrant {
        id: Uuid::parse_str("019a0f6e-0000-7000-8000-000000000001").unwrap(),
        amount_cents: NonZeroU32::new(1500).unwrap(),
        note: "manual grant: usage refund".to_string(),
    };

    let first = repo.record_credit_grant(&payer, &grant).await.unwrap();
    let retry = repo.record_credit_grant(&payer, &grant).await.unwrap();

    assert!(first);
    assert!(!retry);
    assert_eq!(repo.credit_grant_balance_cents(&payer).await.unwrap(), 1500);
}
