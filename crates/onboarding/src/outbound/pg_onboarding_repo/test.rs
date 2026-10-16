use super::*;
use crate::domain::models::OnboardingStatus;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

fn user(email: &str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email(email).expect("valid test user id")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_row_removes_only_the_requested_user(pool: PgPool) {
    let repo = PgOnboardingRepo::new(pool);
    let deleted = user("deleted@example.com");
    let kept = user("kept@example.com");
    repo.ensure_row(&deleted).await.unwrap();
    repo.complete(&kept, true).await.unwrap();

    repo.delete_row(&deleted).await.unwrap();

    assert!(repo.get_row(&deleted).await.unwrap().is_none());
    let kept_row = repo.get_row(&kept).await.unwrap().expect("kept row");
    assert_eq!(kept_row.status, OnboardingStatus::Completed);
    assert!(kept_row.skipped);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_row_is_idempotent(pool: PgPool) {
    // Account deletion is retried by the identity provider; a user who never
    // entered the flow, or whose row went away on an earlier attempt, must
    // not fail the retry.
    let repo = PgOnboardingRepo::new(pool);
    let never_onboarded = user("never@example.com");

    repo.delete_row(&never_onboarded).await.unwrap();
    repo.ensure_row(&never_onboarded).await.unwrap();
    repo.delete_row(&never_onboarded).await.unwrap();
    repo.delete_row(&never_onboarded).await.unwrap();

    assert!(repo.get_row(&never_onboarded).await.unwrap().is_none());
}
