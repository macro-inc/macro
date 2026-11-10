use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::{Map, json};

use super::*;
use crate::domain::ports::ScheduledActionRepo;
use crate::domain::service::test::configuration;
use crate::outbound::pg_scheduled_action_repo::test::{
    USER_A, USER_B, insert_user, sample_action, test_repo, user_owner,
};

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

fn catalog(key: &str) -> CheckedSuggestion {
    let mut knobs = Map::new();
    knobs.insert("fyiTag".to_owned(), json!("Suppliers"));
    CheckedSuggestion {
        surfaces: vec![Surface::Email, Surface::Tasks],
        reason: "You get a lot of supplier mail.".to_owned(),
        keep_probability: 0.7,
        pick: StoredPick::Catalog {
            key: key.to_owned(),
            knobs,
        },
    }
}

fn drafted() -> CheckedSuggestion {
    CheckedSuggestion {
        surfaces: vec![Surface::Calendar],
        reason: "Your week fills up fast.".to_owned(),
        keep_probability: 0.3,
        pick: StoredPick::Routine {
            routine: configuration(false),
        },
    }
}

/// A generation of `user`'s, for the change log's rows to point at.
async fn generation(pool: &PgPool, user: &str) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO suggestion_generation (id, user_id, trigger, status, started_at)
           VALUES ($1, $2, 'nightly', 'generating', now())"#,
        id,
        user,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_session_counts_what_it_kept_and_every_keep_and_retire_is_logged(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let generation = generation(&pool, USER_A).await;
    let repo = PgSuggestionRepo::new(pool.clone());
    let a = user(USER_A);
    let session = Uuid::now_v7();
    assert_eq!(repo.kept_by(&a, session).await.unwrap(), 0);
    let picked = repo
        .add(&a, session, generation, &catalog("email_tags"), Utc::now())
        .await
        .unwrap();
    repo.add(&a, session, generation, &drafted(), Utc::now())
        .await
        .unwrap();
    assert_eq!(repo.kept_by(&a, session).await.unwrap(), 2);

    assert!(
        repo.retire(
            &a,
            picked,
            session,
            generation,
            "No longer fits",
            Utc::now()
        )
        .await
        .unwrap()
    );
    // Already retired.
    assert!(
        !repo
            .retire(&a, picked, session, generation, "Again", Utc::now())
            .await
            .unwrap()
    );
    let stored = repo.suggestions(&a).await.unwrap();
    assert!(stored[0].retired_at.is_some() && stored[0].dismissed_at.is_none());
    assert!(stored[1].is_open());

    let logged = sqlx::query!(
        r#"SELECT action, subject, reason FROM suggestion_change
           WHERE generation_id = $1 ORDER BY created_at, id"#,
        generation,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    let logged: Vec<(String, String)> = logged
        .into_iter()
        .map(|row| (row.action, row.subject))
        .collect();
    assert_eq!(
        logged,
        [
            ("created".to_owned(), "routine_suggestion".to_owned()),
            ("created".to_owned(), "routine_suggestion".to_owned()),
            ("retired".to_owned(), "routine_suggestion".to_owned()),
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn suggestions_round_trip_and_dismissals_and_saves_are_the_persons(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let generation = generation(&pool, USER_A).await;
    let repo = PgSuggestionRepo::new(pool.clone());
    let (a, b) = (user(USER_A), user(USER_B));
    let session = Uuid::now_v7();
    let picked = repo
        .add(&a, session, generation, &catalog("email_tags"), Utc::now())
        .await
        .unwrap();
    let written = repo
        .add(&a, session, generation, &drafted(), Utc::now())
        .await
        .unwrap();

    let stored = repo.suggestions(&a).await.unwrap();
    assert_eq!(stored.len(), 2);
    assert_eq!(stored[0].id, picked);
    assert_eq!(stored[0].surfaces, [Surface::Email, Surface::Tasks]);
    assert_eq!(stored[0].pick, catalog("email_tags").pick);
    assert_eq!(stored[1].pick, drafted().pick);
    assert!(repo.suggestions(&b).await.unwrap().is_empty());

    // Someone else can't dismiss it.
    assert!(!repo.dismiss(&b, picked).await.unwrap());
    assert!(repo.dismiss(&a, picked).await.unwrap());
    assert!(repo.dismiss(&a, picked).await.unwrap());
    let stored = repo.suggestions(&a).await.unwrap();
    assert!(stored[0].dismissed_at.is_some() && stored[1].dismissed_at.is_none());

    repo.dismiss_template(&a, "brief").await.unwrap();
    repo.dismiss_template(&a, "brief").await.unwrap();
    assert_eq!(repo.dismissed_templates(&a).await.unwrap(), ["brief"]);
    assert!(repo.dismissed_templates(&b).await.unwrap().is_empty());

    // A routine saved from a suggestion counts for its owner only.
    let actions = test_repo(pool);
    let mut saved = sample_action(user_owner(USER_A), "Weekly planning");
    saved.suggestion_id = Some(written);
    actions.create_action(saved).await.unwrap();
    let mut theirs = sample_action(user_owner(USER_B), "Digest");
    theirs.suggestion_id = Some(picked);
    actions.create_action(theirs).await.unwrap();
    assert_eq!(repo.saved_from(&a).await.unwrap(), [written]);
}
