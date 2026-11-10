use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::*;

const OWNER: &str = "macro|ideas-db-utils@macro.com";

async fn setup(pool: &PgPool) -> (Uuid, Uuid) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
        macro_user_id,
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        OWNER,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
    let generation = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO suggestion_generation (id, user_id, trigger, status, started_at)
           VALUES ($1, $2, 'nightly', 'generating', now())"#,
        generation,
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    let suggestion = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO routine_suggestion
             (id, user_id, session_id, surfaces, routine, reason, keep_probability, created_at)
           VALUES ($1, $2, $3, '{tasks}', '{}'::jsonb, 'You plan on Mondays', 0.4, now())"#,
        suggestion,
        OWNER,
        Uuid::now_v7(),
    )
    .execute(pool)
    .await
    .unwrap();
    (generation, suggestion)
}

fn idea(suggestion: Uuid, generation: Uuid) -> NewRoutineIdea<'static> {
    NewRoutineIdea {
        user: OWNER,
        suggestion,
        title: "Plan the week",
        summary: "You plan on Mondays",
        importance: 40,
        categories: &[],
        session: Uuid::now_v7(),
        generation,
        at: Utc::now(),
    }
}

/// A closed routine idea stays closed: a later dismiss, retire or save
/// changes nothing.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_routine_idea_closes_once(pool: PgPool) {
    let (generation, suggestion) = setup(&pool).await;
    let mut tx = pool.begin().await.unwrap();
    assert_eq!(
        add_routine_idea(&mut tx, &idea(suggestion, generation), 30, 10)
            .await
            .unwrap(),
        Room::Fits
    );
    assert!(
        close_routine_idea(&mut tx, suggestion, "dismissed", None, Utc::now())
            .await
            .unwrap()
    );
    assert!(
        !close_routine_idea(&mut tx, suggestion, "retired", None, Utc::now())
            .await
            .unwrap()
    );
    assert!(
        !complete_routine_idea(&mut tx, OWNER, suggestion, Uuid::now_v7(), Utc::now())
            .await
            .unwrap()
    );
    tx.commit().await.unwrap();
    let state = sqlx::query_scalar!("SELECT state FROM idea WHERE user_id = $1", OWNER)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(state, "dismissed");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_routine_idea_waits_for_room(pool: PgPool) {
    let (generation, suggestion) = setup(&pool).await;
    let mut tx = pool.begin().await.unwrap();
    assert_eq!(
        add_routine_idea(&mut tx, &idea(suggestion, generation), 0, 10)
            .await
            .unwrap(),
        Room::OpenFull
    );
    assert_eq!(
        add_routine_idea(&mut tx, &idea(suggestion, generation), 30, 0)
            .await
            .unwrap(),
        Room::GenerationFull
    );
}

/// Saving a routine from someone else's suggestion leaves their idea open.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_the_owner_saving_a_routine_finishes_its_idea(pool: PgPool) {
    let (generation, suggestion) = setup(&pool).await;
    let mut tx = pool.begin().await.unwrap();
    add_routine_idea(&mut tx, &idea(suggestion, generation), 30, 10)
        .await
        .unwrap();
    assert!(
        !complete_routine_idea(
            &mut tx,
            "macro|someone-else@macro.com",
            suggestion,
            Uuid::now_v7(),
            Utc::now()
        )
        .await
        .unwrap()
    );
    assert!(
        complete_routine_idea(&mut tx, OWNER, suggestion, Uuid::now_v7(), Utc::now())
            .await
            .unwrap()
    );
    tx.commit().await.unwrap();
}
