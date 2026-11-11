use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::{Map, json};

use super::*;
use crate::domain::ports::ScheduledActionRepo;
use crate::domain::service::test::configuration;
use crate::domain::suggestions::model::CheckedRoutineIdea;
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
        idea: None,
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
        idea: Some(CheckedRoutineIdea {
            title: "Plan the week".to_owned(),
            importance: 30,
            categories: Vec::new(),
        }),
    }
}

fn stored(kept: Kept) -> Uuid {
    match kept {
        Kept::Stored(id) => id,
        other => panic!("not kept: {other:?}"),
    }
}

/// The state of suggestion `suggestion`'s routine idea, and what it
/// produced.
async fn routine_idea(pool: &PgPool, suggestion: Uuid) -> Option<(String, Vec<String>)> {
    let idea = sqlx::query!(
        r#"SELECT i.id, i.state FROM idea i JOIN idea_routine r ON r.idea_id = i.id
           WHERE r.routine_suggestion_id = $1"#,
        suggestion,
    )
    .fetch_optional(pool)
    .await
    .unwrap()?;
    let produced = sqlx::query_scalar!(
        "SELECT entity_id FROM idea_target WHERE idea_id = $1 AND role = 'produced'",
        idea.id,
    )
    .fetch_all(pool)
    .await
    .unwrap();
    Some((idea.state, produced))
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
    let picked = stored(
        repo.add(&a, session, generation, &catalog("email_tags"), Utc::now())
            .await
            .unwrap(),
    );
    stored(
        repo.add(&a, session, generation, &drafted(), Utc::now())
            .await
            .unwrap(),
    );
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
           WHERE generation_id = $1 AND subject = 'routine_suggestion' ORDER BY created_at, id"#,
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
    let picked = stored(
        repo.add(&a, session, generation, &catalog("email_tags"), Utc::now())
            .await
            .unwrap(),
    );
    let written = stored(
        repo.add(&a, session, generation, &drafted(), Utc::now())
            .await
            .unwrap(),
    );

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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_drafted_suggestion_and_its_idea_are_kept_and_closed_together(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let generation = generation(&pool, USER_A).await;
    let repo = PgSuggestionRepo::new(pool.clone());
    let a = user(USER_A);
    let session = Uuid::now_v7();
    let add = |suggestion: CheckedSuggestion| {
        let repo = &repo;
        let a = a.clone();
        async move {
            stored(
                repo.add(&a, session, generation, &suggestion, Utc::now())
                    .await
                    .unwrap(),
            )
        }
    };
    let picked = add(catalog("email_tags")).await;
    let dismissed = add(drafted()).await;
    let retired = add(drafted()).await;
    let saved = add(drafted()).await;
    // A catalog pick has no idea; each drafted routine has one.
    assert_eq!(routine_idea(&pool, picked).await, None);
    assert_eq!(
        routine_idea(&pool, dismissed).await,
        Some(("proposed".to_owned(), Vec::new()))
    );

    assert!(repo.dismiss(&a, dismissed).await.unwrap());
    assert_eq!(routine_idea(&pool, dismissed).await.unwrap().0, "dismissed");
    assert!(
        repo.retire(
            &a,
            retired,
            session,
            generation,
            "No longer fits",
            Utc::now()
        )
        .await
        .unwrap()
    );
    assert_eq!(routine_idea(&pool, retired).await.unwrap().0, "retired");

    // Saving a routine from it finishes its idea, which produced the routine.
    let mut routine = sample_action(user_owner(USER_A), "Weekly planning");
    routine.suggestion_id = Some(saved);
    let created = test_repo(pool.clone())
        .create_action(routine)
        .await
        .unwrap();
    assert_eq!(
        routine_idea(&pool, saved).await,
        Some(("done".to_owned(), vec![created.id.unwrap().to_string()]))
    );

    // Every change to the ideas was logged under the generation.
    let logged = sqlx::query_scalar!(
        r#"SELECT action FROM suggestion_change
           WHERE generation_id = $1 AND subject = 'idea' ORDER BY created_at, id"#,
        generation,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(logged, ["created", "created", "created", "retired"]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_drafted_suggestion_past_the_ideas_limit_keeps_nothing(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgSuggestionRepo::new(pool.clone());
    let a = user(USER_A);
    // One generation already added its most ideas.
    let full = generation(&pool, USER_A).await;
    for _ in 0..ideas::domain::service::NEW_PER_GENERATION {
        stored(
            repo.add(&a, Uuid::now_v7(), full, &drafted(), Utc::now())
                .await
                .unwrap(),
        );
    }
    assert_eq!(
        repo.add(&a, Uuid::now_v7(), full, &drafted(), Utc::now())
            .await
            .unwrap(),
        Kept::NightFull
    );
    assert_eq!(
        repo.suggestions(&a).await.unwrap().len(),
        usize::try_from(ideas::domain::service::NEW_PER_GENERATION).unwrap()
    );
}

/// A drafted suggestion with no idea (one the previous release drafted
/// during a deploy) is still retired and dismissed.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_drafted_suggestion_without_its_idea_still_closes(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let generation = generation(&pool, USER_A).await;
    let repo = PgSuggestionRepo::new(pool.clone());
    let a = user(USER_A);
    let session = Uuid::now_v7();
    let retired = stored(
        repo.add(&a, session, generation, &drafted(), Utc::now())
            .await
            .unwrap(),
    );
    let dismissed = stored(
        repo.add(&a, session, generation, &drafted(), Utc::now())
            .await
            .unwrap(),
    );
    sqlx::query("DELETE FROM idea WHERE user_id = $1")
        .bind(USER_A)
        .execute(&pool)
        .await
        .unwrap();
    assert!(
        repo.retire(
            &a,
            retired,
            session,
            generation,
            "No longer fits",
            Utc::now()
        )
        .await
        .unwrap()
    );
    assert!(repo.dismiss(&a, dismissed).await.unwrap());
}
