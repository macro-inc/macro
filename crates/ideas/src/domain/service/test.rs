use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use feature_flags::outbound::fake::FakeFeatureFlags;
use feature_flags::{FlagSnapshot, FlagValue};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_entity::EntityType;
use sqlx::PgPool;

use super::*;
use crate::domain::model::{Category, EntityAction, RunMode};
use crate::outbound::pg_idea_repo::PgIdeaRepo;

pub(crate) const OWNER: &str = "macro|ideas-owner@macro.com";
const OTHER: &str = "macro|ideas-other@macro.com";

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

/// Items the person can open: all but those named in `denied`.
#[derive(Default)]
pub(crate) struct FakeAccess {
    denied: Mutex<HashSet<String>>,
}

impl IdeaAccess for FakeAccess {
    type Err = std::convert::Infallible;

    async fn can_view(&self, _: &MacroUserIdStr<'_>, target: &Target) -> Result<bool, Self::Err> {
        Ok(!self.denied.lock().unwrap().contains(&target.entity_id))
    }
}

/// Unsent email drafts: draft → (whose own inbox it is in, its thread).
#[derive(Default)]
pub(crate) struct FakeDrafts(Mutex<HashMap<Uuid, (&'static str, Uuid)>>);

impl FakeDrafts {
    /// A new draft of `owner`'s in `thread`.
    fn write(&self, owner: &'static str, thread: Uuid) -> Uuid {
        let draft = Uuid::now_v7();
        self.0.lock().unwrap().insert(draft, (owner, thread));
        draft
    }
}

impl IdeaDrafts for FakeDrafts {
    type Err = std::convert::Infallible;

    async fn email_draft_thread(
        &self,
        user: &MacroUserIdStr<'_>,
        draft: Uuid,
    ) -> Result<Option<Uuid>, Self::Err> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .get(&draft)
            .filter(|(owner, _)| *owner == user.as_ref())
            .map(|(_, thread)| *thread))
    }
}

/// A request's code-mode invocation id is its session's id.
struct SameSession;

#[async_trait::async_trait]
impl RequestSessions for SameSession {
    async fn session_of(&self, correlation: Uuid) -> Result<Option<Uuid>, rootcause::Report> {
        Ok(Some(correlation))
    }
}

/// Generation sessions as their rows in the database say, as the
/// generation crate's adapter reads them.
struct RowSessions(PgPool);

#[async_trait::async_trait]
impl GenerationSessions for RowSessions {
    async fn open_session(
        &self,
        session: Uuid,
    ) -> Result<Option<GenerationSession>, rootcause::Report> {
        let row = sqlx::query!(
            r#"SELECT session_id, generation_id, user_id, kind FROM suggestion_generation_session
               WHERE session_id = $1 AND closed_at IS NULL"#,
            session,
        )
        .fetch_optional(&self.0)
        .await
        .unwrap();
        Ok(row.map(|row| GenerationSession {
            session: row.session_id,
            generation: row.generation_id,
            user: MacroUserIdStr::try_from(row.user_id).unwrap(),
            kind: row.kind.parse().unwrap(),
            surfaces: Vec::new(),
        }))
    }
}

/// Who read their feed, in which zone.
#[derive(Default)]
struct FakeAudience(Mutex<Vec<(String, String)>>);

#[async_trait::async_trait]
impl SuggestionAudience for FakeAudience {
    async fn seen(
        &self,
        user: &MacroUserIdStr<'_>,
        timezone: &str,
        _: chrono::DateTime<Utc>,
    ) -> Result<(), rootcause::Report> {
        self.0
            .lock()
            .unwrap()
            .push((user.as_ref().to_owned(), timezone.to_owned()));
        Ok(())
    }
}

/// Routine suggestions dismissed through the port.
#[derive(Default)]
struct FakeDismissal(Mutex<Vec<Uuid>>);

#[async_trait::async_trait]
impl RoutineSuggestionDismissal for FakeDismissal {
    async fn dismiss_suggestion(
        &self,
        _: &MacroUserIdStr<'static>,
        suggestion: Uuid,
    ) -> Result<bool, rootcause::Report> {
        self.0.lock().unwrap().push(suggestion);
        Ok(true)
    }
}

pub(crate) type Service = IdeaService<PgIdeaRepo, FakeAccess, FakeDrafts, FakeFeatureFlags>;

pub(crate) struct Harness {
    pub(crate) service: Service,
    access: Arc<FakeAccess>,
    drafts: Arc<FakeDrafts>,
    audience: Arc<FakeAudience>,
    dismissal: Arc<FakeDismissal>,
    pool: PgPool,
}

pub(crate) async fn harness(pool: PgPool, flag: bool) -> Harness {
    for id in [OWNER, OTHER] {
        crate::outbound::pg_idea_repo::test::insert_user(&pool, id).await;
    }
    let mut flags = FakeFeatureFlags::default();
    for id in [OWNER, OTHER] {
        flags.set(
            user(id),
            Ok(FlagSnapshot::new([(
                IDEAS_FLAG.to_owned(),
                FlagValue::Boolean(flag),
            )])),
        );
    }
    let access = Arc::new(FakeAccess::default());
    let drafts = Arc::new(FakeDrafts::default());
    let audience = Arc::new(FakeAudience::default());
    let dismissal = Arc::new(FakeDismissal::default());
    Harness {
        service: IdeaService::new(
            Arc::new(PgIdeaRepo::new(pool.clone())),
            Arc::clone(&access),
            Arc::clone(&drafts),
            Arc::new(SameSession),
            Arc::new(RowSessions(pool.clone())),
            audience.clone(),
            dismissal.clone(),
            Some(flags),
        ),
        access,
        drafts,
        audience,
        dismissal,
        pool,
    }
}

fn principal(id: &'static str) -> CreationPrincipal {
    CreationPrincipal::User(user(id))
}

fn prompt_idea(key: &str, title: &str) -> SuggestIdea {
    SuggestIdea {
        kind: KindName::Prompt,
        dedup_key: key.to_owned(),
        title: title.to_owned(),
        summary: "Three supplier quotes arrived this week.".to_owned(),
        importance: 70,
        categories: vec![Category::SaveMoney, Category::SaveMoney],
        about: vec![Target {
            entity_type: EntityType::EmailThread,
            entity_id: "thread-1".to_owned(),
            part_id: None,
        }],
        prompt: Some("Compare the supplier quotes in my inbox and list the cheapest.".to_owned()),
        run_mode: Some(RunMode::Background),
        sends: None,
        action: None,
        reason: None,
    }
}

pub(crate) fn entity_idea(key: &str) -> SuggestIdea {
    SuggestIdea {
        kind: KindName::Entity,
        dedup_key: key.to_owned(),
        title: "Reply to the venue".to_owned(),
        summary: "They asked for a headcount by Friday.".to_owned(),
        importance: 80,
        categories: vec![Category::Important],
        about: vec![Target {
            entity_type: EntityType::EmailThread,
            entity_id: "thread-2".to_owned(),
            part_id: None,
        }],
        prompt: None,
        run_mode: None,
        sends: None,
        action: Some(EntityAction::Reply),
        reason: None,
    }
}

impl Harness {
    /// The latest run of the person's first idea in the feed.
    async fn first_run(&self) -> crate::domain::model::IdeaRun {
        self.service.feed(&user(OWNER), None).await.unwrap().ideas[0]
            .run
            .clone()
            .unwrap()
    }

    /// An open session of `kind` in `owner`'s running generation, started
    /// when none is running.
    pub(crate) async fn session(&self, owner: &str, kind: &str) -> Uuid {
        sqlx::query!(
            r#"INSERT INTO suggestion_generation (id, user_id, trigger, status, started_at)
               VALUES ($1, $2, 'nightly', 'generating', now())
               ON CONFLICT (user_id) WHERE status = 'generating' DO NOTHING"#,
            Uuid::now_v7(),
            owner,
        )
        .execute(&self.pool)
        .await
        .unwrap();
        let generation = sqlx::query_scalar!(
            "SELECT id FROM suggestion_generation WHERE user_id = $1 AND status = 'generating'",
            owner,
        )
        .fetch_one(&self.pool)
        .await
        .unwrap();
        let session = Uuid::now_v7();
        sqlx::query!(
            r#"INSERT INTO suggestion_generation_session
                 (session_id, generation_id, user_id, agent_id, kind, opened_at)
               VALUES ($1, $2, $3, 'agent', $4, now())"#,
            session,
            generation,
            owner,
            kind,
        )
        .execute(&self.pool)
        .await
        .unwrap();
        session
    }

    async fn close(&self, session: Uuid) {
        sqlx::query!(
            "UPDATE suggestion_generation_session SET closed_at = now() WHERE session_id = $1",
            session,
        )
        .execute(&self.pool)
        .await
        .unwrap();
        sqlx::query!(
            r#"UPDATE suggestion_generation SET status = 'ready'
               WHERE id = (SELECT generation_id FROM suggestion_generation_session WHERE session_id = $1)"#,
            session,
        )
        .execute(&self.pool)
        .await
        .unwrap();
    }

    pub(crate) async fn suggest(&self, session: Uuid, request: SuggestIdea) -> IdeaWriteOutcome {
        self.service
            .suggest(&principal(OWNER), Some(session), request)
            .await
            .unwrap()
    }

    async fn changes(&self, idea: Uuid) -> Vec<(String, Option<String>)> {
        sqlx::query!(
            "SELECT action, reason FROM suggestion_change WHERE subject_id = $1 ORDER BY created_at, id",
            idea,
        )
        .fetch_all(&self.pool)
        .await
        .unwrap()
        .into_iter()
        .map(|row| (row.action, row.reason))
        .collect()
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_ideas_session_adds_an_idea_the_person_sees(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "ideas").await;
    let mut request = prompt_idea("quotes:compare", "Compare the supplier quotes");
    request.reason = Some("Three quotes for the same order".to_owned());
    let outcome = h.suggest(session, request).await;
    assert!(outcome.ok, "{:?}", outcome.problems);
    let idea = outcome.idea.unwrap();
    assert_eq!(idea.state, IdeaState::Proposed);
    assert_eq!(idea.categories, vec![Category::SaveMoney]);
    assert_eq!(
        idea.kind,
        IdeaKind::Prompt {
            prompt: "Compare the supplier quotes in my inbox and list the cheapest.".to_owned(),
            run_mode: RunMode::Background,
            sends: None,
        }
    );
    assert_eq!(
        h.changes(idea.id).await,
        vec![(
            "created".to_owned(),
            Some("Three quotes for the same order".to_owned())
        )]
    );
    let feed = h
        .service
        .feed(&user(OWNER), Some(chrono_tz::Europe::Paris))
        .await
        .unwrap();
    assert_eq!(feed.ideas, vec![idea]);
    assert_eq!(
        *h.audience.0.lock().unwrap(),
        vec![(OWNER.to_owned(), "Europe/Paris".to_owned())]
    );
    assert!(
        h.service
            .feed(&user(OTHER), None)
            .await
            .unwrap()
            .ideas
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_the_persons_open_ideas_session_may_write(pool: PgPool) {
    let h = harness(pool, true).await;
    let ideas = h.session(OWNER, "ideas").await;
    let routines = h.session(OWNER, "routines").await;
    let others = h.session(OTHER, "ideas").await;
    let refused = |result: Result<IdeaWriteOutcome, IdeaError>| {
        assert!(
            matches!(result, Err(IdeaError::NotGenerating)),
            "{result:?}"
        );
    };
    let request = || prompt_idea("quotes:compare", "Compare the supplier quotes");
    refused(h.service.suggest(&principal(OWNER), None, request()).await);
    refused(
        h.service
            .suggest(&principal(OWNER), Some(routines), request())
            .await,
    );
    refused(
        h.service
            .suggest(&principal(OWNER), Some(others), request())
            .await,
    );
    refused(
        h.service
            .suggest(&principal(OWNER), Some(Uuid::now_v7()), request())
            .await,
    );
    h.close(ideas).await;
    refused(
        h.service
            .suggest(&principal(OWNER), Some(ideas), request())
            .await,
    );
    assert!(matches!(
        h.service.review(&principal(OWNER), Some(ideas)).await,
        Err(IdeaError::NotGenerating)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn ideas_are_off_without_the_flag(pool: PgPool) {
    let h = harness(pool, false).await;
    let session = h.session(OWNER, "ideas").await;
    assert!(matches!(
        h.service
            .suggest(
                &principal(OWNER),
                Some(session),
                prompt_idea("a", "Compare quotes")
            )
            .await,
        Err(IdeaError::NotFound)
    ));
    assert!(matches!(
        h.service.feed(&user(OWNER), None).await,
        Err(IdeaError::NotFound)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_same_dedup_key_updates_the_idea_and_its_kind_never_changes(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "ideas").await;
    let first = h
        .suggest(
            session,
            prompt_idea("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .idea
        .unwrap();
    let second = h
        .suggest(
            session,
            prompt_idea("quotes:compare", "Pick the cheapest supplier"),
        )
        .await;
    assert!(second.ok, "{:?}", second.problems);
    let second = second.idea.unwrap();
    assert_eq!(second.id, first.id);
    assert_eq!(second.title, "Pick the cheapest supplier");
    assert_eq!(
        h.service
            .feed(&user(OWNER), None)
            .await
            .unwrap()
            .ideas
            .len(),
        1
    );
    let as_entity = h.suggest(session, entity_idea("quotes:compare")).await;
    assert!(!as_entity.ok);
    assert!(
        as_entity.problems[0].contains("kind never changes"),
        "{:?}",
        as_entity.problems
    );
    let mut composer = prompt_idea("quotes:compare", "Compare quotes");
    composer.run_mode = Some(RunMode::Composer);
    assert!(!h.suggest(session, composer).await.ok);
    let actions: Vec<String> = h
        .changes(first.id)
        .await
        .into_iter()
        .map(|(a, _)| a)
        .collect();
    assert_eq!(actions, vec!["created", "rewritten"]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_dismissed_idea_comes_back_only_with_a_reason(pool: PgPool) {
    let h = harness(pool, true).await;
    let night = h.session(OWNER, "ideas").await;
    let idea = h
        .suggest(night, entity_idea("venue:headcount"))
        .await
        .idea
        .unwrap();
    h.service.dismiss(&user(OWNER), idea.id).await.unwrap();
    assert!(
        h.service
            .feed(&user(OWNER), None)
            .await
            .unwrap()
            .ideas
            .is_empty()
    );
    h.close(night).await;
    let next = h.session(OWNER, "ideas").await;
    let review = h
        .service
        .review(&principal(OWNER), Some(next))
        .await
        .unwrap();
    assert_eq!(review.ideas[0].state, IdeaState::Dismissed);
    let again = h.suggest(next, entity_idea("venue:headcount")).await;
    assert!(!again.ok);
    assert!(
        again.problems[0].contains("dismissed"),
        "{:?}",
        again.problems
    );
    let mut with_reason = entity_idea("venue:headcount");
    with_reason.reason = Some("The venue wrote again with a new deadline".to_owned());
    let back = h.suggest(next, with_reason).await;
    assert!(back.ok, "{:?}", back.problems);
    assert_eq!(back.idea.unwrap().state, IdeaState::Proposed);
    assert_eq!(
        h.changes(idea.id).await.last().unwrap(),
        &(
            "restored".to_owned(),
            Some("The venue wrote again with a new deadline".to_owned())
        )
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_session_rewrites_and_retires_open_ideas_and_a_retired_one_comes_back(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "ideas").await;
    let idea = h
        .suggest(
            session,
            prompt_idea("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .idea
        .unwrap();
    let rewritten = h
        .service
        .rewrite(
            &principal(OWNER),
            Some(session),
            idea.id,
            RewriteIdea {
                importance: Some(20),
                categories: Some(vec![Category::Revisit]),
                reason: "The order is weeks away".to_owned(),
                ..RewriteIdea::default()
            },
        )
        .await
        .unwrap();
    assert!(rewritten.ok, "{:?}", rewritten.problems);
    let rewritten = rewritten.idea.unwrap();
    assert_eq!(rewritten.importance, 20);
    assert_eq!(rewritten.title, idea.title);
    let retired = h
        .service
        .retire(
            &principal(OWNER),
            Some(session),
            idea.id,
            RetireIdea {
                reason: "The order was placed".to_owned(),
            },
        )
        .await
        .unwrap();
    assert_eq!(retired.idea.unwrap().state, IdeaState::Retired);
    assert!(
        h.service
            .feed(&user(OWNER), None)
            .await
            .unwrap()
            .ideas
            .is_empty()
    );
    let again = h
        .service
        .rewrite(
            &principal(OWNER),
            Some(session),
            idea.id,
            RewriteIdea {
                importance: Some(90),
                reason: "Still matters".to_owned(),
                ..RewriteIdea::default()
            },
        )
        .await
        .unwrap();
    assert!(!again.ok);
    let back = h
        .suggest(
            session,
            prompt_idea("quotes:compare", "Compare the supplier quotes"),
        )
        .await;
    assert_eq!(back.idea.unwrap().state, IdeaState::Proposed);
    let actions: Vec<String> = h
        .changes(idea.id)
        .await
        .into_iter()
        .map(|(a, _)| a)
        .collect();
    assert_eq!(actions, vec!["created", "rewritten", "retired", "restored"]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_generation_adds_at_most_its_limit_and_a_person_has_at_most_thirty_open(pool: PgPool) {
    let h = harness(pool, true).await;
    let per_night = usize::try_from(NEW_PER_GENERATION).unwrap();
    let open = usize::try_from(OPEN_LIMIT).unwrap();
    let mut kept = Vec::new();
    let mut expected = Vec::new();
    for night in 0..4 {
        let session = h.session(OWNER, "ideas").await;
        let room = open - kept.iter().sum::<usize>();
        expected.push(per_night.min(room));
        let mut tonight = 0;
        for n in 0..=per_night {
            let outcome = h
                .suggest(
                    session,
                    prompt_idea(&format!("idea:{night}:{n}"), "Compare quotes"),
                )
                .await;
            if outcome.ok {
                tonight += 1;
            } else {
                let limit = if n == per_night && room > per_night {
                    "most for one night"
                } else {
                    "30 open ideas"
                };
                assert!(
                    outcome.problems[0].contains(limit),
                    "{:?}",
                    outcome.problems
                );
            }
        }
        kept.push(tonight);
        h.close(session).await;
    }
    assert_eq!(kept, expected);
    assert_eq!(kept.iter().sum::<usize>(), open);
    // Rewriting an open idea at the limit still works.
    let session = h.session(OWNER, "ideas").await;
    let rewrite = h
        .suggest(
            session,
            prompt_idea("idea:0:0", "Compare the supplier quotes"),
        )
        .await;
    assert!(rewrite.ok, "{:?}", rewrite.problems);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn writes_are_checked_before_they_are_kept(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "ideas").await;
    let mut routine = prompt_idea("routine", "Compare quotes");
    routine.kind = KindName::Routine;
    let mut detail = prompt_idea("detail", "Compare quotes");
    detail.summary = format!("Ask {}@{}.com for the quote", "sam", "example");
    let mut no_items = entity_idea("no-items");
    no_items.about.clear();
    let mut bad_key = prompt_idea("Has Spaces", "Compare quotes");
    bad_key.importance = 101;
    for request in [routine, detail, no_items, bad_key] {
        let outcome = h.suggest(session, request).await;
        assert!(!outcome.ok);
        assert!(!outcome.problems.is_empty());
    }
    h.access
        .denied
        .lock()
        .unwrap()
        .insert("thread-1".to_owned());
    let hidden = h
        .suggest(session, prompt_idea("quotes:compare", "Compare quotes"))
        .await;
    assert!(
        hidden.problems[0].contains("can't open"),
        "{:?}",
        hidden.problems
    );
    assert!(
        h.service
            .review(&principal(OWNER), Some(session))
            .await
            .unwrap()
            .ideas
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_feed_hides_ideas_about_items_the_person_lost(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "ideas").await;
    h.suggest(session, prompt_idea("quotes:compare", "Compare quotes"))
        .await;
    h.suggest(session, entity_idea("venue:headcount")).await;
    let feed = h.service.feed(&user(OWNER), None).await.unwrap();
    // Best first.
    assert_eq!(feed.ideas[0].dedup_key, "venue:headcount");
    h.access
        .denied
        .lock()
        .unwrap()
        .insert("thread-2".to_owned());
    let feed = h.service.feed(&user(OWNER), None).await.unwrap();
    assert_eq!(feed.ideas.len(), 1);
    assert_eq!(feed.ideas[0].dedup_key, "quotes:compare");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_person_accepts_and_dismisses_only_their_open_ideas(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "ideas").await;
    let idea = h
        .suggest(session, entity_idea("venue:headcount"))
        .await
        .idea
        .unwrap();
    assert!(matches!(
        h.service.accept(&user(OTHER), idea.id).await,
        Err(IdeaError::NotFound)
    ));
    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    assert!(matches!(
        h.service.accept(&user(OWNER), idea.id).await,
        Err(IdeaError::NotFound)
    ));
    assert_eq!(
        h.service.feed(&user(OWNER), None).await.unwrap().ideas[0].state,
        IdeaState::Accepted
    );
    h.service.dismiss(&user(OWNER), idea.id).await.unwrap();
    assert!(matches!(
        h.service.dismiss(&user(OWNER), idea.id).await,
        Err(IdeaError::NotFound)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_routine_idea_follows_its_suggestion(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "ideas").await;
    let generation = sqlx::query_scalar!(
        "SELECT generation_id FROM suggestion_generation_session WHERE session_id = $1",
        session,
    )
    .fetch_one(&h.pool)
    .await
    .unwrap();
    let suggestion = Uuid::now_v7();
    sqlx::query!(
        r#"INSERT INTO routine_suggestion
             (id, user_id, session_id, surfaces, routine, reason, keep_probability, created_at)
           VALUES ($1, $2, $3, '{tasks}', '{}'::jsonb, 'You plan on Mondays', 0.4, now())"#,
        suggestion,
        OWNER,
        session,
    )
    .execute(&h.pool)
    .await
    .unwrap();
    let mut tx = h.pool.begin().await.unwrap();
    ideas_db_utils::add_routine_idea(
        &mut tx,
        &ideas_db_utils::NewRoutineIdea {
            user: OWNER,
            suggestion,
            title: "Plan the week",
            summary: "You plan on Mondays",
            importance: 40,
            categories: &[],
            session,
            generation,
            at: Utc::now(),
        },
        OPEN_LIMIT,
        NEW_PER_GENERATION,
    )
    .await
    .unwrap();
    tx.commit().await.unwrap();

    let feed = h.service.feed(&user(OWNER), None).await.unwrap();
    let idea = feed.ideas[0].clone();
    assert_eq!(
        idea.kind,
        IdeaKind::Routine {
            routine_suggestion_id: suggestion
        }
    );
    // Sessions never rewrite or retire it here; its suggestion decides.
    let rewrite = h
        .service
        .rewrite(
            &principal(OWNER),
            Some(session),
            idea.id,
            RewriteIdea {
                importance: Some(90),
                reason: "Matters more".to_owned(),
                ..RewriteIdea::default()
            },
        )
        .await
        .unwrap();
    assert!(!rewrite.ok);
    let retire = h
        .service
        .retire(
            &principal(OWNER),
            Some(session),
            idea.id,
            RetireIdea {
                reason: "No longer fits".to_owned(),
            },
        )
        .await
        .unwrap();
    assert!(!retire.ok);
    // The person dismissing it dismisses its suggestion, which closes both.
    h.service.dismiss(&user(OWNER), idea.id).await.unwrap();
    assert_eq!(*h.dismissal.0.lock().unwrap(), [suggestion]);
}

/// How the fake's next start goes.
#[derive(Default, Clone, Copy, PartialEq)]
enum StartsAs {
    #[default]
    Started,
    NotStarted,
    Uncertain,
}

/// Run sessions whose state the test sets, recording what they started and
/// deleted. A session with no state set is missing; one in `unreadable`
/// exists but can't be read.
#[derive(Default)]
struct FakeRuns {
    started: Mutex<Vec<(Uuid, String)>>,
    state: Mutex<HashMap<Uuid, SessionState>>,
    unreadable: Mutex<HashSet<Uuid>>,
    discarded: Mutex<Vec<Uuid>>,
    discard_fails: std::sync::atomic::AtomicBool,
    starts_as: Mutex<StartsAs>,
}

impl FakeRuns {
    fn set(&self, session: Uuid, state: SessionState) {
        self.state.lock().unwrap().insert(session, state);
    }
}

#[async_trait::async_trait]
impl RunSessions for FakeRuns {
    async fn start(&self, run: &StoredRun, prompt: &str) -> Result<(), RunStartError> {
        let starts_as = *self.starts_as.lock().unwrap();
        if starts_as == StartsAs::NotStarted {
            return Err(RunStartError::NotStarted(rootcause::report!(
                "the session didn't open"
            )));
        }
        self.started
            .lock()
            .unwrap()
            .push((run.session, prompt.to_owned()));
        self.set(run.session, SessionState::Running);
        if starts_as == StartsAs::Uncertain {
            return Err(RunStartError::Uncertain(rootcause::report!(
                "the prompt's answer was lost"
            )));
        }
        Ok(())
    }

    async fn state(&self, run: &StoredRun) -> Result<SessionState, SessionReadError> {
        if self.unreadable.lock().unwrap().contains(&run.session) {
            return Err(SessionReadError::Unreadable(rootcause::report!(
                "the session service is down"
            )));
        }
        self.state
            .lock()
            .unwrap()
            .get(&run.session)
            .copied()
            .ok_or(SessionReadError::Missing)
    }

    async fn produced(&self, _: &StoredRun) -> Result<Vec<Target>, rootcause::Report> {
        Ok(vec![Target {
            entity_type: EntityType::Document,
            entity_id: "comparison-doc".to_owned(),
            part_id: None,
        }])
    }

    async fn discard(&self, run: &StoredRun) -> Result<(), rootcause::Report> {
        if self.discard_fails.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(rootcause::report!("the session wasn't deleted"));
        }
        self.discarded.lock().unwrap().push(run.session);
        self.state.lock().unwrap().remove(&run.session);
        Ok(())
    }
}

const RUN_AGENT: Uuid = Uuid::from_u128(0xa2a2);

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn accepting_a_background_prompt_idea_runs_it_and_its_session_finishes_it(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "ideas").await;
    let idea = h
        .suggest(
            session,
            prompt_idea("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .idea
        .unwrap();

    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    let started = runs.started.lock().unwrap().clone();
    assert_eq!(started.len(), 1);
    assert!(
        started[0]
            .1
            .starts_with("Compare the supplier quotes in my inbox and list the cheapest.\n\n"),
        "{}",
        started[0].1
    );
    assert!(started[0].1.contains("never stop to ask"));
    assert!(started[0].1.contains("Post, send or share nothing:"));
    // A run going can't be started twice.
    assert!(matches!(
        h.service.accept(&user(OWNER), idea.id).await,
        Err(IdeaError::NotFound)
    ));
    let run_session = started[0].0;
    let run = h.first_run().await;
    assert_eq!(
        (run.session_id, run.progress),
        (run_session, RunProgress::Running)
    );
    assert_eq!(
        h.service.feed(&user(OWNER), None).await.unwrap().ideas[0].state,
        IdeaState::Accepted
    );

    // Waiting for an approval shows on the idea, for the person to answer.
    runs.set(run_session, SessionState::NeedsApproval);
    assert_eq!(h.first_run().await.progress, RunProgress::NeedsApproval);
    assert_eq!(h.service.settle_runs().await.unwrap(), 0);

    // Once its session finished, the idea is done with what the run made.
    runs.set(run_session, SessionState::Finished);
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
    assert_eq!(h.service.settle_runs().await.unwrap(), 0);
    let done = PgIdeaRepo::new(h.pool.clone())
        .idea(&user(OWNER), idea.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(done.state, IdeaState::Done);
    assert_eq!(
        done.produced,
        [
            Target {
                entity_type: EntityType::AgentSession,
                entity_id: run_session.to_string(),
                part_id: None,
            },
            Target {
                entity_type: EntityType::Document,
                entity_id: "comparison-doc".to_owned(),
                part_id: None,
            },
        ]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_run_is_retried_by_accepting_again(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "ideas").await;
    let idea = h
        .suggest(
            session,
            prompt_idea("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .idea
        .unwrap();
    // A session that never opened leaves the idea to try again.
    *runs.starts_as.lock().unwrap() = StartsAs::NotStarted;
    assert!(matches!(
        h.service.accept(&user(OWNER), idea.id).await,
        Err(IdeaError::Internal(_))
    ));
    *runs.starts_as.lock().unwrap() = StartsAs::Started;
    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    let run_session = runs.started.lock().unwrap()[0].0;
    runs.set(run_session, SessionState::Failed);
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
    let feed = h.service.feed(&user(OWNER), None).await.unwrap();
    assert_eq!(feed.ideas[0].state, IdeaState::Accepted);
    assert_eq!(
        feed.ideas[0].run.as_ref().unwrap().progress,
        RunProgress::Failed
    );
    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    assert_eq!(runs.started.lock().unwrap().len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn accepting_any_other_idea_starts_no_run(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "ideas").await;
    let mut composer = prompt_idea("quotes:compare", "Compare the supplier quotes");
    composer.run_mode = Some(RunMode::Composer);
    let composer = h.suggest(session, composer).await.idea.unwrap();
    let entity = h
        .suggest(session, entity_idea("venue:headcount"))
        .await
        .idea
        .unwrap();
    h.service.accept(&user(OWNER), composer.id).await.unwrap();
    h.service.accept(&user(OWNER), entity.id).await.unwrap();
    assert!(runs.started.lock().unwrap().is_empty());
    assert!(
        h.service
            .feed(&user(OWNER), None)
            .await
            .unwrap()
            .ideas
            .iter()
            .all(|idea| idea.run.is_none())
    );
}

/// Age every run of the test's ideas by `by`, as if started that long ago.
async fn age_runs(pool: &PgPool, by: chrono::Duration) {
    sqlx::query!(
        "UPDATE idea_run SET started_at = started_at - $1::interval",
        sqlx::postgres::types::PgInterval::try_from(by).unwrap(),
    )
    .execute(pool)
    .await
    .unwrap();
}

/// A prompt whose answer was lost may be running: the run stays, no second
/// session starts, and the session settles it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_whose_prompt_may_have_arrived_is_never_started_twice(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "ideas").await;
    let idea = h
        .suggest(
            session,
            prompt_idea("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .idea
        .unwrap();
    *runs.starts_as.lock().unwrap() = StartsAs::Uncertain;
    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    *runs.starts_as.lock().unwrap() = StartsAs::Started;
    assert!(matches!(
        h.service.accept(&user(OWNER), idea.id).await,
        Err(IdeaError::NotFound)
    ));
    assert_eq!(runs.started.lock().unwrap().len(), 1);
    let run_session = runs.started.lock().unwrap()[0].0;
    runs.set(run_session, SessionState::Finished);
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
}

/// A session that never took its prompt is deleted after a while, and the
/// idea may run again.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_whose_prompt_never_arrived_is_given_up_and_runs_again(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "ideas").await;
    let idea = h
        .suggest(
            session,
            prompt_idea("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .idea
        .unwrap();
    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    let run_session = runs.started.lock().unwrap()[0].0;
    runs.set(run_session, SessionState::AwaitingPrompt);
    assert_eq!(h.service.settle_runs().await.unwrap(), 0);
    age_runs(&h.pool, chrono::Duration::minutes(11)).await;
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
    assert_eq!(*runs.discarded.lock().unwrap(), [run_session]);
    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    assert_eq!(runs.started.lock().unwrap().len(), 2);
}

/// A run whose session can't be read is never given up, however long the
/// outage: it may be running, and a retry would start a second session.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_live_run_whose_session_cant_be_read_is_never_given_up(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "ideas").await;
    let idea = h
        .suggest(
            session,
            prompt_idea("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .idea
        .unwrap();
    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    let run_session = runs.started.lock().unwrap()[0].0;
    runs.unreadable.lock().unwrap().insert(run_session);
    age_runs(&h.pool, chrono::Duration::hours(3)).await;
    for _ in 0..20 {
        assert_eq!(h.service.settle_runs().await.unwrap(), 0);
    }
    assert!(matches!(
        h.service.accept(&user(OWNER), idea.id).await,
        Err(IdeaError::NotFound)
    ));
    assert_eq!(runs.started.lock().unwrap().len(), 1);
    // Once it reads again, it settles as its session says.
    runs.unreadable.lock().unwrap().remove(&run_session);
    runs.set(run_session, SessionState::Finished);
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
}

/// A run whose session is confirmed missing (it never opened) is given up
/// once its start window has passed, and the idea may run again.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_whose_session_is_missing_is_given_up_after_its_start_window(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "ideas").await;
    let idea = h
        .suggest(
            session,
            prompt_idea("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .idea
        .unwrap();
    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    let run_session = runs.started.lock().unwrap()[0].0;
    runs.state.lock().unwrap().remove(&run_session);
    // It may still be opening.
    assert_eq!(h.service.settle_runs().await.unwrap(), 0);
    age_runs(&h.pool, chrono::Duration::minutes(11)).await;
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    assert_eq!(runs.started.lock().unwrap().len(), 2);
}

/// A reply idea about email thread `thread`.
fn reply_idea(key: &str, thread: Uuid) -> SuggestIdea {
    let mut idea = entity_idea(key);
    idea.about = vec![Target {
        entity_type: EntityType::EmailThread,
        entity_id: thread.to_string(),
        part_id: None,
    }];
    idea
}

fn attach(draft: Uuid, reason: &str) -> AttachDraft {
    AttachDraft {
        email_draft_id: draft,
        reason: reason.to_owned(),
    }
}

/// `draft` as an idea keeps it: the thread, with the draft as the part.
fn draft_target(thread: Uuid, draft: Uuid) -> Target {
    Target {
        entity_type: EntityType::EmailThread,
        entity_id: thread.to_string(),
        part_id: Some(draft.to_string()),
    }
}

impl Harness {
    async fn attach(&self, session: Uuid, idea: Uuid, request: AttachDraft) -> IdeaWriteOutcome {
        self.service
            .attach_draft(&principal(OWNER), Some(session), idea, request)
            .await
            .unwrap()
    }

    /// The change log's rewrites of `idea`: (old, new, reason).
    async fn rewrites(
        &self,
        idea: Uuid,
    ) -> Vec<(
        Option<serde_json::Value>,
        Option<serde_json::Value>,
        Option<String>,
    )> {
        sqlx::query!(
            r#"SELECT old_value, new_value, reason FROM suggestion_change
               WHERE subject_id = $1 AND action = 'rewritten' ORDER BY created_at, id"#,
            idea,
        )
        .fetch_all(&self.pool)
        .await
        .unwrap()
        .into_iter()
        .map(|row| (row.old_value, row.new_value, row.reason))
        .collect()
    }
}

fn problems(outcome: &IdeaWriteOutcome) -> String {
    assert!(!outcome.ok, "expected a refusal, got {:?}", outcome.idea);
    outcome.problems.join(" | ")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_draft_is_attached_only_to_an_open_reply_idea_in_its_thread(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "ideas").await;
    let thread = Uuid::now_v7();
    let mine = h.drafts.write(OWNER, thread);
    let elsewhere = h.drafts.write(OWNER, Uuid::now_v7());
    let theirs = h.drafts.write(OTHER, thread);

    let prompt = h
        .suggest(session, prompt_idea("quotes:compare", "Compare quotes"))
        .await
        .idea
        .unwrap();
    let mut review = reply_idea("thread:review", thread);
    review.action = Some(EntityAction::Review);
    let review = h.suggest(session, review).await.idea.unwrap();
    for idea in [prompt.id, review.id] {
        let refused = h
            .attach(session, idea, attach(mine, "Drafted the reply"))
            .await;
        assert!(
            problems(&refused).contains("only for an entity idea with action `reply`"),
            "{refused:?}"
        );
    }

    let reply = h
        .suggest(session, reply_idea("thread:reply", thread))
        .await
        .idea
        .unwrap();
    for (draft, problem) in [
        (theirs, "no unsent draft in the user's own inboxes"),
        (Uuid::now_v7(), "no unsent draft in the user's own inboxes"),
        (elsewhere, "another thread than the one this idea is about"),
    ] {
        let refused = h
            .attach(session, reply.id, attach(draft, "Drafted it"))
            .await;
        assert!(problems(&refused).contains(problem), "{refused:?}");
    }
    let refused = h.attach(session, reply.id, attach(mine, "")).await;
    assert!(problems(&refused).contains("`reason`"), "{refused:?}");

    let attached = h
        .attach(
            session,
            reply.id,
            attach(mine, "Drafted the headcount reply"),
        )
        .await;
    assert!(attached.ok, "{:?}", attached.problems);
    let expected = IdeaKind::Entity {
        action: EntityAction::Reply,
        draft: Some(draft_target(thread, mine)),
    };
    assert_eq!(attached.idea.unwrap().kind, expected);
    let feed = h.service.feed(&user(OWNER), None).await.unwrap();
    let shown = feed.ideas.iter().find(|idea| idea.id == reply.id).unwrap();
    assert_eq!(shown.kind, expected);

    let retired = h
        .service
        .retire(
            &principal(OWNER),
            Some(session),
            reply.id,
            RetireIdea {
                reason: "Answered by phone".to_owned(),
            },
        )
        .await
        .unwrap();
    assert!(retired.ok, "{:?}", retired.problems);
    let refused = h.attach(session, reply.id, attach(mine, "Again")).await;
    assert!(problems(&refused).contains("only attached to an open idea"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_new_draft_replaces_the_old_one_and_the_log_keeps_both(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "ideas").await;
    let thread = Uuid::now_v7();
    let first = h.drafts.write(OWNER, thread);
    let second = h.drafts.write(OWNER, thread);
    let reply = h
        .suggest(session, reply_idea("thread:reply", thread))
        .await
        .idea
        .unwrap();

    assert!(
        h.attach(session, reply.id, attach(first, "First take"))
            .await
            .ok
    );
    let replaced = h
        .attach(session, reply.id, attach(second, "Shorter, with the date"))
        .await;
    assert!(replaced.ok, "{:?}", replaced.problems);
    assert_eq!(
        replaced.idea.unwrap().kind,
        IdeaKind::Entity {
            action: EntityAction::Reply,
            draft: Some(draft_target(thread, second)),
        }
    );
    // The same draft again changes nothing.
    assert!(h.attach(session, reply.id, attach(second, "Same")).await.ok);

    let as_json = |draft: Option<Uuid>| {
        Some(serde_json::json!({
            "draft": draft.map(|draft| serde_json::to_value(draft_target(thread, draft)).unwrap())
        }))
    };
    assert_eq!(
        h.rewrites(reply.id).await,
        vec![
            (
                as_json(None),
                as_json(Some(first)),
                Some("First take".to_owned())
            ),
            (
                as_json(Some(first)),
                as_json(Some(second)),
                Some("Shorter, with the date".to_owned())
            ),
        ]
    );
    let drafts = sqlx::query_scalar!(
        r#"SELECT count(*) AS "count!" FROM idea_target WHERE idea_id = $1 AND role = 'draft'"#,
        reply.id,
    )
    .fetch_one(&h.pool)
    .await
    .unwrap();
    assert_eq!(drafts, 1);

    // The idea stays about the thread its draft is in.
    let refused = h
        .service
        .rewrite(
            &principal(OWNER),
            Some(session),
            reply.id,
            RewriteIdea {
                about: Some(vec![Target {
                    entity_type: EntityType::EmailThread,
                    entity_id: Uuid::now_v7().to_string(),
                    part_id: None,
                }]),
                reason: "Another thread".to_owned(),
                ..RewriteIdea::default()
            },
        )
        .await
        .unwrap();
    assert!(problems(&refused).contains("this idea's draft is in email_thread"));
    let refused = h
        .suggest(session, reply_idea("thread:reply", Uuid::now_v7()))
        .await;
    assert!(problems(&refused).contains("this idea's draft is in email_thread"));
    let reworded = h
        .service
        .rewrite(
            &principal(OWNER),
            Some(session),
            reply.id,
            RewriteIdea {
                title: Some("Send the headcount".to_owned()),
                reason: "Clearer".to_owned(),
                ..RewriteIdea::default()
            },
        )
        .await
        .unwrap();
    assert!(reworded.ok, "{:?}", reworded.problems);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_the_persons_open_ideas_session_attaches_drafts(pool: PgPool) {
    let h = harness(pool, true).await;
    let ideas = h.session(OWNER, "ideas").await;
    let routines = h.session(OWNER, "routines").await;
    let others = h.session(OTHER, "ideas").await;
    let thread = Uuid::now_v7();
    let draft = h.drafts.write(OWNER, thread);
    let reply = h
        .suggest(ideas, reply_idea("thread:reply", thread))
        .await
        .idea
        .unwrap();
    for correlation in [None, Some(routines), Some(others), Some(Uuid::now_v7())] {
        let result = h
            .service
            .attach_draft(
                &principal(OWNER),
                correlation,
                reply.id,
                attach(draft, "Drafted"),
            )
            .await;
        assert!(
            matches!(result, Err(IdeaError::NotGenerating)),
            "{result:?}"
        );
    }
    let unknown = h
        .service
        .attach_draft(
            &principal(OWNER),
            Some(ideas),
            Uuid::now_v7(),
            attach(draft, "Drafted"),
        )
        .await;
    assert!(matches!(unknown, Err(IdeaError::NotFound)), "{unknown:?}");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unprompted_session_that_cant_be_deleted_keeps_its_run(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "ideas").await;
    let idea = h
        .suggest(
            session,
            prompt_idea("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .idea
        .unwrap();
    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    let run_session = runs.started.lock().unwrap()[0].0;
    runs.set(run_session, SessionState::AwaitingPrompt);
    age_runs(&h.pool, chrono::Duration::minutes(11)).await;
    runs.discard_fails
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(h.service.settle_runs().await.unwrap(), 0);
    assert!(matches!(
        h.service.accept(&user(OWNER), idea.id).await,
        Err(IdeaError::NotFound)
    ));
    runs.discard_fails
        .store(false, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
    assert_eq!(*runs.discarded.lock().unwrap(), [run_session]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_feed_keeps_ideas_done_in_the_last_day(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "ideas").await;
    let mut ids = Vec::new();
    for key in ["a:done", "b:done-yesterday", "c:open", "d:dismissed"] {
        ids.push(h.suggest(session, entity_idea(key)).await.idea.unwrap().id);
    }
    let repo = PgIdeaRepo::new(h.pool.clone());
    for (id, state) in [
        (ids[0], IdeaState::Done),
        (ids[1], IdeaState::Done),
        (ids[3], IdeaState::Dismissed),
    ] {
        repo.set_state(
            &user(OWNER),
            id,
            &[IdeaState::Proposed],
            state,
            None,
            Utc::now(),
        )
        .await
        .unwrap();
    }
    sqlx::query!(
        "UPDATE idea SET state_changed_at = now() - interval '25 hours' WHERE id = $1",
        ids[1]
    )
    .execute(&h.pool)
    .await
    .unwrap();
    let feed = h.service.feed(&user(OWNER), None).await.unwrap();
    assert_eq!(
        feed.ideas.iter().map(|idea| idea.id).collect::<Vec<_>>(),
        [ids[2]]
    );
    assert_eq!(
        feed.done.iter().map(|idea| idea.id).collect::<Vec<_>>(),
        [ids[0]]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_background_idea_says_what_it_sends_and_running_it_approves_that(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "ideas").await;
    let mut posting = prompt_idea("ops:weekly-status", "Post the weekly status summary");
    posting.sends = Some("Posts the weekly status summary in #ops".to_owned());
    let idea = h.suggest(session, posting).await.idea.unwrap();
    assert!(matches!(
        &idea.kind,
        IdeaKind::Prompt { sends: Some(sends), .. } if sends == "Posts the weekly status summary in #ops"
    ));
    let mut composer = prompt_idea("ops:draft", "Draft the status summary");
    composer.run_mode = Some(RunMode::Composer);
    composer.sends = Some("Posts it in #ops".to_owned());
    let refused = h.suggest(session, composer).await;
    assert!(!refused.ok);
    assert!(refused.problems[0].contains("only for background prompt ideas"));
    let rewritten = h
        .service
        .rewrite(
            &principal(OWNER),
            Some(session),
            idea.id,
            RewriteIdea {
                sends: Some("Posts the weekly status summary in #ops-leads".to_owned()),
                reason: "The leads channel took over".to_owned(),
                ..RewriteIdea::default()
            },
        )
        .await
        .unwrap();
    assert!(rewritten.ok, "{:?}", rewritten.problems);
    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    let prompt = runs.started.lock().unwrap()[0].1.clone();
    assert!(
        prompt.contains("this run will: Posts the weekly status summary in #ops-leads."),
        "{prompt}"
    );
    assert!(prompt.contains("sendConfirmed"));
}

/// An idea retired while its run waits, then suggested again, can't start a
/// second run until the first one settles.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_restored_idea_starts_no_second_run_while_its_first_is_going(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "ideas").await;
    let idea = h
        .suggest(
            session,
            prompt_idea("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .idea
        .unwrap();
    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    let run_session = runs.started.lock().unwrap()[0].0;
    runs.set(run_session, SessionState::NeedsApproval);
    let retired = h
        .service
        .retire(
            &principal(OWNER),
            Some(session),
            idea.id,
            RetireIdea {
                reason: "The quotes expired".to_owned(),
            },
        )
        .await
        .unwrap();
    assert!(retired.ok, "{:?}", retired.problems);
    let restored = h
        .suggest(
            session,
            prompt_idea("quotes:compare", "Compare the new supplier quotes"),
        )
        .await;
    assert!(restored.ok, "{:?}", restored.problems);
    assert!(matches!(
        h.service.accept(&user(OWNER), idea.id).await,
        Err(IdeaError::NotFound)
    ));
    assert_eq!(runs.started.lock().unwrap().len(), 1);
    // Once the first run settles failed, the restored idea may run.
    runs.set(run_session, SessionState::Failed);
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    assert_eq!(runs.started.lock().unwrap().len(), 2);
}

/// A run whose runtime went away mid-run (a harness restart) doesn't stay
/// running: past its start window its session is deleted, the run fails,
/// and the idea may run again.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_cut_off_by_a_restart_is_given_up_and_runs_again(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "ideas").await;
    let idea = h
        .suggest(
            session,
            prompt_idea("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .idea
        .unwrap();
    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    let run_session = runs.started.lock().unwrap()[0].0;
    runs.set(run_session, SessionState::Disconnected);
    assert_eq!(h.first_run().await.progress, RunProgress::Running);
    assert_eq!(h.service.settle_runs().await.unwrap(), 0);
    age_runs(&h.pool, chrono::Duration::minutes(11)).await;
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
    assert_eq!(*runs.discarded.lock().unwrap(), [run_session]);
    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    assert_eq!(runs.started.lock().unwrap().len(), 2);
}
