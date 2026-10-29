use chrono::TimeDelta;
use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;
use crate::domain::model::{RoutineSurface, SuggestedEvent, SuggestionIcon, SuggestionTrigger};

async fn user(pool: &PgPool, email: &str) -> MacroUserIdStr<'static> {
    let user = MacroUserIdStr::try_from_email(email).expect("valid test user id");
    let macro_user_id = macro_uuid::generate_uuid_v7();
    sqlx::query!(
        r#"
        INSERT INTO macro_user (id, username, email, stripe_customer_id)
        VALUES ($1, $2, $3, $4)
        "#,
        macro_user_id,
        email,
        email,
        format!("stripe_{macro_user_id}"),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $2, $3)"#,
        user.as_ref(),
        email,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    user
}

fn suggestion(title: &str) -> RoutineSuggestion {
    RoutineSuggestion {
        surface: RoutineSurface::Email,
        title: title.to_owned(),
        summary: "Tags invoices.".to_owned(),
        reason: "Invoices arrive weekly".to_owned(),
        instructions: "Label invoices.".to_owned(),
        icon: SuggestionIcon::Tag,
        keep_probability: 0.85,
        affects_others: false,
        notify: true,
        trigger: SuggestionTrigger::Event {
            event: SuggestedEvent::EmailMessageReceived,
            condition: Some("Is this an invoice?".to_owned()),
        },
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_generation_claims_completes_and_reads_back(pool: PgPool) {
    let repo = PgRoutineSuggestionRepo::new(pool.clone());
    let user = user(&pool, "someone@example.com").await;
    let now = Utc::now();
    let generation = Uuid::now_v7();

    assert_eq!(repo.get(&user).await.unwrap(), None);
    assert!(
        repo.claim(&user, generation, now, now - TimeDelta::minutes(5))
            .await
            .unwrap()
    );
    let claimed = repo.get(&user).await.unwrap().unwrap();
    assert_eq!(claimed.status, SuggestionSetStatus::Generating);
    assert!(claimed.suggestions.is_empty());

    assert!(
        repo.complete(&user, generation, &[suggestion("Tag invoices")], now)
            .await
            .unwrap()
    );

    let stored = repo.get(&user).await.unwrap().unwrap();
    assert_eq!(stored.status, SuggestionSetStatus::Ready);
    assert_eq!(stored.suggestions, vec![suggestion("Tag invoices")]);
    assert!(stored.generated_at.is_some());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_running_generation_blocks_a_second_claim_until_it_is_stale(pool: PgPool) {
    let repo = PgRoutineSuggestionRepo::new(pool.clone());
    let user = user(&pool, "someone@example.com").await;
    let started = Utc::now() - TimeDelta::minutes(1);
    let first = Uuid::now_v7();
    assert!(repo.claim(&user, first, started, started).await.unwrap());

    let now = Utc::now();
    assert!(
        !repo
            .claim(&user, Uuid::now_v7(), now, now - TimeDelta::minutes(5))
            .await
            .unwrap()
    );

    let reclaim = Uuid::now_v7();
    assert!(repo.claim(&user, reclaim, now, now).await.unwrap());
    // The superseded generation's late result is discarded.
    assert!(
        !repo
            .complete(&user, first, &[suggestion("Late")], now)
            .await
            .unwrap()
    );
    assert!(
        repo.get(&user)
            .await
            .unwrap()
            .unwrap()
            .suggestions
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn regenerating_keeps_the_earlier_suggestions_until_it_lands(pool: PgPool) {
    let repo = PgRoutineSuggestionRepo::new(pool.clone());
    let user = user(&pool, "someone@example.com").await;
    let now = Utc::now();
    let first = Uuid::now_v7();
    repo.claim(&user, first, now, now).await.unwrap();
    repo.complete(&user, first, &[suggestion("Old")], now)
        .await
        .unwrap();

    let second = Uuid::now_v7();
    assert!(
        repo.claim(&user, second, now, now - TimeDelta::minutes(5))
            .await
            .unwrap()
    );
    let regenerating = repo.get(&user).await.unwrap().unwrap();
    assert_eq!(regenerating.status, SuggestionSetStatus::Generating);
    assert_eq!(regenerating.suggestions, vec![suggestion("Old")]);

    repo.fail(&user, second).await.unwrap();
    let failed = repo.get(&user).await.unwrap().unwrap();
    assert_eq!(failed.status, SuggestionSetStatus::Failed);
    assert_eq!(failed.suggestions, vec![suggestion("Old")]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unreadable_stored_suggestions_are_skipped(pool: PgPool) {
    let repo = PgRoutineSuggestionRepo::new(pool.clone());
    let user = user(&pool, "someone@example.com").await;
    let now = Utc::now();
    let generation = Uuid::now_v7();
    repo.claim(&user, generation, now, now).await.unwrap();
    repo.complete(&user, generation, &[suggestion("Kept")], now)
        .await
        .unwrap();
    sqlx::query!(
        r#"
        UPDATE routine_suggestion_set
        SET suggestions = suggestions || '[{"surface": "retired"}]'::jsonb
        WHERE user_id = $1
        "#,
        user.as_ref(),
    )
    .execute(&pool)
    .await
    .unwrap();

    let stored = repo.get(&user).await.unwrap().unwrap();

    assert_eq!(stored.suggestions, vec![suggestion("Kept")]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_the_user_deletes_their_suggestions(pool: PgPool) {
    let repo = PgRoutineSuggestionRepo::new(pool.clone());
    let user = user(&pool, "someone@example.com").await;
    let now = Utc::now();
    repo.claim(&user, Uuid::now_v7(), now, now).await.unwrap();

    sqlx::query!(r#"DELETE FROM "User" WHERE id = $1"#, user.as_ref())
        .execute(&pool)
        .await
        .unwrap();

    assert_eq!(repo.get(&user).await.unwrap(), None);
}
