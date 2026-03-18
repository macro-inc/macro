use macro_db_migrator::MACRO_DB_MIGRATIONS;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use macro_uuid::ShortUuidConverter;
use sqlx::{Pool, Postgres};

use crate::domain::models::ReferralCode;
use crate::domain::ports::ReferralRepo;
use crate::outbound::pg_referral_repo::PgReferralRepo;

const REFERRER_UUID: &str = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
const REFERRER_STRIPE_ID: &str = "cus_referrer";

fn referrer_referral_code() -> ReferralCode {
    let converter = ShortUuidConverter::default();
    let uuid = uuid::Uuid::parse_str(REFERRER_UUID).unwrap();
    ReferralCode(converter.from_uuid(&uuid))
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("referral_users"))
)]
async fn test_get_referral_code_for_user(pool: Pool<Postgres>) {
    let repo = PgReferralRepo::new(pool);

    let user_id = MacroUserIdStr::parse_from_str("macro|referrer@test.com")
        .unwrap()
        .into_owned();

    let code = repo.get_referral_code_for_user(&user_id.0).await.unwrap();

    // Round-trip: the returned code should decode back to the referrer's macro_user_id
    let converter = ShortUuidConverter::default();
    let decoded = converter.to_uuid(&code.0).unwrap();
    assert_eq!(decoded.to_string(), REFERRER_UUID);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("referral_users"))
)]
async fn test_get_referral_code_for_nonexistent_user(pool: Pool<Postgres>) {
    let repo = PgReferralRepo::new(pool);

    let user_id = MacroUserIdStr::parse_from_str("macro|nobody@test.com")
        .unwrap()
        .into_owned();

    let result = repo.get_referral_code_for_user(&user_id.0).await;

    assert!(matches!(result, Err(sqlx::Error::RowNotFound)));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("referral_users"))
)]
async fn test_get_referrers_customer_id(pool: Pool<Postgres>) {
    let repo = PgReferralRepo::new(pool);

    let code = referrer_referral_code();
    let customer_id = repo.get_referrers_customer_id(&code).await.unwrap();

    assert_eq!(customer_id, REFERRER_STRIPE_ID);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("referral_users"))
)]
async fn test_get_referrers_customer_id_invalid_code(pool: Pool<Postgres>) {
    let repo = PgReferralRepo::new(pool);

    let code = ReferralCode("!!!invalid!!!".to_string());
    let result = repo.get_referrers_customer_id(&code).await;

    assert!(result.is_err());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("referral_users"))
)]
async fn test_get_referrers_customer_id_nonexistent_user(pool: Pool<Postgres>) {
    let repo = PgReferralRepo::new(pool);

    // Valid short UUID format but no matching macro_user row
    let converter = ShortUuidConverter::default();
    let fake_uuid = uuid::Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();
    let code = ReferralCode(converter.from_uuid(&fake_uuid));

    let result = repo.get_referrers_customer_id(&code).await;

    assert!(matches!(result, Err(sqlx::Error::RowNotFound)));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("referral_users"))
)]
async fn test_track_referral(pool: Pool<Postgres>) {
    let repo = PgReferralRepo::new(pool.clone());

    let referred_user_id = MacroUserIdStr::parse_from_str("macro|referred@test.com")
        .unwrap()
        .into_owned();
    let code = referrer_referral_code();

    repo.track_referral(&referred_user_id.0, &code)
        .await
        .unwrap();

    // Verify a row was inserted into referral_tracking
    let row = sqlx::query!("SELECT referrer_id, referred_id FROM referral_tracking LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(row.referrer_id.to_string(), REFERRER_UUID);
    assert_eq!(
        row.referred_id.to_string(),
        "cccccccc-cccc-cccc-cccc-cccccccccccc"
    );
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("referral_users"))
)]
async fn test_track_referral_invalid_code(pool: Pool<Postgres>) {
    let repo = PgReferralRepo::new(pool);

    let referred_user_id = MacroUserIdStr::parse_from_str("macro|referred@test.com")
        .unwrap()
        .into_owned();
    let code = ReferralCode("!!!invalid!!!".to_string());

    let result = repo.track_referral(&referred_user_id.0, &code).await;

    assert!(result.is_err());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("referral_users"))
)]
async fn test_track_referral_nonexistent_referrer(pool: Pool<Postgres>) {
    let repo = PgReferralRepo::new(pool);

    let referred_user_id = MacroUserIdStr::parse_from_str("macro|referred@test.com")
        .unwrap()
        .into_owned();

    // Valid short UUID but no matching macro_user
    let converter = ShortUuidConverter::default();
    let fake_uuid = uuid::Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();
    let code = ReferralCode(converter.from_uuid(&fake_uuid));

    let result = repo.track_referral(&referred_user_id.0, &code).await;

    assert!(matches!(result, Err(sqlx::Error::RowNotFound)));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("referral_users"))
)]
async fn test_track_referral_nonexistent_referred_user(pool: Pool<Postgres>) {
    let repo = PgReferralRepo::new(pool);

    let referred_user_id = MacroUserIdStr::parse_from_str("macro|nobody@test.com")
        .unwrap()
        .into_owned();
    let code = referrer_referral_code();

    let result = repo.track_referral(&referred_user_id.0, &code).await;

    assert!(matches!(result, Err(sqlx::Error::RowNotFound)));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("referral_users"))
)]
async fn test_complete_referral(pool: Pool<Postgres>) {
    let repo = PgReferralRepo::new(pool.clone());

    let referred_user_id = MacroUserIdStr::parse_from_str("macro|referred@test.com")
        .unwrap()
        .into_owned();
    let code = referrer_referral_code();

    // First track the referral
    repo.track_referral(&referred_user_id.0, &code)
        .await
        .unwrap();

    // Then complete it
    repo.complete_referral(&referred_user_id.0, &code)
        .await
        .unwrap();

    // Verify the status was updated
    let row = sqlx::query!("SELECT status FROM referral_tracking LIMIT 1")
        .fetch_one(&pool)
        .await
        .unwrap();

    assert_eq!(row.status, "complete");
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("referral_users"))
)]
async fn test_complete_referral_invalid_code(pool: Pool<Postgres>) {
    let repo = PgReferralRepo::new(pool);

    let referred_user_id = MacroUserIdStr::parse_from_str("macro|referred@test.com")
        .unwrap()
        .into_owned();
    let code = ReferralCode("!!!invalid!!!".to_string());

    let result = repo.complete_referral(&referred_user_id.0, &code).await;

    assert!(result.is_err());
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("referral_users"))
)]
async fn test_complete_referral_nonexistent_referrer(pool: Pool<Postgres>) {
    let repo = PgReferralRepo::new(pool);

    let referred_user_id = MacroUserIdStr::parse_from_str("macro|referred@test.com")
        .unwrap()
        .into_owned();

    let converter = ShortUuidConverter::default();
    let fake_uuid = uuid::Uuid::parse_str("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa").unwrap();
    let code = ReferralCode(converter.from_uuid(&fake_uuid));

    let result = repo.complete_referral(&referred_user_id.0, &code).await;

    assert!(matches!(result, Err(sqlx::Error::RowNotFound)));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("referral_users"))
)]
async fn test_complete_referral_nonexistent_referred_user(pool: Pool<Postgres>) {
    let repo = PgReferralRepo::new(pool);

    let referred_user_id = MacroUserIdStr::parse_from_str("macro|nobody@test.com")
        .unwrap()
        .into_owned();
    let code = referrer_referral_code();

    let result = repo.complete_referral(&referred_user_id.0, &code).await;

    assert!(matches!(result, Err(sqlx::Error::RowNotFound)));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("referral_users"))
)]
async fn test_complete_referral_not_tracked(pool: Pool<Postgres>) {
    let repo = PgReferralRepo::new(pool);

    let referred_user_id = MacroUserIdStr::parse_from_str("macro|referred@test.com")
        .unwrap()
        .into_owned();
    let code = referrer_referral_code();

    // Complete without tracking first — no rows exist to update
    let result = repo.complete_referral(&referred_user_id.0, &code).await;

    assert!(matches!(result, Err(sqlx::Error::RowNotFound)));
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("referral_users"))
)]
async fn test_get_referred_by_found(pool: Pool<Postgres>) {
    let repo = PgReferralRepo::new(pool);

    // First track the referral so there's a row
    let referred_user_id = MacroUserIdStr::parse_from_str("macro|referred@test.com")
        .unwrap()
        .into_owned();
    let code = referrer_referral_code();
    repo.track_referral(&referred_user_id.0, &code)
        .await
        .unwrap();

    // Now look up who referred this user
    let referred_uuid = uuid::Uuid::parse_str("cccccccc-cccc-cccc-cccc-cccccccccccc").unwrap();
    let result = repo.get_referred_by(&referred_uuid).await.unwrap();

    assert!(result.is_some());
    let returned_code = result.unwrap();

    // The returned code should decode back to the referrer's UUID
    let converter = ShortUuidConverter::default();
    let decoded = converter.to_uuid(&returned_code.0).unwrap();
    assert_eq!(decoded.to_string(), REFERRER_UUID);
}

#[sqlx::test(
    migrator = "MACRO_DB_MIGRATIONS",
    fixtures(path = "../../../fixtures", scripts("referral_users"))
)]
async fn test_get_referred_by_not_found(pool: Pool<Postgres>) {
    let repo = PgReferralRepo::new(pool);

    // Query with a UUID that has no referral_tracking row
    let unknown_uuid = uuid::Uuid::parse_str("dddddddd-dddd-dddd-dddd-dddddddddddd").unwrap();
    let result = repo.get_referred_by(&unknown_uuid).await.unwrap();

    assert!(result.is_none());
}
