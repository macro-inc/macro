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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mark_agent_led_creates_a_completed_agent_led_row_for_new_accounts(pool: PgPool) {
    let repo = PgOnboardingRepo::new(pool);
    let fresh = user("fresh@example.com");

    let row = repo
        .mark_agent_led(&fresh, Some("claude-code"))
        .await
        .unwrap()
        .expect("a new account is eligible");

    assert_eq!(row.status, OnboardingStatus::Completed);
    assert!(!row.skipped);
    assert!(row.completed_at.is_some());
    assert!(row.is_agent_led());
    assert_eq!(row.agent_client.as_deref(), Some("claude-code"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mark_agent_led_takes_over_an_unfinished_web_flow(pool: PgPool) {
    let repo = PgOnboardingRepo::new(pool);
    let midway = user("midway@example.com");
    repo.ensure_row(&midway).await.unwrap();

    let row = repo
        .mark_agent_led(&midway, Some("codex"))
        .await
        .unwrap()
        .expect("an active flow is eligible");

    assert_eq!(row.status, OnboardingStatus::Completed);
    assert!(row.is_agent_led());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mark_agent_led_never_touches_web_onboarded_accounts(pool: PgPool) {
    let repo = PgOnboardingRepo::new(pool);
    let onboarded = user("onboarded@example.com");
    let before = repo.complete(&onboarded, false).await.unwrap();

    let marked = repo
        .mark_agent_led(&onboarded, Some("claude-code"))
        .await
        .unwrap();

    assert!(marked.is_none());
    let after = repo.get_row(&onboarded).await.unwrap().expect("row");
    assert_eq!(after, before);
    assert!(!after.is_agent_led());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn mark_agent_led_is_idempotent_and_keeps_the_first_client(pool: PgPool) {
    let repo = PgOnboardingRepo::new(pool);
    let agent = user("agent@example.com");
    let first = repo
        .mark_agent_led(&agent, Some("claude-code"))
        .await
        .unwrap()
        .expect("first marking");

    let again = repo
        .mark_agent_led(&agent, Some("codex"))
        .await
        .unwrap()
        .expect("an agent-led account stays eligible");

    assert_eq!(again.agent_led_at, first.agent_led_at);
    assert_eq!(again.completed_at, first.completed_at);
    assert_eq!(again.agent_client.as_deref(), Some("claude-code"));
}
