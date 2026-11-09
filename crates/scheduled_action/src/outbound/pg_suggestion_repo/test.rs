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

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_generation_starts_once_and_records_how_it_ended(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgSuggestionRepo::new(pool);
    let a = user(USER_A);
    assert_eq!(repo.generation(&a).await.unwrap(), None);
    assert!(repo.begin(&a, Utc::now()).await.unwrap());
    assert!(!repo.begin(&a, Utc::now()).await.unwrap());
    assert_eq!(
        repo.generation(&a).await.unwrap().unwrap().status,
        GenerationStatus::Generating
    );
    repo.finish(&a, false, Utc::now()).await.unwrap();
    let stored = repo.generation(&a).await.unwrap().unwrap();
    assert_eq!(stored.status, GenerationStatus::Failed);
    assert!(stored.finished_at.is_some());
    // Generation still runs only once.
    assert!(!repo.begin(&a, Utc::now()).await.unwrap());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_session_suggests_while_open_and_counts_what_it_kept(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    let repo = PgSuggestionRepo::new(pool);
    let a = user(USER_A);
    let session = Uuid::now_v7();
    let opened = Utc::now() - chrono::TimeDelta::minutes(20);
    repo.open_session(
        session,
        &a,
        bot_id::MACRO_NEW_BOT_ID,
        &[Surface::Email, Surface::Tasks],
        opened,
    )
    .await
    .unwrap();
    let found = repo.session(session).await.unwrap().unwrap();
    assert_eq!(found.owner, a);
    assert_eq!(found.agent, bot_id::MACRO_NEW_BOT_ID);
    assert_eq!(found.surfaces, [Surface::Email, Surface::Tasks]);
    assert_eq!(found.kept, 0);

    repo.add(&a, session, &catalog("email_tags"), Utc::now())
        .await
        .unwrap();
    repo.add(&a, session, &drafted(), Utc::now()).await.unwrap();
    assert_eq!(repo.session(session).await.unwrap().unwrap().kept, 2);

    let stale = repo.stale_sessions(Utc::now(), 10).await.unwrap();
    assert_eq!(
        stale.iter().map(|s| s.session).collect::<Vec<_>>(),
        [session]
    );
    repo.close_session(session).await.unwrap();
    assert_eq!(repo.session(session).await.unwrap(), None);
    assert!(
        repo.stale_sessions(Utc::now(), 10)
            .await
            .unwrap()
            .is_empty()
    );
    assert_eq!(repo.session(Uuid::now_v7()).await.unwrap(), None);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn suggestions_round_trip_and_dismissals_and_saves_are_the_persons(pool: PgPool) {
    insert_user(&pool, USER_A).await;
    insert_user(&pool, USER_B).await;
    let repo = PgSuggestionRepo::new(pool.clone());
    let (a, b) = (user(USER_A), user(USER_B));
    let session = Uuid::now_v7();
    repo.open_session(
        session,
        &a,
        bot_id::MACRO_NEW_BOT_ID,
        &[Surface::Email],
        Utc::now(),
    )
    .await
    .unwrap();
    let picked = repo
        .add(&a, session, &catalog("email_tags"), Utc::now())
        .await
        .unwrap();
    let written = repo.add(&a, session, &drafted(), Utc::now()).await.unwrap();

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
    assert!(stored[0].dismissed && !stored[1].dismissed);

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
