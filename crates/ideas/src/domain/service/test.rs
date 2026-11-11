use std::collections::HashSet;
use std::sync::Mutex;

use feature_flags::outbound::fake::FakeFeatureFlags;
use feature_flags::{FlagSnapshot, FlagValue};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use model_entity::EntityType;
use sqlx::PgPool;

use super::*;
use crate::domain::model::{Category, EntityAction, RunMode};
use crate::outbound::pg_idea_repo::PgIdeaRepo;

const OWNER: &str = "macro|suggestions-owner@macro.com";
const OTHER: &str = "macro|suggestions-other@macro.com";

fn user(id: &'static str) -> MacroUserIdStr<'static> {
    MacroUserIdStr::parse_from_str(id).unwrap()
}

/// Items the person can open: all but those named in `denied`. A part is
/// its item's when its id starts with the item's.
#[derive(Default)]
struct FakeAccess {
    denied: Mutex<HashSet<String>>,
}

impl IdeaAccess for FakeAccess {
    type Err = std::convert::Infallible;

    async fn can_view(&self, _: &MacroUserIdStr<'_>, target: &Target) -> Result<bool, Self::Err> {
        Ok(!self.denied.lock().unwrap().contains(&target.entity_id))
    }

    async fn is_part_of(&self, target: &Target, part: &str) -> Result<bool, Self::Err> {
        Ok(part.starts_with(&target.entity_id))
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

type Service = IdeaService<PgIdeaRepo, FakeAccess, FakeFeatureFlags>;

struct Harness {
    service: Service,
    access: Arc<FakeAccess>,
    pool: PgPool,
}

async fn harness(pool: PgPool, flag: bool) -> Harness {
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
    Harness {
        service: IdeaService::new(
            Arc::new(PgIdeaRepo::new(pool.clone())),
            Arc::clone(&access),
            Arc::new(SameSession),
            Some(flags),
        ),
        access,
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
        action: None,
        reason: None,
    }
}

fn entity_idea(key: &str) -> SuggestIdea {
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
        action: Some(EntityAction::Reply),
        reason: None,
    }
}

impl Harness {
    /// An open session of `kind` in `owner`'s running generation, started
    /// when none is running.
    async fn session(&self, owner: &str, kind: &str) -> Uuid {
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

    async fn suggest(&self, session: Uuid, request: SuggestIdea) -> IdeaWriteOutcome {
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
        }
    );
    assert_eq!(
        h.changes(idea.id).await,
        vec![(
            "created".to_owned(),
            Some("Three quotes for the same order".to_owned())
        )]
    );
    let feed = h.service.feed(&user(OWNER)).await.unwrap();
    assert_eq!(feed.ideas, vec![idea]);
    assert!(h.service.feed(&user(OTHER)).await.unwrap().ideas.is_empty());
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
        h.service.feed(&user(OWNER)).await,
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
    assert_eq!(h.service.feed(&user(OWNER)).await.unwrap().ideas.len(), 1);
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
    assert!(h.service.feed(&user(OWNER)).await.unwrap().ideas.is_empty());
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
    assert!(h.service.feed(&user(OWNER)).await.unwrap().ideas.is_empty());
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

/// A part is kept only with the item it belongs to.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn an_idea_names_a_part_only_with_its_own_item(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "ideas").await;
    let with_part = |key: &str, part: &str| {
        let mut idea = prompt_idea(key, "Compare quotes");
        idea.about[0].part_id = Some(part.to_owned());
        idea
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
    let feed = h.service.feed(&user(OWNER)).await.unwrap();
    assert_eq!(feed.ideas.len(), 1);
    assert_eq!(
        feed.ideas[0].about[0].part_id.as_deref(),
        Some("thread-1:message")
    );
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn the_feed_hides_ideas_about_items_the_person_lost(pool: PgPool) {
    let h = harness(pool, true).await;
    let session = h.session(OWNER, "ideas").await;
    h.suggest(session, prompt_idea("quotes:compare", "Compare quotes"))
        .await;
    h.suggest(session, entity_idea("venue:headcount")).await;
    let feed = h.service.feed(&user(OWNER)).await.unwrap();
    // Best first.
    assert_eq!(feed.ideas[0].dedup_key, "venue:headcount");
    h.access
        .denied
        .lock()
        .unwrap()
        .insert("thread-2".to_owned());
    let feed = h.service.feed(&user(OWNER)).await.unwrap();
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
    // Acting on an idea that isn't a background run finishes it: it shows
    // in the feed's done list, and accepting it again changes nothing.
    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    let feed = h.service.feed(&user(OWNER)).await.unwrap();
    assert!(feed.ideas.is_empty());
    assert_eq!(feed.done[0].id, idea.id);
    assert_eq!(feed.done[0].state, IdeaState::Done);
    h.service.accept(&user(OWNER), idea.id).await.unwrap();
    assert!(matches!(
        h.service.dismiss(&user(OWNER), idea.id).await,
        Err(IdeaError::NotFound)
    ));
    // A background prompt is taken on, not done: it runs.
    let background = h
        .suggest(session, prompt_idea("quotes:compare", "Compare quotes"))
        .await
        .idea
        .unwrap();
    h.service.accept(&user(OWNER), background.id).await.unwrap();
    assert_eq!(
        h.service.feed(&user(OWNER)).await.unwrap().ideas[0].state,
        IdeaState::Accepted
    );
    h.service
        .dismiss(&user(OWNER), background.id)
        .await
        .unwrap();
    assert!(matches!(
        h.service.dismiss(&user(OWNER), background.id).await,
        Err(IdeaError::NotFound)
    ));
}

/// The feed keeps ideas done in the last day, newest first, apart from the
/// open ones; older ones and other closed ones leave it.
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
        "UPDATE suggestion SET state_changed_at = now() - interval '25 hours' WHERE id = $1",
        ids[1]
    )
    .execute(&h.pool)
    .await
    .unwrap();
    let feed = h.service.feed(&user(OWNER)).await.unwrap();
    assert_eq!(
        feed.ideas.iter().map(|idea| idea.id).collect::<Vec<_>>(),
        [ids[2]]
    );
    assert_eq!(
        feed.done.iter().map(|idea| idea.id).collect::<Vec<_>>(),
        [ids[0]]
    );
}
