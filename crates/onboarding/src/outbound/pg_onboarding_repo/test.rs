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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn finishing_agent_setup_is_recorded_once_and_only_for_agent_led_rows(pool: PgPool) {
    let repo = PgOnboardingRepo::new(pool);
    let agent = user("agent@example.com");
    repo.mark_agent_led(&agent, Some("claude-code"))
        .await
        .unwrap()
        .expect("marked");

    repo.finish_agent_setup(&agent).await.unwrap();
    let first = repo
        .get_row(&agent)
        .await
        .unwrap()
        .expect("row")
        .agent_setup_done_at
        .expect("finished");
    repo.finish_agent_setup(&agent).await.unwrap();
    let again = repo.get_row(&agent).await.unwrap().expect("row");
    assert_eq!(again.agent_setup_done_at, Some(first));

    let web = user("web@example.com");
    repo.ensure_row(&web).await.unwrap();
    repo.finish_agent_setup(&web).await.unwrap();
    assert!(
        repo.get_row(&web)
            .await
            .unwrap()
            .expect("row")
            .agent_setup_done_at
            .is_none()
    );
}
