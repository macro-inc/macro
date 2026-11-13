use std::collections::{HashMap, HashSet};
use std::sync::Mutex;

use feature_flags::outbound::fake::FakeFeatureFlags;
use feature_flags::{FlagSnapshot, FlagValue};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_entity::EntityType;
use sqlx::PgPool;

use super::*;
use crate::domain::model::{
    Category, EntityAction, ResolveReason, RunMode, SuggestionDraft, SuggestionStatus, Waiting,
};
use crate::domain::ports::{FoundDraft, ReplyWaits};
use crate::outbound::pg_suggestion_repo::PgSuggestionRepo;

pub(crate) mod runs;

pub(crate) const OWNER: &str = "macro|suggestions-owner@macro.com";
const OTHER: &str = "macro|suggestions-other@macro.com";

pub(crate) fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

/// Items the person can open: all but those named in `denied`; those in
/// `failing` can't be checked. A part is its item's when its id starts with
/// the item's.
#[derive(Default)]
pub(crate) struct FakeAccess {
    denied: Mutex<HashSet<String>>,
    failing: Mutex<HashSet<String>>,
}

/// The access check couldn't answer.
#[derive(Debug, thiserror::Error)]
#[error("the access check is down")]
pub(crate) struct AccessDown;

impl SuggestionAccess for FakeAccess {
    type Err = AccessDown;

    async fn can_view(&self, _: &MacroUserIdStr<'_>, target: &Target) -> Result<bool, Self::Err> {
        if self.failing.lock().unwrap().contains(&target.entity_id) {
            return Err(AccessDown);
        }
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

    async fn email_draft(
        &self,
        user: &MacroUserIdStr<'_>,
        draft: Uuid,
    ) -> Result<Option<FoundDraft>, Self::Err> {
        Ok(self
            .0
            .lock()
            .unwrap()
            .get(&draft)
            .filter(|(owner, _)| *owner == user.as_ref())
            .map(|(_, thread)| FoundDraft {
                thread: *thread,
                preview: Some(DRAFT_PREVIEW.to_owned()),
            }))
    }
}

/// What every fake draft says.
pub(crate) const DRAFT_PREVIEW: &str = "Thanks, see you Monday";

/// Who each item waits on the person for, by item id; items in `failing`
/// can't be read.
#[derive(Default)]
pub(crate) struct FakeWaits {
    waiting: Mutex<HashMap<String, Waiting>>,
    failing: Mutex<HashSet<String>>,
}

#[async_trait::async_trait]
impl ReplyWaits for FakeWaits {
    async fn waiting(
        &self,
        _: &MacroUserIdStr<'_>,
        target: &Target,
    ) -> Result<Option<Waiting>, rootcause::Report> {
        if self.failing.lock().unwrap().contains(&target.entity_id) {
            return Err(rootcause::report!("the item is unreadable"));
        }
        Ok(self.waiting.lock().unwrap().get(&target.entity_id).cloned())
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

pub(crate) type Service =
    SuggestionService<PgSuggestionRepo, FakeAccess, FakeDrafts, FakeFeatureFlags>;

pub(crate) struct Harness {
    pub(crate) service: Service,
    access: Arc<FakeAccess>,
    drafts: Arc<FakeDrafts>,
    waits: Arc<FakeWaits>,
    audience: Arc<FakeAudience>,
    dismissal: Arc<FakeDismissal>,
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
    let waits = Arc::new(FakeWaits::default());
    let audience = Arc::new(FakeAudience::default());
    let dismissal = Arc::new(FakeDismissal::default());
    Harness {
        service: SuggestionService::new(
            Arc::new(PgSuggestionRepo::new(pool.clone())),
            Arc::clone(&access),
            Arc::clone(&drafts),
            Arc::new(SameSession),
            Arc::new(RowSessions(pool.clone())),
            audience.clone(),
            dismissal.clone(),
            Some(flags),
        )
        .with_reply_waits(waits.clone()),
        access,
        drafts,
        waits,
        audience,
        dismissal,
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
    pub(crate) async fn accept(
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
            None,
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
            .feed(&user(OTHER), SuggestionCaller::User, None, None)
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
            .feed(&user(OWNER), SuggestionCaller::User, None, None)
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
            .feed(&user(OWNER), SuggestionCaller::User, None, None)
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
            .feed(&user(OWNER), SuggestionCaller::User, None, None)
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
            .feed(&user(OWNER), SuggestionCaller::User, None, None)
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
        .feed(&user(OWNER), SuggestionCaller::User, None, None)
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
        .feed(&user(OWNER), SuggestionCaller::User, None, None)
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
        .feed(&user(OWNER), SuggestionCaller::User, None, None)
        .await
        .unwrap();
    assert_eq!(feed.suggestions.len(), 1);
    assert_eq!(feed.suggestions[0].dedup_key, "quotes:compare");
}


/// One suggestion whose items can't be checked is left out; the rest of the
/// feed is read.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_suggestion_whose_items_cant_be_checked_is_left_out_of_the_feed(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    h.suggest(
        session,
        prompt_suggestion("quotes:compare", "Compare quotes"),
    )
    .await;
    h.suggest(session, entity_suggestion("venue:headcount"))
        .await;
    h.access
        .failing
        .lock()
        .unwrap()
        .insert("thread-2".to_owned());
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None, None)
        .await
        .unwrap();
    assert_eq!(
        feed.suggestions
            .iter()
            .map(|suggestion| suggestion.dedup_key.as_str())
            .collect::<Vec<_>>(),
        ["quotes:compare"]
    );
}

/// `limit` caps the open list, best first, and leaves out done; the counts
/// count every suggestion the person can open either way.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_feed_returns_at_most_limit_open_suggestions_and_counts_all(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let mut ids = Vec::new();
    for (key, importance) in [("a:low", 20), ("b:high", 90), ("c:mid", 50), ("d:top", 99)] {
        let mut request = entity_suggestion(key);
        request.importance = importance;
        request.about[0].entity_id = format!("thread-{key}");
        ids.push(h.suggest(session, request).await.suggestion.unwrap().id);
    }
    // The best can't be opened: the next ones fill its place.
    h.access
        .denied
        .lock()
        .unwrap()
        .insert("thread-d:top".to_owned());
    let repo = PgSuggestionRepo::new(h.pool.clone());
    let mut done = Vec::new();
    for key in ["e:done-first", "f:done-last"] {
        let mut request = entity_suggestion(key);
        request.about[0].entity_id = format!("thread-{key}");
        let id = h.suggest(session, request).await.suggestion.unwrap().id;
        repo.set_state(
            &user(OWNER),
            id,
            &[SuggestionState::Proposed],
            SuggestionState::Done,
            None,
            Utc::now(),
        )
        .await
        .unwrap();
        done.push(id);
    }
    let keys = |list: &[Suggestion]| {
        list.iter()
            .map(|suggestion| suggestion.dedup_key.clone())
            .collect::<Vec<_>>()
    };
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None, Some(2))
        .await
        .unwrap();
    assert_eq!(keys(&feed.suggestions), ["b:high", "c:mid"]);
    assert_eq!(feed.done, None);
    let counts = FeedCounts {
        open: 3,
        running: 0,
        failed: 0,
        done: 2,
    };
    assert_eq!(feed.counts, counts);
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None, Some(1))
        .await
        .unwrap();
    assert_eq!(keys(&feed.suggestions), ["b:high"]);
    assert_eq!(feed.done, None);
    assert_eq!(feed.counts, counts);
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None, None)
        .await
        .unwrap();
    assert_eq!(keys(&feed.suggestions), ["b:high", "c:mid", "a:low"]);
    let done = feed.done.unwrap();
    assert_eq!(keys(&done), ["f:done-last", "e:done-first"]);
    assert_eq!(feed.counts, counts);
    assert!(feed.suggestions.iter().all(|suggestion| suggestion.status == SuggestionStatus::Open));
    assert!(done.iter().all(|suggestion| suggestion.status == SuggestionStatus::Done));
}

/// Reading the feed counts the person in once per timezone while it is
/// remembered, and again when they read it from another one.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn reading_the_feed_counts_the_person_in_once_per_timezone(pool: PgPool) {
    let h = harness(pool, true).await;
    for timezone in [
        chrono_tz::Europe::Paris,
        chrono_tz::Europe::Paris,
        chrono_tz::Europe::London,
        chrono_tz::Europe::Paris,
    ] {
        h.service
            .feed(&user(OWNER), SuggestionCaller::User, Some(timezone), None)
            .await
            .unwrap();
    }
    assert_eq!(
        h.audience
            .0
            .lock()
            .unwrap()
            .iter()
            .map(|(_, timezone)| timezone.as_str())
            .collect::<Vec<_>>(),
        ["Europe/Paris", "Europe/London", "Europe/Paris"]
    );
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
        .feed(&user(OWNER), SuggestionCaller::User, None, None)
        .await
        .unwrap();
    assert!(feed.suggestions.is_empty());
    let done = feed.done.unwrap();
    assert_eq!(done[0].id, suggestion.id);
    assert_eq!(done[0].state, SuggestionState::Done);
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
        .feed(&user(OWNER), chat_agent(), None, None)
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
        .feed(&user(OWNER), chat_agent(), None, None)
        .await
        .unwrap();
    assert!(feed.suggestions.is_empty());
    let done = feed.done.unwrap();
    assert_eq!(done[0].id, prompt.id);
    assert_eq!(done[0].state, SuggestionState::Done);
    assert_eq!(done[0].kind, prompt.kind);
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
            .feed(&user(OTHER), chat_agent(), None, None)
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
        .feed(&user(OWNER), SuggestionCaller::User, None, None)
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
            .feed(&user(OWNER), caller, Some(chrono_tz::Europe::Paris), None)
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
        .feed(&user(OWNER), SuggestionCaller::User, None, None)
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

    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None, None)
        .await
        .unwrap();
    let card = feed.suggestions[0].clone();
    assert_eq!(
        card.kind,
        SuggestionKind::Routine {
            routine_suggestion_id: suggestion
        }
    );
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
    // The person dismissing it dismisses its suggestion, which closes both.
    h.service
        .dismiss(&user(OWNER), SuggestionCaller::User, card.id)
        .await
        .unwrap();
    assert_eq!(*h.dismissal.0.lock().unwrap(), [suggestion]);
    // It never comes back by restoring: its suggestion has no way back.
    assert!(matches!(
        h.service
            .restore(&user(OWNER), SuggestionCaller::User, card.id)
            .await,
        Err(SuggestionError::NotRestorable)
    ));
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
        draft: Some(SuggestionDraft {
            target: draft_target(thread, mine),
            preview: Some(DRAFT_PREVIEW.to_owned()),
        }),
        waiting_since: None,
        from: None,
    };
    assert_eq!(attached.suggestion.unwrap().kind, expected);
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None, None)
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
            draft: Some(SuggestionDraft {
                target: draft_target(thread, second),
                preview: Some(DRAFT_PREVIEW.to_owned()),
            }),
            waiting_since: None,
            from: None,
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
        .feed(&user(OWNER), SuggestionCaller::User, None, None)
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
            .unwrap()
            .iter()
            .map(|suggestion| suggestion.id)
            .collect::<Vec<_>>(),
        [ids[0]]
    );
}

/// Who a reply waits on, read from its item when a session writes it: kept
/// when the item can't be read, and never read for other suggestions.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_reply_suggestion_shows_who_it_waits_on(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let (asked, quiet) = (Uuid::now_v7(), Uuid::now_v7());
    // Stored to the microsecond.
    let since = chrono::TimeZone::with_ymd_and_hms(&Utc, 2026, 11, 2, 9, 30, 0).unwrap();
    h.waits.waiting.lock().unwrap().insert(
        asked.to_string(),
        Waiting {
            since,
            from: Some("Ada Lovelace".to_owned()),
        },
    );
    let waiting_of = |suggestion: &Suggestion| match &suggestion.kind {
        SuggestionKind::Entity {
            waiting_since,
            from,
            ..
        } => (*waiting_since, from.clone()),
        other => panic!("not an entity suggestion: {other:?}"),
    };
    let reply = h
        .suggest(session, reply_suggestion("thread:reply", asked))
        .await
        .suggestion
        .unwrap();
    let expected = (Some(since), Some("Ada Lovelace".to_owned()));
    assert_eq!(waiting_of(&reply), expected);
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None, None)
        .await
        .unwrap();
    assert_eq!(waiting_of(&feed.suggestions[0]), expected);

    // The item can't be read: what it showed stays.
    h.waits.failing.lock().unwrap().insert(asked.to_string());
    let mut again = reply_suggestion("thread:reply", asked);
    again.title = "Answer the venue today".to_owned();
    let rewritten = h.suggest(session, again).await.suggestion.unwrap();
    assert_eq!(waiting_of(&rewritten), expected);

    // About an item nobody waits on: nobody.
    let moved = h
        .service
        .rewrite(
            &principal(OWNER),
            Some(session),
            reply.id,
            RewriteSuggestion {
                about: Some(vec![Target {
                    entity_type: EntityType::EmailThread,
                    entity_id: quiet.to_string(),
                    part_id: None,
                }]),
                reason: "It moved to another thread".to_owned(),
                ..RewriteSuggestion::default()
            },
        )
        .await
        .unwrap();
    assert!(moved.ok, "{:?}", moved.problems);
    assert_eq!(waiting_of(&moved.suggestion.unwrap()), (None, None));

    // A suggestion to review the same thread shows no one.
    let mut review = entity_suggestion("thread:review");
    review.action = Some(EntityAction::Review);
    review.about = reply_suggestion("thread:review", asked).about;
    h.waits.failing.lock().unwrap().clear();
    let review = h.suggest(session, review).await.suggestion.unwrap();
    assert_eq!(waiting_of(&review), (None, None));
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn resolving_a_reply_clears_who_it_waits_on(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let thread = Uuid::now_v7();
    h.waits.waiting.lock().unwrap().insert(
        thread.to_string(),
        Waiting {
            since: Utc::now(),
            from: Some("Ada Lovelace".to_owned()),
        },
    );
    let reply = h
        .suggest(session, reply_suggestion("thread:reply", thread))
        .await
        .suggestion
        .unwrap();
    let repo = PgSuggestionRepo::new(h.pool.clone());
    assert!(
        repo.resolve(&user(OWNER), reply.id, ResolveReason::Replied, Utc::now())
            .await
            .unwrap()
    );
    let resolved = repo.suggestion(&user(OWNER), reply.id).await.unwrap().unwrap();
    assert!(matches!(
        resolved.kind,
        SuggestionKind::Entity {
            waiting_since: None,
            from: None,
            ..
        }
    ));
}

/// The person takes back a dismissal within five minutes of it: the
/// suggestion is proposed again. Later, or anything not dismissed, is refused.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_person_restores_a_suggestion_they_just_dismissed(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(session, entity_suggestion("venue:headcount"))
        .await
        .suggestion
        .unwrap();
    let restore = |who: &'static str| {
        let service = &h.service;
        async move {
            service
                .restore(&user(who), SuggestionCaller::User, suggestion.id)
                .await
        }
    };
    assert!(matches!(
        restore(OWNER).await,
        Err(SuggestionError::NotRestorable)
    ));
    h.service
        .dismiss(&user(OWNER), SuggestionCaller::User, suggestion.id)
        .await
        .unwrap();
    assert!(matches!(restore(OTHER).await, Err(SuggestionError::NotFound)));
    // Hidden sessions only manage the feed through their own tools.
    assert!(matches!(
        h.service
            .restore(
                &user(OWNER),
                SuggestionCaller::Agent {
                    correlation: Some(session),
                },
                suggestion.id,
            )
            .await,
        Err(SuggestionError::Generating)
    ));
    restore(OWNER).await.unwrap();
    let feed = h
        .service
        .feed(&user(OWNER), SuggestionCaller::User, None, None)
        .await
        .unwrap();
    assert_eq!(feed.suggestions[0].id, suggestion.id);
    assert_eq!(feed.suggestions[0].state, SuggestionState::Proposed);
    assert_eq!(feed.suggestions[0].status, SuggestionStatus::Open);
    assert_eq!(h.changes(suggestion.id).await.len(), 1, "restoring logs no change");

    // Dismissed longer ago than the window: it stays dismissed.
    h.service
        .dismiss(&user(OWNER), SuggestionCaller::User, suggestion.id)
        .await
        .unwrap();
    sqlx::query!(
        "UPDATE suggestion SET state_changed_at = now() - interval '6 minutes' WHERE id = $1",
        suggestion.id,
    )
    .execute(&h.pool)
    .await
    .unwrap();
    assert!(matches!(
        restore(OWNER).await,
        Err(SuggestionError::NotRestorable)
    ));
    let stored = PgSuggestionRepo::new(h.pool.clone())
        .suggestion(&user(OWNER), suggestion.id)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.state, SuggestionState::Dismissed);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn restoring_is_gated_on_the_flag(pool: PgPool) {
    let off = harness(pool, false).await;
    assert!(matches!(
        off.service
            .restore(&user(OWNER), SuggestionCaller::User, Uuid::now_v7())
            .await,
        Err(SuggestionError::NotFound)
    ));
}
