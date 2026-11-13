use macro_db_migrator::MACRO_DB_MIGRATIONS;

use super::*;
use crate::domain::model::{ChangeAction, RunMode};

mod lifecycle;
mod runs;

/// A person who can own suggestions.
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

const OWNER: &str = "macro|suggestions-repo@macro.com";

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

fn content(key: &str) -> SuggestionContent {
    SuggestionContent {
        dedup_key: key.to_owned(),
        title: "Compare quotes".to_owned(),
        summary: "Three arrived.".to_owned(),
        importance: 50,
        categories: Vec::new(),
        about: Vec::new(),
        prompt: Some("Compare them.".to_owned()),
        sends: None,
        waiting: None,
    }
}

/// Concurrent writes can't pass the limits together: the person's writes
/// queue on one lock.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn concurrent_creates_stay_within_the_limits(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let generation = generation(&pool).await;
    let repo = std::sync::Arc::new(PgSuggestionRepo::new(pool));
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
                &content(&format!("suggestion:{n}")),
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

async fn routine_card(pool: &PgPool) -> (Uuid, Uuid) {
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
    let card = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO suggestion (id, user_id, kind, dedup_key, title, summary, importance,
                             categories, state, session_id, created_at, updated_at, state_changed_at)
           VALUES ($1, $2, 'routine', 'routine:inbox', 'Inbox digest', 'Busy inbox.', 50,
                   '{}', 'proposed', $3, now(), now(), now())"#,
        card,
        OWNER,
        Uuid::now_v7(),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO suggestion_routine (suggestion_id, routine_suggestion_id) VALUES ($1, $2)",
        card,
        suggestion,
    )
    .execute(pool)
    .await
    .unwrap();
    (card, suggestion)
}

/// Deleting a routine suggestion, by any code, deletes its suggestion, so the
/// person never holds a suggestion without its kind's row.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn deleting_a_routine_suggestion_deletes_its_suggestion(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let (card, suggestion) = routine_card(&pool).await;
    sqlx::query!("DELETE FROM routine_suggestion WHERE id = $1", suggestion)
        .execute(&pool)
        .await
        .unwrap();
    let left = sqlx::query_scalar!(
        r#"SELECT count(*) AS "n!" FROM suggestion WHERE id = $1"#,
        card
    )
    .fetch_one(&pool)
    .await
    .unwrap();
    assert_eq!(left, 0);
}

/// A row that doesn't decode is skipped, so the person's other suggestions still
/// read.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_broken_suggestion_row_is_skipped_and_the_rest_read(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let (suggestion, _) = routine_card(&pool).await;
    let broken = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO suggestion (id, user_id, kind, dedup_key, title, summary, importance,
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
    let repo = PgSuggestionRepo::new(pool);
    let user = MacroUserIdStr::parse_from_str(OWNER).unwrap();
    let suggestions = repo.for_review(&user, 60).await.unwrap();
    assert_eq!(
        suggestions
            .iter()
            .map(|suggestion| suggestion.id)
            .collect::<Vec<_>>(),
        vec![suggestion]
    );
    assert!(repo.suggestion(&user, broken).await.unwrap().is_none());
}

/// The feed reads open suggestions and those done lately; a review reads open
/// suggestions and only the most recently closed.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reads_load_only_the_suggestions_they_show(pool: PgPool) {
    insert_user(&pool, OWNER).await;
    let generation = generation(&pool).await;
    let repo = PgSuggestionRepo::new(pool);
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
            &content(&format!("suggestion:{n}")),
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
        (ids[0], SuggestionState::Done, now - hours(48)),
        (ids[1], SuggestionState::Done, now - hours(1)),
        (ids[2], SuggestionState::Dismissed, now - hours(2)),
    ] {
        assert!(
            repo.set_state(&user, id, &[SuggestionState::Proposed], to, None, at)
                .await
                .unwrap()
        );
    }
    let mut shown: Vec<Uuid> = repo
        .shown(&user, now - hours(24))
        .await
        .unwrap()
        .iter()
        .map(|suggestion| suggestion.id)
        .collect();
    shown.sort();
    assert_eq!(shown, vec![ids[1], ids[3], ids[4]]);
    let mut reviewed: Vec<Uuid> = repo
        .for_review(&user, 1)
        .await
        .unwrap()
        .iter()
        .map(|suggestion| suggestion.id)
        .collect();
    reviewed.sort();
    assert_eq!(reviewed, vec![ids[1], ids[3], ids[4]]);
    assert_eq!(repo.for_review(&user, 60).await.unwrap().len(), 5);
    assert_eq!(
        repo.by_dedup_key(&user, "suggestion:2")
            .await
            .unwrap()
            .map(|suggestion| suggestion.id),
        Some(ids[2])
    );
}

async fn suggestion_about_document(pool: &PgPool, user: &str, document: &str) -> Uuid {
    let suggestion = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO suggestion (id, user_id, kind, dedup_key, title, summary, importance,
                             categories, state, session_id, created_at, updated_at, state_changed_at)
           VALUES ($1, $2, 'entity', 'doc:review', 'Review the plan', 'It changed.', 50,
                   '{}', 'proposed', $3, now(), now(), now())"#,
        suggestion,
        user,
        Uuid::now_v7(),
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        "INSERT INTO suggestion_entity (suggestion_id, action) VALUES ($1, 'review')",
        suggestion
    )
    .execute(pool)
    .await
    .unwrap();
    sqlx::query!(
        r#"INSERT INTO suggestion_target (suggestion_id, role, position, entity_type, entity_id)
           VALUES ($1, 'about', 0, 'document', $2)"#,
        suggestion,
        document,
    )
    .execute(pool)
    .await
    .unwrap();
    suggestion
}

/// A suggestion row that doesn't decode is skipped, so the item's other suggestions
/// still resolve.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_broken_row_about_an_item_is_skipped_and_the_rest_found(pool: PgPool) {
    const LEGACY: &str = "not a macro user id";
    insert_user(&pool, OWNER).await;
    insert_user(&pool, LEGACY).await;
    let document = Uuid::now_v7().to_string();
    let good = suggestion_about_document(&pool, OWNER, &document).await;
    suggestion_about_document(&pool, LEGACY, &document).await;
    let found = PgSuggestionRepo::new(pool)
        .open_about(EntityType::Document, &document)
        .await
        .unwrap();
    assert_eq!(
        found
            .iter()
            .map(|target| target.suggestion)
            .collect::<Vec<_>>(),
        vec![good]
    );
}

/// Limits no fixture reaches.
const NO_LIMITS: Limits = Limits {
    open: 1000,
    new_per_generation: 1000,
};

/// A person's suggestions in a fresh database.
struct Fixture {
    pool: PgPool,
    repo: PgSuggestionRepo,
    user: MacroUserIdStr<'static>,
    generation: Uuid,
}

async fn fixture(pool: PgPool) -> Fixture {
    insert_user(&pool, OWNER).await;
    let generation = generation(&pool).await;
    Fixture {
        repo: PgSuggestionRepo::new(pool.clone()),
        pool,
        user: MacroUserIdStr::parse_from_str(OWNER).unwrap(),
        generation,
    }
}

impl Fixture {
    fn change(&self, action: ChangeAction) -> Change {
        Change {
            session: Uuid::now_v7(),
            generation: self.generation,
            action,
            old: None,
            new: None,
            reason: None,
            at: Utc::now(),
        }
    }

    /// A new proposed background prompt suggestion, sending what `sends` says.
    async fn prompt(&self, sends: Option<&str>) -> Uuid {
        let id = Uuid::now_v7();
        let mut content = content(&format!("prompt:{id}"));
        content.sends = sends.map(str::to_owned);
        let written = self
            .repo
            .create(
                &self.user,
                id,
                &NewKind::Prompt {
                    run_mode: RunMode::Background,
                },
                &content,
                NO_LIMITS,
                &self.change(ChangeAction::Created),
            )
            .await
            .unwrap();
        assert_eq!(written, Written::Applied);
        id
    }

    /// A background prompt suggestion in `state`.
    async fn prompt_in(&self, state: SuggestionState) -> Uuid {
        let id = self.prompt(None).await;
        self.force(id, state).await;
        id
    }

    /// Put suggestion `id` in `state`, whatever its lifecycle says.
    async fn force(&self, id: Uuid, state: SuggestionState) {
        sqlx::query!(
            r#"UPDATE suggestion
               SET state = $2, state_reason = CASE WHEN $2 = 'resolved' THEN 'replied' END
               WHERE id = $1"#,
            id,
            state.as_ref(),
        )
        .execute(&self.pool)
        .await
        .unwrap();
    }

    async fn suggestion(&self, id: Uuid) -> Suggestion {
        self.repo.suggestion(&self.user, id).await.unwrap().unwrap()
    }

    async fn state(&self, id: Uuid) -> SuggestionState {
        self.suggestion(id).await.state
    }

    /// A run of suggestion `id`, starting now, sending what `sends` says.
    fn run_of(&self, id: Uuid, sends: Option<&str>) -> StoredRun {
        let now = Utc::now();
        StoredRun {
            session: Uuid::now_v7(),
            suggestion: id,
            user: self.user.clone(),
            agent: Uuid::now_v7(),
            action: Uuid::now_v7(),
            started_at: now,
            state: RunState::Starting,
            state_changed_at: now,
            sends: sends.map(str::to_owned),
        }
    }

    /// Start a run of suggestion `id` as it is now; the run when it started.
    async fn start(&self, id: Uuid) -> Option<StoredRun> {
        let run = self.run_of(id, None);
        let shown = self.suggestion(id).await.updated_at;
        self.repo
            .start_run(&run, shown)
            .await
            .unwrap()
            .then_some(run)
    }
}
