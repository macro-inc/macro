use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::*;

const OWNER: &str = "macro|suggestions-db-utils@macro.com";

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

fn card(suggestion: Uuid, generation: Uuid) -> NewRoutineSuggestionCard<'static> {
    NewRoutineSuggestionCard {
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

/// A card moves only from the state its routine suggestion's transition
/// read it in, so a card that moved meanwhile is left alone.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_routine_card_moves_only_from_the_state_it_is_in(pool: PgPool) {
    let (generation, suggestion) = setup(&pool).await;
    let mut tx = pool.begin().await.unwrap();
    assert_eq!(
        add_routine_card(&mut tx, &card(suggestion, generation), 30, 10)
            .await
            .unwrap(),
        Room::Fits
    );
    let moved = move_routine_card(&mut tx, suggestion, "proposed", "dismissed", Utc::now())
        .await
        .unwrap();
    assert!(moved.is_some());
    assert_eq!(
        move_routine_card(&mut tx, suggestion, "proposed", "retired", Utc::now())
            .await
            .unwrap(),
        None
    );
    assert_eq!(
        move_routine_card(&mut tx, suggestion, "dismissed", "done", Utc::now())
            .await
            .unwrap(),
        moved
    );
    // A routine suggestion with no card moves none.
    assert_eq!(
        move_routine_card(&mut tx, Uuid::now_v7(), "proposed", "done", Utc::now())
            .await
            .unwrap(),
        None
    );
    tx.commit().await.unwrap();
    let state = sqlx::query_scalar!("SELECT state FROM suggestion WHERE user_id = $1", OWNER)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(state, "done");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_routine_card_waits_for_room(pool: PgPool) {
    let (generation, suggestion) = setup(&pool).await;
    let mut tx = pool.begin().await.unwrap();
    assert_eq!(
        add_routine_card(&mut tx, &card(suggestion, generation), 0, 10)
            .await
            .unwrap(),
        Room::OpenFull
    );
    assert_eq!(
        add_routine_card(&mut tx, &card(suggestion, generation), 30, 0)
            .await
            .unwrap(),
        Room::GenerationFull
    );
}

/// Each routine saved from a suggestion is one more thing its card produced.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_saved_routine_is_what_its_card_produced(pool: PgPool) {
    let (generation, suggestion) = setup(&pool).await;
    let mut tx = pool.begin().await.unwrap();
    add_routine_card(&mut tx, &card(suggestion, generation), 30, 10)
        .await
        .unwrap();
    let card = move_routine_card(&mut tx, suggestion, "proposed", "done", Utc::now())
        .await
        .unwrap()
        .unwrap();
    let routines = [Uuid::now_v7(), Uuid::now_v7()];
    for routine in routines {
        add_produced_routine(&mut tx, card, routine).await.unwrap();
    }
    tx.commit().await.unwrap();
    let produced = sqlx::query!(
        r#"SELECT position, entity_type, entity_id FROM suggestion_target
           WHERE suggestion_id = $1 AND role = 'produced' ORDER BY position"#,
        card,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let produced: Vec<(i16, String, String)> = produced
        .into_iter()
        .map(|row| (row.position, row.entity_type, row.entity_id))
        .collect();
    assert_eq!(
        produced,
        [
            (0, "scheduled_action".to_owned(), routines[0].to_string()),
            (1, "scheduled_action".to_owned(), routines[1].to_string()),
        ]
    );
}
