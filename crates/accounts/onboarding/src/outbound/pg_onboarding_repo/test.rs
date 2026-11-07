use super::*;
use crate::domain::models::{OnboardingStatus, PromptId};
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

fn prompt(id: &str) -> PromptId {
    PromptId::parse(id).expect("valid prompt id")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn dismissals_are_per_user_idempotent_and_ordered(pool: PgPool) {
    let repo = PgOnboardingRepo::new(pool);
    let alice = user("alice@example.com");
    let bob = user("bob@example.com");

    repo.dismiss_prompt(&alice, &prompt("import:files"))
        .await
        .unwrap();
    repo.dismiss_prompt(&alice, &prompt("home-setup"))
        .await
        .unwrap();
    repo.dismiss_prompt(&alice, &prompt("import:files"))
        .await
        .unwrap();

    assert_eq!(
        repo.dismissed_prompts(&alice).await.unwrap(),
        vec!["import:files".to_string(), "home-setup".to_string()]
    );
    assert!(repo.dismissed_prompts(&bob).await.unwrap().is_empty());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn delete_row_removes_dismissals_without_an_onboarding_row(pool: PgPool) {
    // Users who never entered onboarding can still dismiss prompts; account
    // deletion must clear those too.
    let repo = PgOnboardingRepo::new(pool);
    let deleted = user("deleted@example.com");
    let kept = user("kept@example.com");
    repo.dismiss_prompt(&deleted, &prompt("calendar-accounts"))
        .await
        .unwrap();
    repo.dismiss_prompt(&kept, &prompt("calendar-accounts"))
        .await
        .unwrap();

    repo.delete_row(&deleted).await.unwrap();

    assert!(repo.dismissed_prompts(&deleted).await.unwrap().is_empty());
    assert_eq!(repo.dismissed_prompts(&kept).await.unwrap().len(), 1);
}
