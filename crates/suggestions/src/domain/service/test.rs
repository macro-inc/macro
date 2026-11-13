use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use feature_flags::outbound::fake::FakeFeatureFlags;
use feature_flags::{FlagSnapshot, FlagValue};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_entity::EntityType;
use sqlx::PgPool;

use super::*;
use crate::domain::model::{Category, EntityAction, RoutineSentencePart, RunMode};
use crate::outbound::pg_suggestion_repo::PgSuggestionRepo;

pub(crate) const OWNER: &str = "macro|suggestions-owner@macro.com";
const OTHER: &str = "macro|suggestions-other@macro.com";

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

/// Items the person can open: all but those named in `denied`. A part is
/// its item's when its id starts with the item's.
#[derive(Default)]
pub(crate) struct FakeAccess {
    denied: Mutex<HashSet<String>>,
}

impl SuggestionAccess for FakeAccess {
    type Err = std::convert::Infallible;

    async fn can_view(&self, _: &MacroUserIdStr<'_>, target: &Target) -> Result<bool, Self::Err> {
        Ok(!self.denied.lock().unwrap().contains(&target.entity_id))
    }

    async fn is_part_of(&self, target: &Target, part: &str) -> Result<bool, Self::Err> {
        Ok(part.starts_with(&target.entity_id))
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

impl SuggestionDrafts for FakeDrafts {
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
            trace_id: None,
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

/// Routine suggestions: those dismissed through the port, and how the ones
/// the test words read, in the zones they were asked for. Reading fails
/// while `unreadable` is set.
#[derive(Default)]
struct FakeRoutineSuggestions {
    dismissed: Mutex<Vec<Uuid>>,
    texts: Mutex<HashMap<Uuid, RoutineText>>,
    zones: Mutex<Vec<chrono_tz::Tz>>,
    unreadable: std::sync::atomic::AtomicBool,
}

#[async_trait::async_trait]
impl RoutineSuggestions for FakeRoutineSuggestions {
    async fn dismiss_suggestion(
        &self,
        _: &MacroUserIdStr<'static>,
        suggestion: Uuid,
    ) -> Result<bool, rootcause::Report> {
        self.dismissed.lock().unwrap().push(suggestion);
        Ok(true)
    }

    async fn texts(
        &self,
        _: &MacroUserIdStr<'static>,
        suggestions: &[Uuid],
        timezone: chrono_tz::Tz,
    ) -> Result<Vec<(Uuid, RoutineText)>, rootcause::Report> {
        self.zones.lock().unwrap().push(timezone);
        if self.unreadable.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(rootcause::report!("routine suggestions are unreadable"));
        }
        let texts = self.texts.lock().unwrap();
        Ok(suggestions
            .iter()
            .filter_map(|id| Some((*id, texts.get(id)?.clone())))
            .collect())
    }
}

pub(crate) type Service =
    SuggestionService<PgSuggestionRepo, FakeAccess, FakeDrafts, FakeFeatureFlags>;

pub(crate) struct Harness {
    pub(crate) service: Service,
    access: Arc<FakeAccess>,
    drafts: Arc<FakeDrafts>,
    audience: Arc<FakeAudience>,
    routines: Arc<FakeRoutineSuggestions>,
    pool: PgPool,
}

pub(crate) async fn harness(pool: PgPool, flag: bool) -> Harness {
    for id in [OWNER, OTHER] {
        crate::outbound::pg_suggestion_repo::test::insert_user(&pool, id).await;
    }
    let mut flags = FakeFeatureFlags::default();
    for id in [OWNER, OTHER] {
        flags.set(
            user(id),
            Ok(FlagSnapshot::new([(
                SUGGESTIONS_FLAG.to_owned(),
                FlagValue::Boolean(flag),
            )])),
        );
    }
    let access = Arc::new(FakeAccess::default());
    let drafts = Arc::new(FakeDrafts::default());
    let audience = Arc::new(FakeAudience::default());
    let routines = Arc::new(FakeRoutineSuggestions::default());
    Harness {
        service: SuggestionService::new(
            Arc::new(PgSuggestionRepo::new(pool.clone())),
            Arc::clone(&access),
            Arc::clone(&drafts),
            Arc::new(SameSession),
            Arc::new(RowSessions(pool.clone())),
            audience.clone(),
            routines.clone(),
            Some(flags),
        ),
        access,
        drafts,
        audience,
        routines,
        pool,
    }
}

fn principal(id: &'static str) -> CreationPrincipal {
    CreationPrincipal::User(user(id))
}

fn prompt_suggestion(key: &str, title: &str) -> NewSuggestion {
    NewSuggestion {
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

pub(crate) fn entity_suggestion(key: &str) -> NewSuggestion {
    NewSuggestion {
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

/// Accepting `suggestion` as it was read.
fn shown(suggestion: &Suggestion) -> Accept {
    Accept {
        shown_updated_at: suggestion.updated_at,
        by_person: false,
    }
}

impl Harness {
    /// The person accepts suggestion `id` in the app, as it is now.
    async fn accept(
        &self,
        user: &MacroUserIdStr<'static>,
        id: Uuid,
    ) -> Result<(), SuggestionError> {
        let shown = PgSuggestionRepo::new(self.pool.clone())
            .suggestion(user, id)
            .await
            .unwrap()
            .map_or_else(Utc::now, |suggestion| suggestion.updated_at);
        self.service
            .accept(
                user,
                SuggestionCaller::User,
                id,
                Accept {
                    shown_updated_at: shown,
                    by_person: true,
                },
            )
            .await
    }

    /// The latest run of the person's first suggestion in the feed.
    async fn first_run(&self) -> crate::domain::model::SuggestionRun {
        self.service
            .feed(&user(OWNER), SuggestionCaller::User, None)
            .await
            .unwrap()
            .suggestions[0]
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

    pub(crate) async fn suggest(
        &self,
        session: Uuid,
        request: NewSuggestion,
    ) -> SuggestionWriteOutcome {
        self.service
            .suggest(&principal(OWNER), Some(session), request)
            .await
            .unwrap()
    }

    async fn changes(&self, suggestion: Uuid) -> Vec<(String, Option<String>)> {
        sqlx::query!(
            "SELECT action, reason FROM suggestion_change WHERE subject_id = $1 ORDER BY created_at, id",
            suggestion,
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
async fn an_suggestions_session_adds_an_suggestion_the_person_sees(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let mut request = prompt_suggestion("quotes:compare", "Compare the supplier quotes");
    request.reason = Some("Three quotes for the same order".to_owned());
    let outcome = h.suggest(session, request).await;
    assert!(outcome.ok, "{:?}", outcome.problems);
    let suggestion = outcome.suggestion.unwrap();
    assert_eq!(suggestion.state, SuggestionState::Proposed);
    assert_eq!(suggestion.categories, vec![Category::SaveMoney]);
    assert_eq!(
        suggestion.kind,
        SuggestionKind::Prompt {
            prompt: "Compare the supplier quotes in my inbox and list the cheapest.".to_owned(),
            run_mode: RunMode::Background,
            sends: None,
        }
    );
    assert_eq!(
        h.changes(suggestion.id).await,
        vec![(
            "created".to_owned(),
            Some("Three quotes for the same order".to_owned())
        )]
    );
    let feed = h
        .service
        .feed(
            &user(OWNER),
            SuggestionCaller::User,
            Some(chrono_tz::Europe::Paris),
        )
        .await
        .unwrap();
    assert_eq!(feed.suggestions, vec![suggestion]);
    assert_eq!(
        *h.audience.0.lock().unwrap(),
        vec![(OWNER.to_owned(), "Europe/Paris".to_owned())]
    );
    assert!(
        h.service
            .feed(&user(OTHER), SuggestionCaller::User, None)
            .await
            .unwrap()
            .suggestions
            .is_empty()
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_the_persons_open_suggestions_session_may_write(pool: PgPool) {
    let h = harness(pool, true).await;
    let suggestions = h.session(OWNER, "suggestions").await;
    let routines = h.session(OWNER, "routines").await;
    let others = h.session(OTHER, "suggestions").await;
    let refused = |result: Result<SuggestionWriteOutcome, SuggestionError>| {
        assert!(
            matches!(result, Err(SuggestionError::NotGenerating)),
            "{result:?}"
        );
    };
    let request = || prompt_suggestion("quotes:compare", "Compare the supplier quotes");
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
    h.close(suggestions).await;
    refused(
        h.service
            .suggest(&principal(OWNER), Some(suggestions), request())
            .await,
    );
    assert!(matches!(
        h.service.review(&principal(OWNER), Some(suggestions)).await,
        Err(SuggestionError::NotGenerating)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn suggestions_are_off_without_the_flag(pool: PgPool) {
    let h = harness(pool, false).await;
    let session = h.session(OWNER, "suggestions").await;
    assert!(matches!(
        h.service
            .suggest(
                &principal(OWNER),
                Some(session),
                prompt_suggestion("a", "Compare quotes")
            )
            .await,
        Err(SuggestionError::NotFound)
    ));
    assert!(matches!(
        h.service
            .feed(&user(OWNER), SuggestionCaller::User, None)
            .await,
        Err(SuggestionError::NotFound)
    ));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_same_dedup_key_updates_the_suggestion_and_its_kind_never_changes(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let first = h
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .suggestion
        .unwrap();
    let second = h
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Pick the cheapest supplier"),
        )
        .await;
    assert!(second.ok, "{:?}", second.problems);
    let second = second.suggestion.unwrap();
    assert_eq!(second.id, first.id);
    assert_eq!(second.title, "Pick the cheapest supplier");
    assert_eq!(
        h.service
            .feed(&user(OWNER), SuggestionCaller::User, None)
            .await
            .unwrap()
            .suggestions
            .len(),
        1
    );
    let as_entity = h
        .suggest(session, entity_suggestion("quotes:compare"))
        .await;
    assert!(!as_entity.ok);
    assert!(
        as_entity.problems[0].contains("kind never changes"),
        "{:?}",
        as_entity.problems
    );
    let mut composer = prompt_suggestion("quotes:compare", "Compare quotes");
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
async fn a_dismissed_suggestion_comes_back_only_with_a_reason(pool: PgPool) {
    let h = harness(pool, true).await;
    let night = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(night, entity_suggestion("venue:headcount"))
        .await
        .suggestion
        .unwrap();
    h.service
        .dismiss(&user(OWNER), SuggestionCaller::User, suggestion.id)
        .await
        .unwrap();
    assert!(
        h.service
            .feed(&user(OWNER), SuggestionCaller::User, None)
            .await
            .unwrap()
            .suggestions
            .is_empty()
    );
    h.close(night).await;
    let next = h.session(OWNER, "suggestions").await;
    let review = h
        .service
        .review(&principal(OWNER), Some(next))
        .await
        .unwrap();
    assert_eq!(review.suggestions[0].state, SuggestionState::Dismissed);
    let again = h.suggest(next, entity_suggestion("venue:headcount")).await;
    assert!(!again.ok);
    assert!(
        again.problems[0].contains("dismissed"),
        "{:?}",
        again.problems
    );
    let mut with_reason = entity_suggestion("venue:headcount");
    with_reason.reason = Some("The venue wrote again with a new deadline".to_owned());
    let back = h.suggest(next, with_reason).await;
    assert!(back.ok, "{:?}", back.problems);
    assert_eq!(back.suggestion.unwrap().state, SuggestionState::Proposed);
    assert_eq!(
        h.changes(suggestion.id).await.last().unwrap(),
        &(
            "restored".to_owned(),
            Some("The venue wrote again with a new deadline".to_owned())
        )
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_session_rewrites_and_retires_open_suggestions_and_a_retired_one_comes_back(
    pool: PgPool,
) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .suggestion
        .unwrap();
    let rewritten = h
        .service
        .rewrite(
            &principal(OWNER),
            Some(session),
            suggestion.id,
            RewriteSuggestion {
                importance: Some(20),
                categories: Some(vec![Category::Revisit]),
                reason: "The order is weeks away".to_owned(),
                ..RewriteSuggestion::default()
            },
        )
        .await
        .unwrap();
    assert!(rewritten.ok, "{:?}", rewritten.problems);
    let rewritten = rewritten.suggestion.unwrap();
    assert_eq!(rewritten.importance, 20);
    assert_eq!(rewritten.title, suggestion.title);
    let retired = h
        .service
        .retire(
            &principal(OWNER),
            Some(session),
            suggestion.id,
            RetireSuggestionRequest {
                reason: "The order was placed".to_owned(),
            },
        )
        .await
        .unwrap();
    assert_eq!(retired.suggestion.unwrap().state, SuggestionState::Retired);
    assert!(
        h.service
            .feed(&user(OWNER), SuggestionCaller::User, None)
            .await
            .unwrap()
            .suggestions
            .is_empty()
    );
    let again = h
        .service
        .rewrite(
            &principal(OWNER),
            Some(session),
            suggestion.id,
            RewriteSuggestion {
                importance: Some(90),
                reason: "Still matters".to_owned(),
                ..RewriteSuggestion::default()
            },
        )
        .await
        .unwrap();
    assert!(!again.ok);
    let back = h
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Compare the supplier quotes"),
        )
        .await;
    assert_eq!(back.suggestion.unwrap().state, SuggestionState::Proposed);
    let actions: Vec<String> = h
        .changes(suggestion.id)
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
        let session = h.session(OWNER, "suggestions").await;
        let room = open - kept.iter().sum::<usize>();
        expected.push(per_night.min(room));
        let mut tonight = 0;
        for n in 0..=per_night {
            let outcome = h
                .suggest(
                    session,
                    prompt_suggestion(&format!("suggestion:{night}:{n}"), "Compare quotes"),
                )
                .await;
            if outcome.ok {
                tonight += 1;
            } else {
                let limit = if n == per_night && room > per_night {
                    "most for one night"
                } else {
                    "30 open suggestions"
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
    // Rewriting an open suggestion at the limit still works.
    let session = h.session(OWNER, "suggestions").await;
    let rewrite = h
        .suggest(
            session,
            prompt_suggestion("suggestion:0:0", "Compare the supplier quotes"),
        )
        .await;
    assert!(rewrite.ok, "{:?}", rewrite.problems);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn writes_are_checked_before_they_are_kept(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let mut routine = prompt_suggestion("routine", "Compare quotes");
    routine.kind = KindName::Routine;
    let mut detail = prompt_suggestion("detail", "Compare quotes");
    detail.summary = format!("Ask {}@{}.com for the quote", "sam", "example");
    let mut no_items = entity_suggestion("no-items");
    no_items.about.clear();
    let mut bad_key = prompt_suggestion("Has Spaces", "Compare quotes");
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
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Compare quotes"),
        )
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
            .suggestions
            .is_empty()
    );
}

/// A part is kept only with the item it belongs to.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_suggestion_names_a_part_only_with_its_own_item(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let with_part = |key: &str, part: &str| {
        let mut suggestion = prompt_suggestion(key, "Compare quotes");
        suggestion.about[0].part_id = Some(part.to_owned());
        suggestion
    };
    let foreign = h
        .suggest(session, with_part("quotes:foreign", "thread-2:message"))
        .await;
    assert!(!foreign.ok);
    assert!(
        foreign.problems[0].contains("isn't one of its parts"),
        "{:?}",
        foreign.problems
    );
    let own = h
        .suggest(session, with_part("quotes:own", "thread-1:message"))
        .await;
    assert!(own.ok, "{:?}", own.problems);
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None)
        .await
        .unwrap();
    assert_eq!(feed.suggestions.len(), 1);
    assert_eq!(
        feed.suggestions[0].about[0].part_id.as_deref(),
        Some("thread-1:message")
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_feed_hides_suggestions_about_items_the_person_lost(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    h.suggest(
        session,
        prompt_suggestion("quotes:compare", "Compare quotes"),
    )
    .await;
    h.suggest(session, entity_suggestion("venue:headcount"))
        .await;
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None)
        .await
        .unwrap();
    // Best first.
    assert_eq!(feed.suggestions[0].dedup_key, "venue:headcount");
    h.access
        .denied
        .lock()
        .unwrap()
        .insert("thread-2".to_owned());
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None)
        .await
        .unwrap();
    assert_eq!(feed.suggestions.len(), 1);
    assert_eq!(feed.suggestions[0].dedup_key, "quotes:compare");
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_person_accepts_and_dismisses_only_their_open_suggestions(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(session, entity_suggestion("venue:headcount"))
        .await
        .suggestion
        .unwrap();
    assert!(matches!(
        h.accept(&user(OTHER), suggestion.id).await,
        Err(SuggestionError::NotFound)
    ));
    // Acting on a suggestion that isn't a background run finishes it: it shows
    // in the feed's done list, and accepting it again changes nothing.
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None)
        .await
        .unwrap();
    assert!(feed.suggestions.is_empty());
    assert_eq!(feed.done[0].id, suggestion.id);
    assert_eq!(feed.done[0].state, SuggestionState::Done);
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    assert!(matches!(
        h.service
            .dismiss(&user(OWNER), SuggestionCaller::User, suggestion.id)
            .await,
        Err(SuggestionError::NotFound)
    ));
    // A background prompt is taken on and runs: see the run tests.
}

/// The person's own agent, in a chat session of theirs.
fn chat_agent() -> SuggestionCaller {
    SuggestionCaller::Agent {
        correlation: Some(Uuid::now_v7()),
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_persons_own_agent_reads_accepts_and_dismisses_their_suggestions(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let mut request = prompt_suggestion("quotes:compare", "Compare the supplier quotes");
    request.run_mode = Some(RunMode::Composer);
    let prompt = h.suggest(session, request).await.suggestion.unwrap();
    let entity = h
        .suggest(session, entity_suggestion("venue:headcount"))
        .await
        .suggestion
        .unwrap();
    let feed = h
        .service
        .feed(&user(OWNER), chat_agent(), None)
        .await
        .unwrap();
    assert_eq!(feed.suggestions, vec![entity.clone(), prompt.clone()]);
    // A composer prompt suggestion becomes done; the agent acts on the prompt
    // itself.
    h.service
        .accept(&user(OWNER), chat_agent(), prompt.id, shown(&prompt))
        .await
        .unwrap();
    // An agent with no code-mode invocation is the person's too.
    h.service
        .dismiss(
            &user(OWNER),
            SuggestionCaller::Agent { correlation: None },
            entity.id,
        )
        .await
        .unwrap();
    let feed = h
        .service
        .feed(&user(OWNER), chat_agent(), None)
        .await
        .unwrap();
    assert!(feed.suggestions.is_empty());
    assert_eq!(feed.done[0].id, prompt.id);
    assert_eq!(feed.done[0].state, SuggestionState::Done);
    assert_eq!(feed.done[0].kind, prompt.kind);
    assert_eq!(
        h.changes(prompt.id).await.len(),
        1,
        "accepting logs no change"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn another_persons_agent_never_reaches_the_persons_suggestions(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(session, entity_suggestion("venue:headcount"))
        .await
        .suggestion
        .unwrap();
    assert!(
        h.service
            .feed(&user(OTHER), chat_agent(), None)
            .await
            .unwrap()
            .suggestions
            .is_empty()
    );
    assert!(matches!(
        h.service
            .accept(
                &user(OTHER),
                chat_agent(),
                suggestion.id,
                shown(&suggestion)
            )
            .await,
        Err(SuggestionError::NotFound)
    ));
    assert!(matches!(
        h.service
            .dismiss(&user(OTHER), chat_agent(), suggestion.id)
            .await,
        Err(SuggestionError::NotFound)
    ));
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None)
        .await
        .unwrap();
    assert_eq!(feed.suggestions[0].state, SuggestionState::Proposed);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn generation_sessions_never_read_accept_or_dismiss_for_the_person(pool: PgPool) {
    let h = harness(pool, true).await;
    let suggestions = h.session(OWNER, "suggestions").await;
    let routines = h.session(OWNER, "routines").await;
    let others = h.session(OTHER, "suggestions").await;
    let suggestion = h
        .suggest(suggestions, entity_suggestion("venue:headcount"))
        .await
        .suggestion
        .unwrap();
    for session in [suggestions, routines, others] {
        let caller = SuggestionCaller::Agent {
            correlation: Some(session),
        };
        let feed = h
            .service
            .feed(&user(OWNER), caller, Some(chrono_tz::Europe::Paris))
            .await;
        assert!(matches!(feed, Err(SuggestionError::Generating)), "{feed:?}");
        let accept = h
            .service
            .accept(&user(OWNER), caller, suggestion.id, shown(&suggestion))
            .await;
        assert!(
            matches!(accept, Err(SuggestionError::Generating)),
            "{accept:?}"
        );
        let dismiss = h.service.dismiss(&user(OWNER), caller, suggestion.id).await;
        assert!(
            matches!(dismiss, Err(SuggestionError::Generating)),
            "{dismiss:?}"
        );
    }
    // Its read counted no one in, and the suggestion is untouched.
    assert!(h.audience.0.lock().unwrap().is_empty());
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None)
        .await
        .unwrap();
    assert_eq!(feed.suggestions[0].state, SuggestionState::Proposed);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_routine_card_follows_its_suggestion(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
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
    suggestions_db_utils::add_routine_card(
        &mut tx,
        &suggestions_db_utils::NewRoutineSuggestionCard {
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

    // The feed shows how its drafted routine reads, one-off times in the
    // reader's zone.
    let text = RoutineText {
        sentence: vec![
            RoutineSentencePart {
                text: "Plan ".to_owned(),
                picked: false,
            },
            RoutineSentencePart {
                text: "the week".to_owned(),
                picked: true,
            },
        ],
        when: "Mondays at 9:00 AM".to_owned(),
    };
    h.routines
        .texts
        .lock()
        .unwrap()
        .insert(suggestion, text.clone());
    let feed = h
        .service
        .feed(
            &user(OWNER),
            SuggestionCaller::User,
            Some(chrono_tz::Europe::Paris),
        )
        .await
        .unwrap();
    let card = feed.suggestions[0].clone();
    assert_eq!(
        card.kind,
        SuggestionKind::Routine {
            routine_suggestion_id: suggestion,
            routine: Some(text),
        }
    );
    assert_eq!(
        *h.routines.zones.lock().unwrap(),
        [chrono_tz::Europe::Paris]
    );
    // When its routine can't be read, the card still shows, without it.
    h.routines
        .unreadable
        .store(true, std::sync::atomic::Ordering::SeqCst);
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None)
        .await
        .unwrap();
    assert_eq!(
        feed.suggestions[0].kind,
        SuggestionKind::Routine {
            routine_suggestion_id: suggestion,
            routine: None,
        }
    );
    assert_eq!(h.routines.zones.lock().unwrap()[1], chrono_tz::UTC);
    // Sessions never rewrite or retire it here; its suggestion decides.
    let rewrite = h
        .service
        .rewrite(
            &principal(OWNER),
            Some(session),
            card.id,
            RewriteSuggestion {
                importance: Some(90),
                reason: "Matters more".to_owned(),
                ..RewriteSuggestion::default()
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
            card.id,
            RetireSuggestionRequest {
                reason: "No longer fits".to_owned(),
            },
        )
        .await
        .unwrap();
    assert!(!retire.ok);
    // Nor is it accepted, by the person or anyone acting for them: saving
    // its routine in the app makes it done.
    for by_person in [true, false] {
        let accepted = h
            .service
            .accept(
                &user(OWNER),
                SuggestionCaller::User,
                card.id,
                Accept {
                    shown_updated_at: card.updated_at,
                    by_person,
                },
            )
            .await;
        assert!(
            matches!(accepted, Err(SuggestionError::RoutineNotAccepted)),
            "{accepted:?}"
        );
    }
    let state = sqlx::query_scalar!("SELECT state FROM suggestion WHERE id = $1", card.id)
        .fetch_one(&h.pool)
        .await
        .unwrap();
    assert_eq!(state, "proposed");
    // The person dismissing it dismisses its suggestion, which closes both.
    h.service
        .dismiss(&user(OWNER), SuggestionCaller::User, card.id)
        .await
        .unwrap();
    assert_eq!(*h.routines.dismissed.lock().unwrap(), [suggestion]);
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
async fn accepting_a_background_prompt_suggestion_runs_it_and_its_session_finishes_it(
    pool: PgPool,
) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .suggestion
        .unwrap();

    h.accept(&user(OWNER), suggestion.id).await.unwrap();
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
        h.accept(&user(OWNER), suggestion.id).await,
        Err(SuggestionError::NotFound)
    ));
    let run_session = started[0].0;
    let run = h.first_run().await;
    assert_eq!(
        (run.session_id, run.progress),
        (run_session, RunProgress::Running)
    );
    assert_eq!(
        h.service
            .feed(&user(OWNER), SuggestionCaller::User, None)
            .await
            .unwrap()
            .suggestions[0]
            .state,
        SuggestionState::Accepted
    );

    // Waiting for an approval shows on the suggestion; within its start window
    // the run isn't given up.
    runs.set(run_session, SessionState::NeedsApproval);
    assert_eq!(h.first_run().await.progress, RunProgress::NeedsApproval);
    assert_eq!(h.service.settle_runs().await.unwrap(), 0);

    // Once its session finished, the suggestion is done with what the run made.
    runs.set(run_session, SessionState::Finished);
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
    assert_eq!(h.service.settle_runs().await.unwrap(), 0);
    let done = PgSuggestionRepo::new(h.pool.clone())
        .suggestion(&user(OWNER), suggestion.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(done.state, SuggestionState::Done);
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
    let session = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .suggestion
        .unwrap();
    // A session that never opened leaves the suggestion to try again.
    *runs.starts_as.lock().unwrap() = StartsAs::NotStarted;
    assert!(matches!(
        h.accept(&user(OWNER), suggestion.id).await,
        Err(SuggestionError::Internal(_))
    ));
    *runs.starts_as.lock().unwrap() = StartsAs::Started;
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run_session = runs.started.lock().unwrap()[0].0;
    runs.set(run_session, SessionState::Failed);
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None)
        .await
        .unwrap();
    assert_eq!(feed.suggestions[0].state, SuggestionState::Accepted);
    assert_eq!(
        feed.suggestions[0].run.as_ref().unwrap().progress,
        RunProgress::Failed
    );
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    assert_eq!(runs.started.lock().unwrap().len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn accepting_any_other_suggestion_starts_no_run(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "suggestions").await;
    let mut composer = prompt_suggestion("quotes:compare", "Compare the supplier quotes");
    composer.run_mode = Some(RunMode::Composer);
    let composer = h.suggest(session, composer).await.suggestion.unwrap();
    let entity = h
        .suggest(session, entity_suggestion("venue:headcount"))
        .await
        .suggestion
        .unwrap();
    h.accept(&user(OWNER), composer.id).await.unwrap();
    h.accept(&user(OWNER), entity.id).await.unwrap();
    assert!(runs.started.lock().unwrap().is_empty());
    assert!(
        h.service
            .feed(&user(OWNER), SuggestionCaller::User, None)
            .await
            .unwrap()
            .suggestions
            .iter()
            .all(|suggestion| suggestion.run.is_none())
    );
}

/// Someone acting for the person (an agent of theirs) takes a background
/// suggestion on but never starts its run; the person starts it in the app.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_the_person_starts_a_background_run(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Compare quotes"),
        )
        .await
        .suggestion
        .unwrap();
    // An agent of the person's: even one claiming to be the person.
    let agent = || SuggestionCaller::Agent { correlation: None };
    let as_agent = |shown_updated_at| Accept {
        shown_updated_at,
        by_person: true,
    };
    h.service
        .accept(
            &user(OWNER),
            agent(),
            suggestion.id,
            as_agent(suggestion.updated_at),
        )
        .await
        .unwrap();
    assert!(runs.started.lock().unwrap().is_empty());
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None)
        .await
        .unwrap();
    assert_eq!(feed.suggestions[0].state, SuggestionState::Accepted);
    assert!(feed.suggestions[0].run.is_none());
    // Again, still nothing runs.
    h.service
        .accept(
            &user(OWNER),
            agent(),
            suggestion.id,
            as_agent(feed.suggestions[0].updated_at),
        )
        .await
        .unwrap();
    assert!(runs.started.lock().unwrap().is_empty());
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    assert_eq!(runs.started.lock().unwrap().len(), 1);
}

/// What runs is what the person saw: a card read before the suggestion was
/// rewritten is refused, and runs once read again.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_background_suggestion_runs_only_as_the_person_saw_it(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Compare quotes"),
        )
        .await
        .suggestion
        .unwrap();
    let rewritten = h
        .service
        .rewrite(
            &principal(OWNER),
            Some(session),
            suggestion.id,
            RewriteSuggestion {
                prompt: Some("Compare the quotes and email the cheapest supplier.".to_owned()),
                reason: "A fourth quote arrived".to_owned(),
                ..RewriteSuggestion::default()
            },
        )
        .await
        .unwrap();
    assert!(rewritten.ok, "{:?}", rewritten.problems);
    let as_person = |shown_updated_at| Accept {
        shown_updated_at,
        by_person: true,
    };
    let Err(SuggestionError::Changed(now)) = h
        .service
        .accept(
            &user(OWNER),
            SuggestionCaller::User,
            suggestion.id,
            as_person(suggestion.updated_at),
        )
        .await
    else {
        panic!("a card read before the rewrite is refused");
    };
    // The answer carries the suggestion as it is now.
    assert!(matches!(
        &now.kind,
        SuggestionKind::Prompt { prompt, .. } if prompt.starts_with("Compare the quotes and email")
    ));
    assert!(runs.started.lock().unwrap().is_empty());
    h.service
        .accept(
            &user(OWNER),
            SuggestionCaller::User,
            suggestion.id,
            as_person(rewritten.suggestion.unwrap().updated_at),
        )
        .await
        .unwrap();
    let started = runs.started.lock().unwrap().clone();
    assert!(
        started[0]
            .1
            .starts_with("Compare the quotes and email the cheapest supplier.")
    );
}

/// Any suggestion is acted on only as the person saw it: a composer prompt or a
/// reply rewritten after the card was read is refused with how it is now,
/// stays open, and is done once accepted as it is.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn any_suggestion_is_acted_on_only_as_the_person_saw_it(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let mut composer = prompt_suggestion("quotes:composer", "Compare quotes");
    composer.run_mode = Some(RunMode::Composer);
    for request in [composer, entity_suggestion("venue:headcount")] {
        let shown = h.suggest(session, request).await.suggestion.unwrap();
        let rewritten = h
            .service
            .rewrite(
                &principal(OWNER),
                Some(session),
                shown.id,
                RewriteSuggestion {
                    summary: Some("A fourth one arrived this morning.".to_owned()),
                    reason: "New mail".to_owned(),
                    ..RewriteSuggestion::default()
                },
            )
            .await
            .unwrap();
        assert!(rewritten.ok, "{:?}", rewritten.problems);
        let stale = Accept {
            shown_updated_at: shown.updated_at,
            by_person: true,
        };
        let Err(SuggestionError::Changed(now)) = h
            .service
            .accept(&user(OWNER), SuggestionCaller::User, shown.id, stale)
            .await
        else {
            panic!("a stale card is refused");
        };
        assert_eq!(now.summary, "A fourth one arrived this morning.");
        assert_eq!(now.state, SuggestionState::Proposed);
        h.service
            .accept(
                &user(OWNER),
                SuggestionCaller::User,
                shown.id,
                Accept {
                    shown_updated_at: now.updated_at,
                    by_person: true,
                },
            )
            .await
            .unwrap();
    }
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None)
        .await
        .unwrap();
    assert!(feed.suggestions.is_empty());
    assert_eq!(feed.done.len(), 2);
}

/// A run waiting for an approval or an answer gets none: past its start
/// window it is given up, so the suggestion may run again.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_left_waiting_is_given_up_and_runs_again(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "suggestions").await;
    for (key, waiting) in [
        ("quotes:approval", SessionState::NeedsApproval),
        ("quotes:input", SessionState::NeedsInput),
    ] {
        let suggestion = h
            .suggest(session, prompt_suggestion(key, "Compare quotes"))
            .await
            .suggestion
            .unwrap();
        h.accept(&user(OWNER), suggestion.id).await.unwrap();
        let run = runs.started.lock().unwrap().last().unwrap().0;
        runs.set(run, waiting);
    }
    assert_eq!(
        h.service.settle_runs().await.unwrap(),
        0,
        "within the window"
    );
    age_runs(&h.pool, chrono::Duration::minutes(11)).await;
    assert_eq!(h.service.settle_runs().await.unwrap(), 2);
    assert_eq!(runs.discarded.lock().unwrap().len(), 2);
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None)
        .await
        .unwrap();
    assert!(
        feed.suggestions
            .iter()
            .all(|suggestion| suggestion.run.as_ref().map(|run| run.progress)
                == Some(RunProgress::Failed))
    );
    // Accepting again runs it again.
    let suggestion = feed.suggestions[0].id;
    h.accept(&user(OWNER), suggestion).await.unwrap();
    assert_eq!(runs.started.lock().unwrap().len(), 3);
}

/// Age every run of the test's suggestions by `by`, as if started that long ago.
async fn age_runs(pool: &PgPool, by: chrono::Duration) {
    sqlx::query!(
        "UPDATE suggestion_run SET started_at = started_at - $1::interval",
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
    let session = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .suggestion
        .unwrap();
    *runs.starts_as.lock().unwrap() = StartsAs::Uncertain;
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    *runs.starts_as.lock().unwrap() = StartsAs::Started;
    assert!(matches!(
        h.accept(&user(OWNER), suggestion.id).await,
        Err(SuggestionError::NotFound)
    ));
    assert_eq!(runs.started.lock().unwrap().len(), 1);
    let run_session = runs.started.lock().unwrap()[0].0;
    runs.set(run_session, SessionState::Finished);
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
}

/// A session that never took its prompt is deleted after a while, and the
/// suggestion may run again.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_whose_prompt_never_arrived_is_given_up_and_runs_again(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .suggestion
        .unwrap();
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run_session = runs.started.lock().unwrap()[0].0;
    runs.set(run_session, SessionState::AwaitingPrompt);
    assert_eq!(h.service.settle_runs().await.unwrap(), 0);
    age_runs(&h.pool, chrono::Duration::minutes(11)).await;
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
    assert_eq!(*runs.discarded.lock().unwrap(), [run_session]);
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    assert_eq!(runs.started.lock().unwrap().len(), 2);
}

/// A run whose session can't be read is never given up, however long the
/// outage: it may be running, and a retry would start a second session.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_live_run_whose_session_cant_be_read_is_never_given_up(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .suggestion
        .unwrap();
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run_session = runs.started.lock().unwrap()[0].0;
    runs.unreadable.lock().unwrap().insert(run_session);
    age_runs(&h.pool, chrono::Duration::hours(3)).await;
    for _ in 0..20 {
        assert_eq!(h.service.settle_runs().await.unwrap(), 0);
    }
    assert!(matches!(
        h.accept(&user(OWNER), suggestion.id).await,
        Err(SuggestionError::NotFound)
    ));
    assert_eq!(runs.started.lock().unwrap().len(), 1);
    // Once it reads again, it settles as its session says.
    runs.unreadable.lock().unwrap().remove(&run_session);
    runs.set(run_session, SessionState::Finished);
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
}

/// A run whose session is confirmed missing (it never opened) is given up
/// once its start window has passed, and the suggestion may run again.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_whose_session_is_missing_is_given_up_after_its_start_window(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .suggestion
        .unwrap();
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run_session = runs.started.lock().unwrap()[0].0;
    runs.state.lock().unwrap().remove(&run_session);
    // It may still be opening.
    assert_eq!(h.service.settle_runs().await.unwrap(), 0);
    age_runs(&h.pool, chrono::Duration::minutes(11)).await;
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    assert_eq!(runs.started.lock().unwrap().len(), 2);
}

/// A reply suggestion about email thread `thread`.
fn reply_suggestion(key: &str, thread: Uuid) -> NewSuggestion {
    let mut suggestion = entity_suggestion(key);
    suggestion.about = vec![Target {
        entity_type: EntityType::EmailThread,
        entity_id: thread.to_string(),
        part_id: None,
    }];
    suggestion
}

fn attach(draft: Uuid, reason: &str) -> AttachDraft {
    AttachDraft {
        email_draft_id: draft,
        reason: reason.to_owned(),
    }
}

/// `draft` as a suggestion keeps it: the thread, with the draft as the part.
fn draft_target(thread: Uuid, draft: Uuid) -> Target {
    Target {
        entity_type: EntityType::EmailThread,
        entity_id: thread.to_string(),
        part_id: Some(draft.to_string()),
    }
}

impl Harness {
    async fn attach(
        &self,
        session: Uuid,
        suggestion: Uuid,
        request: AttachDraft,
    ) -> SuggestionWriteOutcome {
        self.service
            .attach_draft(&principal(OWNER), Some(session), suggestion, request)
            .await
            .unwrap()
    }

    /// The change log's rewrites of `suggestion`: (old, new, reason).
    async fn rewrites(
        &self,
        suggestion: Uuid,
    ) -> Vec<(
        Option<serde_json::Value>,
        Option<serde_json::Value>,
        Option<String>,
    )> {
        sqlx::query!(
            r#"SELECT old_value, new_value, reason FROM suggestion_change
               WHERE subject_id = $1 AND action = 'rewritten' ORDER BY created_at, id"#,
            suggestion,
        )
        .fetch_all(&self.pool)
        .await
        .unwrap()
        .into_iter()
        .map(|row| (row.old_value, row.new_value, row.reason))
        .collect()
    }
}

fn problems(outcome: &SuggestionWriteOutcome) -> String {
    assert!(
        !outcome.ok,
        "expected a refusal, got {:?}",
        outcome.suggestion
    );
    outcome.problems.join(" | ")
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_draft_is_attached_only_to_an_open_reply_suggestion_in_its_thread(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let thread = Uuid::now_v7();
    let mine = h.drafts.write(OWNER, thread);
    let elsewhere = h.drafts.write(OWNER, Uuid::now_v7());
    let theirs = h.drafts.write(OTHER, thread);

    let prompt = h
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Compare quotes"),
        )
        .await
        .suggestion
        .unwrap();
    let mut review = reply_suggestion("thread:review", thread);
    review.action = Some(EntityAction::Review);
    let review = h.suggest(session, review).await.suggestion.unwrap();
    for suggestion in [prompt.id, review.id] {
        let refused = h
            .attach(session, suggestion, attach(mine, "Drafted the reply"))
            .await;
        assert!(
            problems(&refused).contains("only for an entity suggestion with action `reply`"),
            "{refused:?}"
        );
    }

    let reply = h
        .suggest(session, reply_suggestion("thread:reply", thread))
        .await
        .suggestion
        .unwrap();
    for (draft, problem) in [
        (theirs, "no unsent draft in the user's own inboxes"),
        (Uuid::now_v7(), "no unsent draft in the user's own inboxes"),
        (
            elsewhere,
            "another thread than the one this suggestion is about",
        ),
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
    let expected = SuggestionKind::Entity {
        action: EntityAction::Reply,
        draft: Some(draft_target(thread, mine)),
    };
    assert_eq!(attached.suggestion.unwrap().kind, expected);
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None)
        .await
        .unwrap();
    let shown = feed
        .suggestions
        .iter()
        .find(|suggestion| suggestion.id == reply.id)
        .unwrap();
    assert_eq!(shown.kind, expected);

    let retired = h
        .service
        .retire(
            &principal(OWNER),
            Some(session),
            reply.id,
            RetireSuggestionRequest {
                reason: "Answered by phone".to_owned(),
            },
        )
        .await
        .unwrap();
    assert!(retired.ok, "{:?}", retired.problems);
    let refused = h.attach(session, reply.id, attach(mine, "Again")).await;
    assert!(problems(&refused).contains("only attached to an open suggestion"));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_new_draft_replaces_the_old_one_and_the_log_keeps_both(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let thread = Uuid::now_v7();
    let first = h.drafts.write(OWNER, thread);
    let second = h.drafts.write(OWNER, thread);
    let reply = h
        .suggest(session, reply_suggestion("thread:reply", thread))
        .await
        .suggestion
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
        replaced.suggestion.unwrap().kind,
        SuggestionKind::Entity {
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
        r#"SELECT count(*) AS "count!" FROM suggestion_target WHERE suggestion_id = $1 AND role = 'draft'"#,
        reply.id,
    )
    .fetch_one(&h.pool)
    .await
    .unwrap();
    assert_eq!(drafts, 1);

    // The suggestion stays about the thread its draft is in.
    let refused = h
        .service
        .rewrite(
            &principal(OWNER),
            Some(session),
            reply.id,
            RewriteSuggestion {
                about: Some(vec![Target {
                    entity_type: EntityType::EmailThread,
                    entity_id: Uuid::now_v7().to_string(),
                    part_id: None,
                }]),
                reason: "Another thread".to_owned(),
                ..RewriteSuggestion::default()
            },
        )
        .await
        .unwrap();
    assert!(problems(&refused).contains("this suggestion's draft is in email_thread"));
    let refused = h
        .suggest(session, reply_suggestion("thread:reply", Uuid::now_v7()))
        .await;
    assert!(problems(&refused).contains("this suggestion's draft is in email_thread"));
    let reworded = h
        .service
        .rewrite(
            &principal(OWNER),
            Some(session),
            reply.id,
            RewriteSuggestion {
                title: Some("Send the headcount".to_owned()),
                reason: "Clearer".to_owned(),
                ..RewriteSuggestion::default()
            },
        )
        .await
        .unwrap();
    assert!(reworded.ok, "{:?}", reworded.problems);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_the_persons_open_suggestions_session_attaches_drafts(pool: PgPool) {
    let h = harness(pool, true).await;
    let suggestions = h.session(OWNER, "suggestions").await;
    let routines = h.session(OWNER, "routines").await;
    let others = h.session(OTHER, "suggestions").await;
    let thread = Uuid::now_v7();
    let draft = h.drafts.write(OWNER, thread);
    let reply = h
        .suggest(suggestions, reply_suggestion("thread:reply", thread))
        .await
        .suggestion
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
            matches!(result, Err(SuggestionError::NotGenerating)),
            "{result:?}"
        );
    }
    let unknown = h
        .service
        .attach_draft(
            &principal(OWNER),
            Some(suggestions),
            Uuid::now_v7(),
            attach(draft, "Drafted"),
        )
        .await;
    assert!(
        matches!(unknown, Err(SuggestionError::NotFound)),
        "{unknown:?}"
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_unprompted_session_that_cant_be_deleted_keeps_its_run(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .suggestion
        .unwrap();
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run_session = runs.started.lock().unwrap()[0].0;
    runs.set(run_session, SessionState::AwaitingPrompt);
    age_runs(&h.pool, chrono::Duration::minutes(11)).await;
    runs.discard_fails
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(h.service.settle_runs().await.unwrap(), 0);
    assert!(matches!(
        h.accept(&user(OWNER), suggestion.id).await,
        Err(SuggestionError::NotFound)
    ));
    runs.discard_fails
        .store(false, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
    assert_eq!(*runs.discarded.lock().unwrap(), [run_session]);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_feed_keeps_suggestions_done_in_the_last_day(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let mut ids = Vec::new();
    for key in ["a:done", "b:done-yesterday", "c:open", "d:dismissed"] {
        ids.push(
            h.suggest(session, entity_suggestion(key))
                .await
                .suggestion
                .unwrap()
                .id,
        );
    }
    let repo = PgSuggestionRepo::new(h.pool.clone());
    for (id, state) in [
        (ids[0], SuggestionState::Done),
        (ids[1], SuggestionState::Done),
        (ids[3], SuggestionState::Dismissed),
    ] {
        repo.set_state(
            &user(OWNER),
            id,
            &[SuggestionState::Proposed],
            state,
            None,
            Utc::now(),
        )
        .await
        .unwrap();
    }
    sqlx::query!(
        "UPDATE suggestion SET state_changed_at = now() - interval '25 hours' WHERE id = $1",
        ids[1]
    )
    .execute(&h.pool)
    .await
    .unwrap();
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None)
        .await
        .unwrap();
    assert_eq!(
        feed.suggestions
            .iter()
            .map(|suggestion| suggestion.id)
            .collect::<Vec<_>>(),
        [ids[2]]
    );
    assert_eq!(
        feed.done
            .iter()
            .map(|suggestion| suggestion.id)
            .collect::<Vec<_>>(),
        [ids[0]]
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_background_suggestion_says_what_it_sends_and_running_it_approves_that(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "suggestions").await;
    let mut posting = prompt_suggestion("ops:weekly-status", "Post the weekly status summary");
    posting.sends = Some("Posts the weekly status summary in #ops".to_owned());
    let suggestion = h.suggest(session, posting).await.suggestion.unwrap();
    assert!(matches!(
        &suggestion.kind,
        SuggestionKind::Prompt { sends: Some(sends), .. } if sends == "Posts the weekly status summary in #ops"
    ));
    let mut composer = prompt_suggestion("ops:draft", "Draft the status summary");
    composer.run_mode = Some(RunMode::Composer);
    composer.sends = Some("Posts it in #ops".to_owned());
    let refused = h.suggest(session, composer).await;
    assert!(!refused.ok);
    assert!(refused.problems[0].contains("only for background prompt suggestions"));
    let rewritten = h
        .service
        .rewrite(
            &principal(OWNER),
            Some(session),
            suggestion.id,
            RewriteSuggestion {
                sends: Some("Posts the weekly status summary in #ops-leads".to_owned()),
                reason: "The leads channel took over".to_owned(),
                ..RewriteSuggestion::default()
            },
        )
        .await
        .unwrap();
    assert!(rewritten.ok, "{:?}", rewritten.problems);
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let prompt = runs.started.lock().unwrap()[0].1.clone();
    assert!(
        prompt.contains("this run will: Posts the weekly status summary in #ops-leads."),
        "{prompt}"
    );
    assert!(prompt.contains("sendConfirmed"));
}

/// A suggestion retired while its run waits, then suggested again, can't start a
/// second run until the first one settles.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_restored_suggestion_starts_no_second_run_while_its_first_is_going(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .suggestion
        .unwrap();
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run_session = runs.started.lock().unwrap()[0].0;
    runs.set(run_session, SessionState::NeedsApproval);
    let retired = h
        .service
        .retire(
            &principal(OWNER),
            Some(session),
            suggestion.id,
            RetireSuggestionRequest {
                reason: "The quotes expired".to_owned(),
            },
        )
        .await
        .unwrap();
    assert!(retired.ok, "{:?}", retired.problems);
    let restored = h
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Compare the new supplier quotes"),
        )
        .await;
    assert!(restored.ok, "{:?}", restored.problems);
    assert!(matches!(
        h.accept(&user(OWNER), suggestion.id).await,
        Err(SuggestionError::NotFound)
    ));
    assert_eq!(runs.started.lock().unwrap().len(), 1);
    // Once the first run settles failed, the restored suggestion may run.
    runs.set(run_session, SessionState::Failed);
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    assert_eq!(runs.started.lock().unwrap().len(), 2);
}

/// A run whose runtime went away mid-run (a harness restart) doesn't stay
/// running: past its start window its session is deleted, the run fails,
/// and the suggestion may run again.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_cut_off_by_a_restart_is_given_up_and_runs_again(pool: PgPool) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    let session = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(
            session,
            prompt_suggestion("quotes:compare", "Compare the supplier quotes"),
        )
        .await
        .suggestion
        .unwrap();
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run_session = runs.started.lock().unwrap()[0].0;
    runs.set(run_session, SessionState::Disconnected);
    assert_eq!(h.first_run().await.progress, RunProgress::Running);
    assert_eq!(h.service.settle_runs().await.unwrap(), 0);
    age_runs(&h.pool, chrono::Duration::minutes(11)).await;
    assert_eq!(h.service.settle_runs().await.unwrap(), 1);
    assert_eq!(*runs.discarded.lock().unwrap(), [run_session]);
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    assert_eq!(runs.started.lock().unwrap().len(), 2);
}
