use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;
use crate::domain::model::{ChangeAction, RunMode};

/// A person who can own ideas.
pub(crate) async fn insert_user(pool: &PgPool, id: &str) {
    let macro_user_id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO macro_user (id, username, email, stripe_customer_id) VALUES ($1, $2, $2, $2)"#,
        macro_user_id,
        id,
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO "User" (id, email, macro_user_id) VALUES ($1, $1, $2)"#,
        id,
        macro_user_id,
    )
    .execute(pool)
    .await
    .unwrap();
}

const OWNER: &str = "macro|ideas-repo@macro.com";

async fn generation(pool: &PgPool) -> Uuid {
    let id = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO suggestion_generation (id, user_id, trigger, status, started_at)
           VALUES ($1, $2, 'onboarding', 'generating', now())"#,
        id,
        OWNER,
    )
    .execute(pool)
    .await
    .unwrap();
    id
}

fn content(key: &str) -> IdeaContent {
    IdeaContent {
        dedup_key: key.to_owned(),
        title: "Compare quotes".to_owned(),
        summary: "Three arrived.".to_owned(),
        importance: 50,
        categories: Vec::new(),
        about: Vec::new(),
        prompt: Some("Compare them.".to_owned()),
        sends: None,
    }
}

/// Concurrent writes can't pass the limits together: the person's writes
/// queue on one lock.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_creates_stay_within_the_limits(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let generation = generation(&pool).await;
    let repo = std::sync::Arc::new(PgIdeaRepo::new(pool));
    let user = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    let limits = Limits {
        open: 30,
        new_per_generation: 3,
    };
    let writes = (0..8).map(|n| {
        let repo = std::sync::Arc::clone(&repo);
        let user = user.clone();
        async move {
            let change = Change {
                session: Uuid::now_v7(),
                generation,
                action: ChangeAction::Created,
                old: None,
                new: None,
                reason: None,
                at: Utc::now(),
            };
            repo.create(
                &user,
                Uuid::now_v7(),
                &NewKind::Prompt {
                    run_mode: RunMode::Composer,
                },
                &content(&format!("idea:{n}")),
                limits,
                &change,
            )
            .await
            .unwrap()
        }
    });
    let written = futures::future::join_all(writes).await;
    assert_eq!(
        written.iter().filter(|w| **w == Written::Applied).count(),
        3
    );
    assert_eq!(repo.added_in(generation).await.unwrap(), 3);
    assert_eq!(repo.for_review(&user, 60).await.unwrap().len(), 3);
}

async fn routine_idea(pool: &PgPool) -> (Uuid, Uuid) {
    let suggestion = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO routine_suggestion
             (id, user_id, session_id, surfaces, catalog_key, reason, keep_probability, created_at)
           VALUES ($1, $2, $3, '{email}', 'inbox-digest', 'Busy inbox.', 0.5, now())"#,
        suggestion,
        OWNER,
        Uuid::now_v7(),
    )
    .execute(pool)
    .await
    .unwrap();
    let idea = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO idea (id, user_id, kind, dedup_key, title, summary, importance,
                             categories, state, session_id, created_at, updated_at, state_changed_at)
           VALUES ($1, $2, 'routine', 'routine:inbox', 'Inbox digest', 'Busy inbox.', 50,
                   '{}', 'proposed', $3, now(), now(), now())"#,
        idea,
        OWNER,
        Uuid::now_v7(),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO idea_routine (idea_id, routine_suggestion_id) VALUES ($1, $2)",
        idea,
        suggestion,
    )
    .execute(pool)
    .await
    .unwrap();
    (idea, suggestion)
}

/// Deleting a routine suggestion, by any code, deletes its idea, so the
/// person never holds an idea without its kind's row.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_routine_suggestion_deletes_its_idea(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let (idea, suggestion) = routine_idea(&pool).await;
    sqlx::query!("DELETE FROM routine_suggestion WHERE id = $1", suggestion)
        .execute(&pool)
        .await
        .unwrap();
    let left = sqlx::query_scalar!(r#"SELECT count(*) AS "n!" FROM idea WHERE id = $1"#, idea)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0);
}

/// A row that doesn't decode is skipped, so the person's other ideas still
/// read.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_broken_idea_row_is_skipped_and_the_rest_read(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let (idea, _) = routine_idea(&pool).await;
    let broken = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO idea (id, user_id, kind, dedup_key, title, summary, importance,
                             categories, state, session_id, created_at, updated_at, state_changed_at)
           VALUES ($1, $2, 'prompt', 'prompt:broken', 'Broken', 'No prompt row.', 50,
                   '{}', 'proposed', $3, now(), now(), now())"#,
        broken,
        OWNER,
        Uuid::now_v7(),
    )
    .execute(&pool)
    .await
    .unwrap();
    let repo = PgIdeaRepo::new(pool);
    let user = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    let ideas = repo.for_review(&user, 60).await.unwrap();
    assert_eq!(
        ideas.iter().map(|idea| idea.id).collect::<Vec<_>>(),
        vec![idea]
    );
    assert!(repo.idea(&user, broken).await.unwrap().is_none());
}

/// The feed reads open ideas and those done lately; a review reads open
/// ideas and only the most recently closed.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reads_load_only_the_ideas_they_show(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let generation = generation(&pool).await;
    let repo = PgIdeaRepo::new(pool);
    let user = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    let limits = Limits {
        open: 30,
        new_per_generation: 12,
    };
    let now = Utc::now();
    let mut ids = Vec::new();
    for n in 0..5 {
        let id = Uuid::now_v7();
        let change = Change {
            session: Uuid::now_v7(),
            generation,
            action: ChangeAction::Created,
            old: None,
            new: None,
            reason: None,
            at: now,
        };
        repo.create(
            &user,
            id,
            &NewKind::Prompt {
                run_mode: RunMode::Composer,
            },
            &content(&format!("idea:{n}")),
            limits,
            &change,
        )
        .await
        .unwrap();
        ids.push(id);
    }
    let hours = chrono::TimeDelta::hours;
    // Done two days ago, done an hour ago, dismissed an hour ago; two open.
    for (id, to, at) in [
        (ids[0], IdeaState::Done, now - hours(48)),
        (ids[1], IdeaState::Done, now - hours(1)),
        (ids[2], IdeaState::Dismissed, now - hours(2)),
    ] {
        assert!(
            repo.set_state(&user, id, &[IdeaState::Proposed], to, None, at)
                .await
                .unwrap()
        );
    }
    let mut shown: Vec<Uuid> = repo
        .shown(&user, now - hours(24))
        .await
        .unwrap()
        .iter()
        .map(|idea| idea.id)
        .collect();
    shown.sort();
    assert_eq!(shown, vec![ids[1], ids[3], ids[4]]);
    let mut reviewed: Vec<Uuid> = repo
        .for_review(&user, 1)
        .await
        .unwrap()
        .iter()
        .map(|idea| idea.id)
        .collect();
    reviewed.sort();
    assert_eq!(reviewed, vec![ids[1], ids[3], ids[4]]);
    assert_eq!(repo.for_review(&user, 60).await.unwrap().len(), 5);
    assert_eq!(
        repo.by_dedup_key(&user, "idea:2")
            .await
            .unwrap()
            .map(|idea| idea.id),
        Some(ids[2])
    );
}

async fn idea_about_document(pool: &PgPool, user: &str, document: &str) -> Uuid {
    let idea = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO idea (id, user_id, kind, dedup_key, title, summary, importance,
                             categories, state, session_id, created_at, updated_at, state_changed_at)
           VALUES ($1, $2, 'entity', 'doc:review', 'Review the plan', 'It changed.', 50,
                   '{}', 'proposed', $3, now(), now(), now())"#,
        idea,
        user,
        Uuid::now_v7(),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO idea_entity (idea_id, action) VALUES ($1, 'review')",
        idea
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO idea_target (idea_id, role, position, entity_type, entity_id)
           VALUES ($1, 'about', 0, 'document', $2)"#,
        idea,
        document,
    )
    .execute(pool)
    .await
    .unwrap();
    idea
}

/// An idea row that doesn't decode is skipped, so the item's other ideas
/// still resolve.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_broken_row_about_an_item_is_skipped_and_the_rest_found(pool: PgPool) {
    const LEGACY: &str = "not a macro user id";
    insert_user(&pool, OWNER).await;
    insert_user(&pool, LEGACY).await;
    let document = Uuid::now_v7().to_string();
    let good = idea_about_document(&pool, OWNER, &document).await;
    idea_about_document(&pool, LEGACY, &document).await;
    let found = PgIdeaRepo::new(pool)
        .open_about(EntityType::Document, &document)
        .await
        .unwrap();
    assert_eq!(
        found.iter().map(|target| target.idea).collect::<Vec<_>>(),
        vec![good]
    );
}

/// Unsettled runs come least recently checked first, so runs that keep
/// waiting never hide the others from a small batch.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn unsettled_runs_take_turns(pool: PgPool) {
    use crate::domain::model::StoredRun;
    insert_user(&pool, OWNER).await;
    let generation = generation(&pool).await;
    let repo = PgIdeaRepo::new(pool);
    let user = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    let limits = Limits {
        open: 30,
        new_per_generation: 10,
    };
    let mut sessions = Vec::new();
    for n in 0..2 {
        let idea = Uuid::now_v7();
        let change = Change {
            session: Uuid::now_v7(),
            generation,
            action: ChangeAction::Created,
            old: None,
            new: None,
            reason: None,
            at: Utc::now(),
        };
        repo.create(
            &user,
            idea,
            &NewKind::Prompt {
                run_mode: RunMode::Background,
            },
            &content(&format!("idea:{n}")),
            limits,
            &change,
        )
        .await
        .unwrap();
        let run = StoredRun {
            session: Uuid::now_v7(),
            idea,
            user: user.clone(),
            agent: Uuid::now_v7(),
            action: Uuid::now_v7(),
            started_at: Utc::now() - chrono::Duration::minutes(10 - n),
            settled: None,
        };
        let shown = repo.idea(&user, idea).await.unwrap().unwrap().updated_at;
        assert!(repo.start_run(&run, shown).await.unwrap());
        sessions.push(run.session);
    }
    let first = repo.unsettled_runs(1).await.unwrap();
    assert_eq!(first[0].session, sessions[0]);
    repo.checked_run(sessions[0], Utc::now()).await.unwrap();
    let next = repo.unsettled_runs(1).await.unwrap();
    assert_eq!(next[0].session, sessions[1]);
}
