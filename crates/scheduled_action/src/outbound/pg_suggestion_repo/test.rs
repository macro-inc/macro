use macro_db_migrator::MACRO_DB_MIGRATIONS;
use serde_json::{Map, json};
use strum::VariantArray;

use super::*;
use crate::domain::ports::ScheduledActionRepo;
use crate::domain::service::test::configuration;
use crate::domain::suggestions::model::CheckedRoutineSuggestionCard;
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
        card: None,
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
        card: Some(CheckedRoutineSuggestionCard {
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

/// The state of suggestion `suggestion`'s routine suggestion, and what it
/// produced.
async fn routine_card(pool: &PgPool, suggestion: Uuid) -> Option<(String, Vec<String>)> {
    let card = sqlx::query!(
        r#"SELECT i.id, i.state FROM suggestion i JOIN suggestion_routine r ON r.suggestion_id = i.id
           WHERE r.routine_suggestion_id = $1"#,
        suggestion,
    )
    .fetch_optional(pool)
    .await
    .unwrap()?;
    let produced = sqlx::query_scalar!(
        "SELECT entity_id FROM suggestion_target WHERE suggestion_id = $1 AND role = 'produced'",
        card.id,
    )
    .fetch_all(pool)
    .await
    .unwrap();
    Some((card.state, produced))
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
    assert_eq!(stored[0].state, RoutineSuggestionState::Retired);
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

    // Someone else can't dismiss it; dismissing it again changes nothing.
    assert_eq!(repo.dismiss(&b, picked).await.unwrap(), None);
    assert_eq!(
        repo.dismiss(&a, picked).await.unwrap(),
        Some(Transition::Move(RoutineSuggestionState::Dismissed))
    );
    assert_eq!(
        repo.dismiss(&a, picked).await.unwrap(),
        Some(Transition::Stay)
    );
    let stored = repo.suggestions(&a).await.unwrap();
    assert_eq!(stored[0].state, RoutineSuggestionState::Dismissed);
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
    let stored = repo.suggestions(&a).await.unwrap();
    assert_eq!(
        (stored[0].state, stored[1].state),
        (
            RoutineSuggestionState::Dismissed,
            RoutineSuggestionState::Saved
        )
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_drafted_suggestion_and_its_card_are_kept_and_closed_together(pool: PgPool) {
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
    // A catalog pick has no suggestion; each drafted routine has one.
    assert_eq!(routine_card(&pool, picked).await, None);
    assert_eq!(
        routine_card(&pool, dismissed).await,
        Some(("proposed".to_owned(), Vec::new()))
    );

    assert!(repo.dismiss(&a, dismissed).await.unwrap().is_some());
    assert_eq!(routine_card(&pool, dismissed).await.unwrap().0, "dismissed");
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
    assert_eq!(routine_card(&pool, retired).await.unwrap().0, "retired");

    // Saving a routine from it moves its card to done, which produced the routine.
    let mut routine = sample_action(user_owner(USER_A), "Weekly planning");
    routine.suggestion_id = Some(saved);
    let created = test_repo(pool.clone())
        .create_action(routine)
        .await
        .unwrap();
    assert_eq!(
        routine_card(&pool, saved).await,
        Some(("done".to_owned(), vec![created.id.unwrap().to_string()]))
    );

    // Every change to the suggestions was logged under the generation.
    let logged = sqlx::query_scalar!(
        r#"SELECT action FROM suggestion_change
           WHERE generation_id = $1 AND subject = 'suggestion' ORDER BY created_at, id"#,
        generation,
    )
    .fetch_all(&pool)
    .await
    .unwrap();
    assert_eq!(logged, ["created", "created", "created", "retired"]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_drafted_suggestion_past_the_suggestions_limit_keeps_nothing(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgSuggestionRepo::new(pool.clone());
    let a = user(USER_A);
    // One generation already added its most suggestions.
    let full = generation(&pool, USER_A).await;
    for _ in 0..suggestions::domain::service::NEW_PER_GENERATION {
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
        usize::try_from(suggestions::domain::service::NEW_PER_GENERATION).unwrap()
    );
}

/// A drafted suggestion with no suggestion (one the previous release drafted
/// during a deploy) is still retired and dismissed.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_drafted_suggestion_without_its_card_still_closes(pool: PgPool) {
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
    sqlx::query("DELETE FROM suggestion WHERE user_id = $1")
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
    assert_eq!(
        repo.dismiss(&a, dismissed).await.unwrap(),
        Some(Transition::Move(RoutineSuggestionState::Dismissed))
    );
}

/// Save a routine of `owner`'s from suggestion `suggestion`; the routine's id.
async fn save_routine(pool: &PgPool, owner: &'static str, suggestion: Uuid) -> Uuid {
    let mut routine = sample_action(user_owner(owner), "Weekly planning");
    routine.suggestion_id = Some(suggestion);
    test_repo(pool.clone())
        .create_action(routine)
        .await
        .unwrap()
        .id
        .unwrap()
}

/// A drafted suggestion of A's, with its card, in `state`, reached as the
/// person and a routines session would.
async fn drafted_in(
    pool: &PgPool,
    repo: &PgSuggestionRepo,
    state: RoutineSuggestionState,
    session: Uuid,
    generation: Uuid,
) -> Uuid {
    let a = user(USER_A);
    let id = stored(
        repo.add(&a, session, generation, &drafted(), Utc::now())
            .await
            .unwrap(),
    );
    match state {
        RoutineSuggestionState::Open => {}
        RoutineSuggestionState::Dismissed => {
            repo.dismiss(&a, id).await.unwrap();
        }
        RoutineSuggestionState::Retired => {
            repo.retire(&a, id, session, generation, "No longer fits", Utc::now())
                .await
                .unwrap();
        }
        RoutineSuggestionState::Saved => {
            save_routine(pool, USER_A, id).await;
        }
    }
    id
}

/// Suggestion `id` of A's as stored.
async fn stored_suggestion(repo: &PgSuggestionRepo, id: Uuid) -> StoredSuggestion {
    repo.suggestions(&user(USER_A))
        .await
        .unwrap()
        .into_iter()
        .find(|suggestion| suggestion.id == id)
        .unwrap()
}

/// Each event in each state moves the stored suggestion and its card where
/// the domain's transition says, and leaves them where they are otherwise.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn every_event_moves_a_suggestion_and_its_card_as_the_domain_says(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgSuggestionRepo::new(pool.clone());
    let a = user(USER_A);
    for state in RoutineSuggestionState::VARIANTS {
        for event in RoutineSuggestionEvent::VARIANTS {
            let case = format!("{state:?} on {event:?}");
            let generation = generation(&pool, USER_A).await;
            let session = Uuid::now_v7();
            let id = drafted_in(&pool, &repo, *state, session, generation).await;
            assert_eq!(stored_suggestion(&repo, id).await.state, *state, "{case}");
            let (_, produced_before) = routine_card(&pool, id).await.unwrap();
            let expected = state.on(*event);
            let saved = match event {
                RoutineSuggestionEvent::Retire => {
                    let moved = repo
                        .retire(&a, id, session, generation, "No longer fits", Utc::now())
                        .await
                        .unwrap();
                    assert_eq!(moved, matches!(expected, Transition::Move(_)), "{case}");
                    None
                }
                RoutineSuggestionEvent::Dismiss => {
                    assert_eq!(
                        repo.dismiss(&a, id).await.unwrap(),
                        Some(expected),
                        "{case}"
                    );
                    None
                }
                RoutineSuggestionEvent::Save => Some(save_routine(&pool, USER_A, id).await),
            };
            let now = match expected {
                Transition::Move(to) => to,
                Transition::Stay | Transition::Refuse => *state,
            };
            let after = stored_suggestion(&repo, id).await;
            assert_eq!(after.state, now, "{case}");
            match now {
                RoutineSuggestionState::Open => {
                    assert!(
                        after.dismissed_at.is_none() && after.retired_at.is_none(),
                        "{case}"
                    );
                }
                RoutineSuggestionState::Dismissed => {
                    assert!(after.dismissed_at.is_some(), "{case}")
                }
                RoutineSuggestionState::Retired => assert!(after.retired_at.is_some(), "{case}"),
                RoutineSuggestionState::Saved => {}
            }
            let (card, produced) = routine_card(&pool, id).await.unwrap();
            assert_eq!(card, now.card().as_ref(), "{case}");
            // Only a save that moved it records the routine as produced.
            let mut expected_produced = produced_before;
            if let (Some(routine), Transition::Move(_)) = (saved, expected) {
                expected_produced.push(routine.to_string());
            }
            assert_eq!(produced, expected_produced, "{case}");
            // A person has one generation running at a time.
            sqlx::query!(
                "UPDATE suggestion_generation SET status = 'ready', finished_at = now() WHERE id = $1",
                generation,
            )
            .execute(&pool)
            .await
            .unwrap();
        }
    }
}

/// Saving a routine from someone else's suggestion, or from a template,
/// leaves the suggestion where it is.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_the_owner_saving_a_routine_saves_the_suggestion(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let generation = generation(&pool, USER_A).await;
    let repo = PgSuggestionRepo::new(pool.clone());
    let id = drafted_in(
        &pool,
        &repo,
        RoutineSuggestionState::Open,
        Uuid::now_v7(),
        generation,
    )
    .await;
    save_routine(&pool, USER_B, id).await;
    save_routine(&pool, USER_A, Uuid::now_v7()).await;
    assert_eq!(
        stored_suggestion(&repo, id).await.state,
        RoutineSuggestionState::Open
    );
    assert_eq!(
        routine_card(&pool, id).await,
        Some(("proposed".to_owned(), Vec::new()))
    );
}

/// Sessions keeping the same catalog routine at once keep it once.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_sessions_keep_one_pick_of_a_catalog_routine(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let generation = generation(&pool, USER_A).await;
    let keeps = (0..8).map(|_| {
        let repo = PgSuggestionRepo::new(pool.clone());
        tokio::spawn(async move {
            repo.add(
                &user(USER_A),
                Uuid::now_v7(),
                generation,
                &catalog("email_tags"),
                Utc::now(),
            )
            .await
            .unwrap()
        })
    });
    let kept: Vec<Kept> = futures::future::join_all(keeps)
        .await
        .into_iter()
        .map(Result::unwrap)
        .collect();
    assert_eq!(
        kept.iter()
            .filter(|kept| matches!(kept, Kept::Stored(_)))
            .count(),
        1,
        "{kept:?}"
    );
    assert!(
        kept.iter()
            .all(|kept| matches!(kept, Kept::Stored(_) | Kept::Taken))
    );
    let repo = PgSuggestionRepo::new(pool);
    assert_eq!(repo.suggestions(&user(USER_A)).await.unwrap().len(), 1);
}

/// A session keeping many at once keeps no more than its limit.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_session_keeping_at_once_keeps_at_most_its_limit(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let generation = generation(&pool, USER_A).await;
    let session = Uuid::now_v7();
    let over = 8;
    let keeps = (0..MAX_KEPT_PER_SESSION + over).map(|n| {
        let repo = PgSuggestionRepo::new(pool.clone());
        tokio::spawn(async move {
            repo.add(
                &user(USER_A),
                session,
                generation,
                &catalog(&format!("routine_{n}")),
                Utc::now(),
            )
            .await
            .unwrap()
        })
    });
    let kept: Vec<Kept> = futures::future::join_all(keeps)
        .await
        .into_iter()
        .map(Result::unwrap)
        .collect();
    let stored = kept
        .iter()
        .filter(|kept| matches!(kept, Kept::Stored(_)))
        .count();
    assert_eq!(
        stored,
        usize::try_from(MAX_KEPT_PER_SESSION).unwrap(),
        "{kept:?}"
    );
    assert!(
        kept.iter()
            .all(|kept| matches!(kept, Kept::Stored(_) | Kept::SessionFull))
    );
    let repo = PgSuggestionRepo::new(pool);
    assert_eq!(
        repo.kept_by(&user(USER_A), session).await.unwrap(),
        MAX_KEPT_PER_SESSION
    );
}

/// A's `email_tags` pick as the previous release keeps it, without the lock:
/// open, or retired.
async fn insert_pick<'e>(
    conn: impl sqlx::PgExecutor<'e>,
    retired: bool,
) -> Result<(), sqlx::Error> {
    sqlx::query!(
        r#"INSERT INTO routine_suggestion
             (id, user_id, session_id, surfaces, catalog_key, reason, keep_probability,
              created_at, state, retired_at)
           VALUES ($1, $2, $3, '{email}', 'email_tags', 'Fits', 0.5, now(),
                   CASE WHEN $4 THEN 'retired' ELSE 'open' END, CASE WHEN $4 THEN now() END)"#,
        Uuid::now_v7(),
        USER_A,
        Uuid::now_v7(),
        retired,
    )
    .execute(conn)
    .await
    .map(drop)
}

/// A catalog pick the previous release keeps meanwhile, without the lock,
/// is the one kept: the open catalog key index refuses a second. Whether
/// the keep checks before or after that pick commits, it is refused.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_pick_kept_meanwhile_without_the_lock_is_not_kept_twice(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let generation = generation(&pool, USER_A).await;
    let mut previous_release = pool.begin().await.unwrap();
    insert_pick(&mut *previous_release, false).await.unwrap();
    let keeping = {
        let repo = PgSuggestionRepo::new(pool.clone());
        tokio::spawn(async move {
            repo.add(
                &user(USER_A),
                Uuid::now_v7(),
                generation,
                &catalog("email_tags"),
                Utc::now(),
            )
            .await
            .unwrap()
        })
    };
    previous_release.commit().await.unwrap();
    assert_eq!(keeping.await.unwrap(), Kept::Taken);
    // The index itself refuses a second open pick, but not a retired one.
    let second = insert_pick(&pool, false).await.unwrap_err();
    assert_eq!(
        second
            .as_database_error()
            .and_then(|error| error.constraint()),
        Some("routine_suggestion_open_catalog_key_idx")
    );
    insert_pick(&pool, true).await.unwrap();
}

/// The state backfill derives each suggestion's state as readers did before
/// it was stored, leaves one open pick per catalog key, and moves each card
/// to its suggestion's state.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_state_backfill_derives_what_readers_derived(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let generation = generation(&pool, USER_A).await;
    let repo = PgSuggestionRepo::new(pool.clone());
    // As the previous release left it: every row open, with its times.
    sqlx::raw_sql("DROP INDEX routine_suggestion_open_catalog_key_idx")
        .execute(&pool)
        .await
        .unwrap();
    let routine = serde_json::to_value(configuration(false)).unwrap();
    let legacy = |key: Option<&'static str>, keep: f32, dismissed: bool, retired: bool| {
        let pool = pool.clone();
        let routine = key.is_none().then(|| routine.clone());
        async move {
            let id = Uuid::now_v7();
            sqlx::query!(
                r#"INSERT INTO routine_suggestion
                     (id, user_id, session_id, surfaces, catalog_key, routine, reason,
                      keep_probability, dismissed_at, retired_at, created_at)
                   VALUES ($1, $2, $3, '{email}', $4, $5, 'Fits', $6,
                           CASE WHEN $7 THEN now() END, CASE WHEN $8 THEN now() END, now())"#,
                id,
                USER_A,
                Uuid::now_v7(),
                key,
                routine,
                keep,
                dismissed,
                retired,
            )
            .execute(&pool)
            .await
            .unwrap();
            id
        }
    };
    let open = legacy(Some("brief"), 0.5, false, false).await;
    let dismissed = legacy(Some("triage"), 0.5, true, false).await;
    let retired = legacy(Some("email_tags"), 0.5, false, true).await;
    let dismissed_and_retired = legacy(Some("document_tags"), 0.5, true, true).await;
    let saved_after_retiring = legacy(None, 0.5, false, true).await;
    let saved_by_someone_else = legacy(None, 0.5, true, false).await;
    let worse_twin = legacy(Some("inbox"), 0.4, false, false).await;
    let better_twin = legacy(Some("inbox"), 0.9, false, false).await;
    let accepted_card = legacy(None, 0.5, false, false).await;
    let dismissed_card = legacy(None, 0.5, true, false).await;
    for (owner, suggestion) in [
        (USER_A, saved_after_retiring),
        (USER_B, saved_by_someone_else),
    ] {
        let routine = test_repo(pool.clone())
            .create_action(sample_action(user_owner(owner), "Digest"))
            .await
            .unwrap()
            .id
            .unwrap();
        sqlx::query!(
            "UPDATE scheduled_action SET suggestion_id = $1 WHERE id = $2",
            suggestion,
            routine,
        )
        .execute(&pool)
        .await
        .unwrap();
    }
    for (suggestion, card_state) in [
        (accepted_card, "done"),
        (dismissed_card, "proposed"),
        (saved_after_retiring, "retired"),
    ] {
        let mut tx = pool.begin().await.unwrap();
        suggestions_db_utils::add_routine_card(
            &mut tx,
            &suggestions_db_utils::NewRoutineSuggestionCard {
                user: USER_A,
                suggestion,
                title: "Plan the week",
                summary: "Fits",
                importance: 30,
                categories: &[],
                session: Uuid::now_v7(),
                generation,
                at: Utc::now(),
            },
            30,
            12,
        )
        .await
        .unwrap();
        tx.commit().await.unwrap();
        sqlx::query!(
            "UPDATE suggestion SET state = $2 WHERE id = (
               SELECT suggestion_id FROM suggestion_routine WHERE routine_suggestion_id = $1)",
            suggestion,
            card_state,
        )
        .execute(&pool)
        .await
        .unwrap();
    }

    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20261113042517_backfill_routine_suggestion_state.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();
    sqlx::raw_sql(include_str!(
        "../../../../macro_db_client/migrations/20261113042518_routine_suggestion_open_catalog_key_concurrently.sql"
    ))
    .execute(&pool)
    .await
    .unwrap();

    let state = |id| {
        let repo = &repo;
        async move { stored_suggestion(repo, id).await.state }
    };
    use RoutineSuggestionState::{Dismissed, Open, Retired, Saved};
    for (id, expected) in [
        (open, Open),
        (dismissed, Dismissed),
        (retired, Retired),
        (dismissed_and_retired, Dismissed),
        (saved_after_retiring, Saved),
        (saved_by_someone_else, Dismissed),
        (worse_twin, Retired),
        (better_twin, Open),
        (accepted_card, Open),
        (dismissed_card, Dismissed),
    ] {
        assert_eq!(state(id).await, expected, "{id}");
    }
    assert!(
        stored_suggestion(&repo, worse_twin)
            .await
            .retired_at
            .is_some()
    );
    for (id, card) in [
        (accepted_card, "proposed"),
        (dismissed_card, "dismissed"),
        (saved_after_retiring, "done"),
    ] {
        assert_eq!(routine_card(&pool, id).await.unwrap().0, card, "{id}");
    }
    let valid = sqlx::query_scalar!(
        r#"SELECT convalidated AS "valid!" FROM pg_constraint
           WHERE conname = 'routine_suggestion_state_check'"#
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert!(valid);
}
