//! Background runs, through the service: starting one, and moving it along
//! from its session's lifecycle events and the reconcile sweep.

use crate::domain::model::{RunStartError, SessionReadError, SessionState, StoredRun};
use crate::domain::ports::{RunEventOutcome, RunsReconciled, SuggestionRuns};
use crate::domain::run::{Advanced, RunStateName, SessionEvent, SessionNews};

use super::*;

/// How the fake's next start goes.
#[derive(Default, Clone, Copy, PartialEq)]
enum StartsAs {
    #[default]
    Started,
    NotStarted,
    Uncertain,
}

/// A run the fake started.
#[derive(Clone)]
pub(crate) struct Started {
    pub(crate) session: Uuid,
    pub(crate) action: Uuid,
    pub(crate) prompt: String,
}

/// Run sessions whose state the test sets, recording what they started,
/// stopped and deleted. A session with no state set is missing; one in
/// `unreadable` exists but can't be read. A stopped session's turn ends
/// unfinished, unless `stops_ignored`.
#[derive(Default)]
pub(crate) struct FakeRuns {
    started: Mutex<Vec<Started>>,
    state: Mutex<HashMap<Uuid, SessionState>>,
    unreadable: Mutex<HashSet<Uuid>>,
    stopped: Mutex<Vec<Uuid>>,
    stops_ignored: std::sync::atomic::AtomicBool,
    deleted: Mutex<Vec<Uuid>>,
    delete_fails: std::sync::atomic::AtomicBool,
    starts_as: Mutex<StartsAs>,
}

impl FakeRuns {
    fn set(&self, session: Uuid, state: SessionState) {
        self.state.lock().unwrap().insert(session, state);
    }

    fn started(&self) -> Vec<Started> {
        self.started.lock().unwrap().clone()
    }

    pub(crate) fn last(&self) -> Started {
        self.started().pop().unwrap()
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
        self.started.lock().unwrap().push(Started {
            session: run.session,
            action: run.action,
            prompt: prompt.to_owned(),
        });
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

    /// A document, twice, and the session itself: what the run made, once each.
    async fn produced(&self, run: &StoredRun) -> Result<Vec<Target>, rootcause::Report> {
        Ok(vec![
            comparison_doc(),
            comparison_doc(),
            session_target(run.session),
        ])
    }

    async fn stop(&self, run: &StoredRun) -> Result<(), rootcause::Report> {
        self.stopped.lock().unwrap().push(run.session);
        if !self.stops_ignored.load(std::sync::atomic::Ordering::SeqCst) {
            self.set(run.session, SessionState::Failed);
        }
        Ok(())
    }

    async fn delete(&self, run: &StoredRun) -> Result<(), rootcause::Report> {
        if self.delete_fails.load(std::sync::atomic::Ordering::SeqCst) {
            return Err(rootcause::report!("the session wasn't deleted"));
        }
        self.deleted.lock().unwrap().push(run.session);
        self.state.lock().unwrap().remove(&run.session);
        Ok(())
    }
}

const RUN_AGENT: Uuid = Uuid::from_u128(0xa2a2);

fn comparison_doc() -> Target {
    Target {
        entity_type: EntityType::Document,
        entity_id: "comparison-doc".to_owned(),
        part_id: None,
    }
}

fn session_target(session: Uuid) -> Target {
    Target {
        entity_type: EntityType::AgentSession,
        entity_id: session.to_string(),
        part_id: None,
    }
}

/// A harness whose service runs background suggestions in a [`FakeRuns`].
pub(crate) async fn run_harness(pool: PgPool) -> (Harness, Arc<FakeRuns>) {
    let mut h = harness(pool, true).await;
    let runs = Arc::new(FakeRuns::default());
    h.service = h.service.with_runs(runs.clone(), RUN_AGENT);
    (h, runs)
}

impl Harness {
    /// A background prompt suggestion of the person's, from a suggestions
    /// session.
    pub(crate) async fn background(&self, key: &str) -> Suggestion {
        let session = self.session(OWNER, "suggestions").await;
        self.suggest(session, prompt_suggestion(key, "Compare the supplier quotes"))
            .await
            .suggestion
            .unwrap()
    }

    /// Suggestion `id` as the person's feed shows it, open or done.
    async fn in_feed(&self, id: Uuid) -> Option<Suggestion> {
        let feed = self
            .service
            .feed(&user(OWNER), SuggestionCaller::User, None, None)
            .await
            .unwrap();
        feed.suggestions
            .into_iter()
            .chain(feed.done.into_iter().flatten())
            .find(|suggestion| suggestion.id == id)
    }

    /// Suggestion `id` as stored.
    pub(crate) async fn stored(&self, id: Uuid) -> Suggestion {
        PgSuggestionRepo::new(self.pool.clone())
            .suggestion(&user(OWNER), id)
            .await
            .unwrap()
            .unwrap()
    }

    /// Where run `session` is, as stored.
    pub(crate) async fn run_state(&self, session: Uuid) -> RunStateName {
        PgSuggestionRepo::new(self.pool.clone())
            .run(session)
            .await
            .unwrap()
            .unwrap()
            .state
            .name()
    }

    /// Suggestions session `session` rewrites suggestion `id` with `change`.
    async fn rewrite_as(
        &self,
        session: Uuid,
        id: Uuid,
        change: RewriteSuggestion,
    ) -> SuggestionWriteOutcome {
        self.service
            .rewrite(
                &principal(OWNER),
                Some(session),
                id,
                RewriteSuggestion {
                    reason: "Things moved".to_owned(),
                    ..change
                },
            )
            .await
            .unwrap()
    }

    async fn reconcile(&self) -> RunsReconciled {
        self.service.reconcile_runs().await.unwrap()
    }

    /// One sweep moves run `session`, and only it, to `to`.
    async fn sweeps_to(&self, session: Uuid, to: RunStateName) {
        let expected = RunsReconciled {
            checked: 1,
            moved: 1,
            settled: usize::from(to.is_settled()),
            failed: 0,
        };
        assert_eq!(self.reconcile().await, expected, "to {to:?}");
        assert_eq!(self.run_state(session).await, to);
    }

    async fn news(&self, session: Uuid, news: SessionNews) -> RunEventOutcome {
        self.service
            .on_session_event(SessionEvent { session, news })
            .await
            .unwrap()
    }
}

/// Age every run as if it started, and entered its state, `by` earlier.
async fn age_runs(pool: &PgPool, by: chrono::Duration) {
    sqlx::query!(
        r#"UPDATE suggestion_run
           SET started_at = started_at - $1::interval,
               state_changed_at = state_changed_at - $1::interval"#,
        sqlx::postgres::types::PgInterval::try_from(by).unwrap(),
    )
    .execute(pool)
    .await
    .unwrap();
}

const STAYED: RunsReconciled = RunsReconciled {
    checked: 1,
    moved: 0,
    settled: 0,
    failed: 0,
};

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn accepting_a_background_prompt_suggestion_runs_it_and_its_turn_ending_finishes_it(
    pool: PgPool,
) {
    let (h, runs) = run_harness(pool).await;
    let suggestion = h.background("quotes:compare").await;
    assert_eq!(suggestion.status, SuggestionStatus::Open);

    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let started = runs.started();
    assert_eq!(started.len(), 1);
    assert!(
        started[0]
            .prompt
            .starts_with("Compare the supplier quotes in my inbox and list the cheapest.\n\n"),
        "{}",
        started[0].prompt
    );
    assert!(started[0].prompt.contains("never stop to ask"));
    assert!(started[0].prompt.contains("Post, send or share nothing:"));
    // A run going can't be started twice.
    assert!(matches!(
        h.accept(&user(OWNER), suggestion.id).await,
        Err(SuggestionError::NotFound)
    ));
    let run = started[0].session;
    let shown = h.in_feed(suggestion.id).await.unwrap();
    assert_eq!(shown.state, SuggestionState::Accepted);
    assert_eq!(shown.status, SuggestionStatus::Running);
    let shown_run = shown.run.unwrap();
    assert_eq!(
        (shown_run.session_id, shown_run.state),
        (run, RunStateName::Running)
    );

    // Events about other sessions, or other turns, change nothing.
    assert_eq!(
        h.news(Uuid::now_v7(), SessionNews::Deleted).await,
        RunEventOutcome::Ignored
    );
    assert_eq!(
        h.news(
            run,
            SessionNews::TurnEnded {
                action: Uuid::now_v7(),
                finished: true,
            },
        )
        .await,
        RunEventOutcome::Applied(Advanced::Stayed)
    );

    // Its turn ending as asked finishes it: the suggestion is done with the
    // session and what it made, once each.
    assert_eq!(
        h.news(
            run,
            SessionNews::TurnEnded {
                action: started[0].action,
                finished: true,
            },
        )
        .await,
        RunEventOutcome::Applied(Advanced::Moved(RunStateName::Finished))
    );
    let done = h.stored(suggestion.id).await;
    assert_eq!(done.state, SuggestionState::Done);
    assert_eq!(done.produced, [session_target(run), comparison_doc()]);
    assert_eq!(
        h.in_feed(suggestion.id).await.unwrap().status,
        SuggestionStatus::Done
    );
    // A settled run takes no more events.
    assert_eq!(
        h.news(run, SessionNews::Deleted).await,
        RunEventOutcome::Ignored
    );
    assert_eq!(h.reconcile().await, RunsReconciled::default());
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_failed_run_is_retried_by_accepting_again(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
    let suggestion = h.background("quotes:compare").await;
    // A session that never opened leaves the suggestion to try again.
    *runs.starts_as.lock().unwrap() = StartsAs::NotStarted;
    assert!(matches!(
        h.accept(&user(OWNER), suggestion.id).await,
        Err(SuggestionError::Internal(_))
    ));
    *runs.starts_as.lock().unwrap() = StartsAs::Started;
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run = runs.last();
    assert_eq!(
        h.news(
            run.session,
            SessionNews::TurnEnded {
                action: run.action,
                finished: false,
            },
        )
        .await,
        RunEventOutcome::Applied(Advanced::Moved(RunStateName::Failed))
    );
    let shown = h.in_feed(suggestion.id).await.unwrap();
    assert_eq!(shown.state, SuggestionState::Accepted);
    assert_eq!(shown.status, SuggestionStatus::Failed);
    assert_eq!(shown.run.unwrap().state, RunStateName::Failed);
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    assert_eq!(runs.started().len(), 2);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn accepting_any_other_suggestion_starts_no_run(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
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
    assert!(runs.started().is_empty());
    for id in [composer.id, entity.id] {
        let shown = h.in_feed(id).await.unwrap();
        assert!(shown.run.is_none());
        assert_eq!(shown.status, SuggestionStatus::Done);
    }
}

/// Someone acting for the person (an agent of theirs) takes a background
/// suggestion on but never starts its run; the person starts it in the app.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_the_person_starts_a_background_run(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
    let suggestion = h.background("quotes:compare").await;
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
    assert!(runs.started().is_empty());
    let shown = h.in_feed(suggestion.id).await.unwrap();
    assert_eq!(shown.state, SuggestionState::Accepted);
    assert_eq!(shown.status, SuggestionStatus::Open);
    assert!(shown.run.is_none());
    // Again, still nothing runs.
    h.service
        .accept(
            &user(OWNER),
            agent(),
            suggestion.id,
            as_agent(shown.updated_at),
        )
        .await
        .unwrap();
    assert!(runs.started().is_empty());
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    assert_eq!(runs.started().len(), 1);
}

/// What runs is what the person saw: a card read before the suggestion was
/// rewritten is refused, and runs once read again.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_background_suggestion_runs_only_as_the_person_saw_it(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
    let session = h.session(OWNER, "suggestions").await;
    let suggestion = h
        .suggest(session, prompt_suggestion("quotes:compare", "Compare quotes"))
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
    assert!(runs.started().is_empty());
    h.service
        .accept(
            &user(OWNER),
            SuggestionCaller::User,
            suggestion.id,
            as_person(rewritten.suggestion.unwrap().updated_at),
        )
        .await
        .unwrap();
    assert!(
        runs.last()
            .prompt
            .starts_with("Compare the quotes and email the cheapest supplier.")
    );
}

/// A run waiting for an approval or an answer gets none: ten minutes after
/// it began waiting it is stopped, and once its turn ends it fails, so the
/// suggestion may run again.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_left_waiting_is_stopped_and_runs_again(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
    let approval = h.background("quotes:approval").await;
    h.accept(&user(OWNER), approval.id).await.unwrap();
    runs.set(runs.last().session, SessionState::NeedsApproval);
    // Waiting for an answer is said by its event.
    let input = h.background("quotes:input").await;
    h.accept(&user(OWNER), input.id).await.unwrap();
    let asking = runs.last();
    runs.set(asking.session, SessionState::NeedsInput);
    assert_eq!(
        h.news(
            asking.session,
            SessionNews::WaitingForInput {
                action: asking.action,
            },
        )
        .await,
        RunEventOutcome::Applied(Advanced::Moved(RunStateName::Waiting))
    );
    let reconciled = h.reconcile().await;
    assert_eq!((reconciled.checked, reconciled.moved), (2, 1));
    // Waiting is measured from when it began.
    age_runs(&h.pool, chrono::Duration::minutes(9)).await;
    assert_eq!(h.reconcile().await.moved, 0);
    assert!(runs.stopped.lock().unwrap().is_empty());
    age_runs(&h.pool, chrono::Duration::minutes(2)).await;
    let reconciled = h.reconcile().await;
    assert_eq!((reconciled.moved, reconciled.settled), (2, 0));
    assert_eq!(runs.stopped.lock().unwrap().len(), 2);
    for suggestion in [approval.id, input.id] {
        let shown = h.in_feed(suggestion).await.unwrap();
        assert_eq!(shown.run.unwrap().state, RunStateName::Stopping);
        assert_eq!(shown.status, SuggestionStatus::Running);
    }
    // The stop ended their turns.
    assert_eq!(h.reconcile().await.settled, 2);
    for suggestion in [approval.id, input.id] {
        assert_eq!(
            h.in_feed(suggestion).await.unwrap().status,
            SuggestionStatus::Failed
        );
    }
    h.accept(&user(OWNER), approval.id).await.unwrap();
    assert_eq!(runs.started().len(), 3);
}

/// A run that goes on past its time is stopped, and its session deleted when
/// it doesn't stop within its grace.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_over_its_time_is_stopped_then_deleted(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
    let suggestion = h.background("quotes:compare").await;
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run = runs.last().session;
    runs.stops_ignored
        .store(true, std::sync::atomic::Ordering::SeqCst);
    age_runs(&h.pool, chrono::Duration::minutes(59)).await;
    assert_eq!(h.reconcile().await, STAYED);
    age_runs(&h.pool, chrono::Duration::minutes(1)).await;
    h.sweeps_to(run, RunStateName::Stopping).await;
    assert_eq!(*runs.stopped.lock().unwrap(), [run]);
    // Still working: asked again to stop, within its grace.
    age_runs(&h.pool, chrono::Duration::minutes(4)).await;
    assert_eq!(h.reconcile().await, STAYED);
    assert_eq!(runs.stopped.lock().unwrap().len(), 2);
    assert!(runs.deleted.lock().unwrap().is_empty());
    age_runs(&h.pool, chrono::Duration::minutes(1)).await;
    h.sweeps_to(run, RunStateName::Failed).await;
    assert_eq!(*runs.deleted.lock().unwrap(), [run]);
    assert_eq!(h.run_state(run).await, RunStateName::Failed);
}

/// A run whose runtime went away mid-run (a harness restart) waits for
/// nothing: it is stopped after its wait window, deleted after its grace,
/// and the suggestion may run again.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_cut_off_by_a_restart_is_given_up_and_runs_again(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
    let suggestion = h.background("quotes:compare").await;
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run = runs.last().session;
    runs.set(run, SessionState::Disconnected);
    runs.stops_ignored
        .store(true, std::sync::atomic::Ordering::SeqCst);
    h.sweeps_to(run, RunStateName::Waiting).await;
    age_runs(&h.pool, chrono::Duration::minutes(10)).await;
    h.sweeps_to(run, RunStateName::Stopping).await;
    age_runs(&h.pool, chrono::Duration::minutes(5)).await;
    h.sweeps_to(run, RunStateName::Failed).await;
    assert_eq!(*runs.deleted.lock().unwrap(), [run]);
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    assert_eq!(runs.started().len(), 2);
}

/// A prompt whose answer was lost may be running: the run stays starting, no
/// second session starts, and its session settles it.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_whose_prompt_may_have_arrived_is_never_started_twice(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
    let suggestion = h.background("quotes:compare").await;
    *runs.starts_as.lock().unwrap() = StartsAs::Uncertain;
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    *runs.starts_as.lock().unwrap() = StartsAs::Started;
    let run = runs.last();
    assert_eq!(h.run_state(run.session).await, RunStateName::Starting);
    assert!(matches!(
        h.accept(&user(OWNER), suggestion.id).await,
        Err(SuggestionError::NotFound)
    ));
    assert_eq!(runs.started().len(), 1);
    assert_eq!(
        h.news(
            run.session,
            SessionNews::TurnEnded {
                action: run.action,
                finished: true,
            },
        )
        .await,
        RunEventOutcome::Applied(Advanced::Moved(RunStateName::Finished))
    );
}

/// A run whose session is confirmed missing before it confirmed starting may
/// still be opening: it is given up only after its start window.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_starting_run_whose_session_is_missing_is_given_up_after_its_start_window(
    pool: PgPool,
) {
    let (h, runs) = run_harness(pool).await;
    let suggestion = h.background("quotes:compare").await;
    *runs.starts_as.lock().unwrap() = StartsAs::Uncertain;
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    *runs.starts_as.lock().unwrap() = StartsAs::Started;
    let run = runs.last().session;
    runs.state.lock().unwrap().remove(&run);
    assert_eq!(h.reconcile().await, STAYED);
    age_runs(&h.pool, chrono::Duration::minutes(10)).await;
    h.sweeps_to(run, RunStateName::Failed).await;
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    assert_eq!(runs.started().len(), 2);
}

/// A run whose session is deleted under it fails at once.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_whose_session_is_deleted_fails(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
    let suggestion = h.background("quotes:compare").await;
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run = runs.last().session;
    assert_eq!(
        h.news(run, SessionNews::Deleted).await,
        RunEventOutcome::Applied(Advanced::Moved(RunStateName::Failed))
    );
}

/// A session that never took its prompt is deleted after the start window,
/// and the suggestion may run again; while it can't be deleted, the run
/// stays.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_whose_prompt_never_arrived_is_deleted_and_runs_again(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
    let suggestion = h.background("quotes:compare").await;
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run = runs.last().session;
    runs.set(run, SessionState::AwaitingPrompt);
    assert_eq!(h.reconcile().await, STAYED);
    age_runs(&h.pool, chrono::Duration::minutes(10)).await;
    runs.delete_fails
        .store(true, std::sync::atomic::Ordering::SeqCst);
    assert_eq!(h.reconcile().await, STAYED);
    assert!(matches!(
        h.accept(&user(OWNER), suggestion.id).await,
        Err(SuggestionError::NotFound)
    ));
    runs.delete_fails
        .store(false, std::sync::atomic::Ordering::SeqCst);
    h.sweeps_to(run, RunStateName::Failed).await;
    assert_eq!(*runs.deleted.lock().unwrap(), [run]);
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    assert_eq!(runs.started().len(), 2);
}

/// A run whose session can't be read is given up only past its time, and
/// then only once its session is deleted: it may be running, and a retry
/// would start a second session.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_run_whose_session_cant_be_read_is_deleted_only_past_its_time(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
    let suggestion = h.background("quotes:compare").await;
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run = runs.last().session;
    runs.unreadable.lock().unwrap().insert(run);
    age_runs(&h.pool, chrono::Duration::minutes(59)).await;
    for _ in 0..3 {
        assert_eq!(h.reconcile().await, STAYED);
    }
    assert!(matches!(
        h.accept(&user(OWNER), suggestion.id).await,
        Err(SuggestionError::NotFound)
    ));
    age_runs(&h.pool, chrono::Duration::minutes(1)).await;
    h.sweeps_to(run, RunStateName::Failed).await;
    assert_eq!(*runs.deleted.lock().unwrap(), [run]);
}

/// Dismissing a suggestion stops its run at once and settles it cancelled;
/// the sweep finishes what the dismissal couldn't.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn dismissing_a_suggestion_cancels_its_run(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
    let suggestion = h.background("quotes:compare").await;
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run = runs.last().session;
    h.service
        .dismiss(&user(OWNER), SuggestionCaller::User, suggestion.id)
        .await
        .unwrap();
    assert_eq!(*runs.stopped.lock().unwrap(), [run]);
    assert_eq!(h.run_state(run).await, RunStateName::Cancelling);
    assert!(h.in_feed(suggestion.id).await.is_none());
    // Its turn ended when stopped.
    h.sweeps_to(run, RunStateName::Cancelled).await;
    let dismissed = h.stored(suggestion.id).await;
    assert_eq!(dismissed.state, SuggestionState::Dismissed);
    assert_eq!(dismissed.status, SuggestionStatus::Closed);
    assert!(dismissed.produced.is_empty());
}

/// A run that finishes as its suggestion is dismissed records what it made,
/// but leaves the suggestion dismissed.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_cancelled_run_that_finishes_keeps_its_suggestion_closed(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
    let suggestion = h.background("quotes:compare").await;
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run = runs.last();
    runs.set(run.session, SessionState::Finished);
    h.service
        .dismiss(&user(OWNER), SuggestionCaller::User, suggestion.id)
        .await
        .unwrap();
    assert_eq!(h.run_state(run.session).await, RunStateName::Finished);
    let dismissed = h.stored(suggestion.id).await;
    assert_eq!(dismissed.state, SuggestionState::Dismissed);
    assert_eq!(
        dismissed.produced,
        [session_target(run.session), comparison_doc()]
    );
}

/// A suggestion retired while its run waits stops the run; suggested again,
/// it can't start a second run until the first one settles.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn retiring_a_suggestion_cancels_its_run_and_a_restored_one_waits_for_it(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
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
    let run = runs.last().session;
    runs.set(run, SessionState::NeedsApproval);
    runs.stops_ignored
        .store(true, std::sync::atomic::Ordering::SeqCst);
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
    assert_eq!(*runs.stopped.lock().unwrap(), [run]);
    assert_eq!(h.run_state(run).await, RunStateName::Cancelling);
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
    assert_eq!(runs.started().len(), 1);
    // Once the first run settles cancelled, the restored suggestion may run.
    runs.set(run, SessionState::Failed);
    h.sweeps_to(run, RunStateName::Cancelled).await;
    assert_eq!(
        h.in_feed(suggestion.id).await.unwrap().status,
        SuggestionStatus::Open
    );
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    assert_eq!(runs.started().len(), 2);
}

/// While a run is going, its prompt and what it may send stay as the person
/// ran them; other words may change.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_running_suggestions_prompt_and_sends_stay_as_run(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
    let session = h.session(OWNER, "suggestions").await;
    let mut posting = prompt_suggestion("ops:weekly-status", "Post the weekly status summary");
    posting.sends = Some("Posts the weekly status summary in #ops".to_owned());
    let suggestion = h.suggest(session, posting.clone()).await.suggestion.unwrap();
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run = runs.last();
    for refused in [
        RewriteSuggestion {
            prompt: Some("Post the summary and email it to the leads.".to_owned()),
            ..RewriteSuggestion::default()
        },
        RewriteSuggestion {
            sends: Some("Posts the weekly status summary in #ops-leads".to_owned()),
            ..RewriteSuggestion::default()
        },
    ] {
        let outcome = h.rewrite_as(session, suggestion.id, refused).await;
        assert!(!outcome.ok);
        assert!(problems(&outcome).contains("a run of this suggestion is going"));
    }
    let mut again = posting.clone();
    again.prompt = Some("Post the summary in #ops-leads instead.".to_owned());
    let outcome = h.suggest(session, again).await;
    assert!(problems(&outcome).contains("a run of this suggestion is going"));
    let summary = h
        .rewrite_as(
            session,
            suggestion.id,
            RewriteSuggestion {
        summary: Some("The status doc changed this morning.".to_owned()),
        ..RewriteSuggestion::default()
            },
        )
        .await;
    assert!(summary.ok, "{:?}", summary.problems);
    // The run sends what it was approved to send, as snapshotted.
    let stored = PgSuggestionRepo::new(h.pool.clone())
        .run(run.session)
        .await
        .unwrap()
        .unwrap();
    assert_eq!(
        stored.sends.as_deref(),
        Some("Posts the weekly status summary in #ops")
    );
    // Once it settles, they may change again.
    h.news(
        run.session,
        SessionNews::TurnEnded {
            action: run.action,
            finished: false,
        },
    )
    .await;
    let outcome = h
        .rewrite_as(
            session,
            suggestion.id,
            RewriteSuggestion {
        sends: Some("Posts the weekly status summary in #ops-leads".to_owned()),
        ..RewriteSuggestion::default()
            },
        )
        .await;
    assert!(outcome.ok, "{:?}", outcome.problems);
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_background_suggestion_says_what_it_sends_and_running_it_approves_that(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
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
    let prompt = runs.last().prompt;
    assert!(
        prompt.contains("this run will: Posts the weekly status summary in #ops-leads."),
        "{prompt}"
    );
    assert!(prompt.contains("sendConfirmed"));
}

/// Whoever holds a run acts on it alone: an event arriving meanwhile is
/// told to come back, and applies once the run is let go.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_held_run_is_left_to_its_holder(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
    let suggestion = h.background("quotes:compare").await;
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run = runs.last();
    let repo = PgSuggestionRepo::new(h.pool.clone());
    let until = Utc::now() + chrono::Duration::minutes(2);
    assert!(
        repo.claim_run(run.session, Utc::now(), until)
            .await
            .unwrap()
            .is_some()
    );
    let finished = SessionNews::TurnEnded {
        action: run.action,
        finished: true,
    };
    assert_eq!(h.news(run.session, finished).await, RunEventOutcome::Busy);
    assert_eq!(h.reconcile().await, RunsReconciled::default());
    repo.release_run(run.session, until).await.unwrap();
    assert_eq!(
        h.news(run.session, finished).await,
        RunEventOutcome::Applied(Advanced::Moved(RunStateName::Finished))
    );
}

/// One run that can't be written never stops the sweep checking the others.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn one_failing_run_never_stops_the_sweep(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
    let mut sessions = Vec::new();
    for key in ["quotes:first", "quotes:second"] {
        let suggestion = h.background(key).await;
        h.accept(&user(OWNER), suggestion.id).await.unwrap();
        let run = runs.last().session;
        runs.set(run, SessionState::Finished);
        sessions.push(run);
    }
    // Writing the first run's state fails.
    sqlx::raw_sql(&format!(
        r"CREATE FUNCTION fail_run_write() RETURNS trigger LANGUAGE plpgsql AS $$
          BEGIN
            IF NEW.session_id = '{}' AND NEW.state <> OLD.state THEN
              RAISE EXCEPTION 'the write failed';
            END IF;
            RETURN NEW;
          END $$;
          CREATE TRIGGER fail_run_write BEFORE UPDATE ON suggestion_run
            FOR EACH ROW EXECUTE FUNCTION fail_run_write();",
        sessions[0],
    ))
    .execute(&h.pool)
    .await
    .unwrap();
    assert_eq!(
        h.reconcile().await,
        RunsReconciled {
            checked: 1,
            moved: 1,
            settled: 1,
            failed: 1,
        }
    );
    assert_eq!(h.run_state(sessions[0]).await, RunStateName::Running);
    assert_eq!(h.run_state(sessions[1]).await, RunStateName::Finished);
    // Let go of: the next pass checks it again.
    sqlx::raw_sql("DROP TRIGGER fail_run_write ON suggestion_run")
        .execute(&h.pool)
        .await
        .unwrap();
    h.sweeps_to(sessions[0], RunStateName::Finished).await;
}

/// Restoring a suggestion whose dismissal stopped its run brings the
/// suggestion back as proposed; the run stays cancelled, and a new one starts
/// once it has settled.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_restored_suggestion_keeps_its_cancelled_run(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
    let suggestion = h.background("quotes:compare").await;
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run = runs.last().session;
    let counts = || {
        let service = &h.service;
        async move {
            service
                .feed(&user(OWNER), SuggestionCaller::User, None, Some(1))
                .await
                .unwrap()
                .counts
        }
    };
    assert_eq!(
        counts().await,
        FeedCounts {
            running: 1,
            ..FeedCounts::default()
        }
    );
    h.service
        .dismiss(&user(OWNER), SuggestionCaller::User, suggestion.id)
        .await
        .unwrap();
    assert_eq!(h.run_state(run).await, RunStateName::Cancelling);
    h.service
        .restore(&user(OWNER), SuggestionCaller::User, suggestion.id)
        .await
        .unwrap();
    let restored = h.in_feed(suggestion.id).await.unwrap();
    assert_eq!(restored.state, SuggestionState::Proposed);
    assert_eq!(restored.status, SuggestionStatus::Open);
    assert_eq!(restored.result, None);
    assert_eq!(restored.run.unwrap().state, RunStateName::Cancelling);
    assert_eq!(
        counts().await,
        FeedCounts {
            open: 1,
            ..FeedCounts::default()
        }
    );
    // Its old run still stopping, it can't run again yet.
    assert!(matches!(
        h.accept(&user(OWNER), suggestion.id).await,
        Err(SuggestionError::NotFound)
    ));
    h.sweeps_to(run, RunStateName::Cancelled).await;
    let restored = h.stored(suggestion.id).await;
    assert_eq!(restored.state, SuggestionState::Proposed);
    assert!(restored.produced.is_empty());
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    assert_eq!(runs.started().len(), 2);
}

/// A settled run's card opens what it made, or its session when it failed.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_settled_run_gives_its_suggestion_a_result(pool: PgPool) {
    let (h, runs) = run_harness(pool).await;
    let finished = h.background("quotes:compare").await;
    h.accept(&user(OWNER), finished.id).await.unwrap();
    let run = runs.last();
    assert_eq!(h.in_feed(finished.id).await.unwrap().result, None);
    h.news(
        run.session,
        SessionNews::TurnEnded {
            action: run.action,
            finished: true,
        },
    )
    .await;
    assert_eq!(
        h.in_feed(finished.id).await.unwrap().result,
        Some(comparison_doc())
    );

    let failed = h.background("quotes:summarize").await;
    h.accept(&user(OWNER), failed.id).await.unwrap();
    let run = runs.last();
    h.news(
        run.session,
        SessionNews::TurnEnded {
            action: run.action,
            finished: false,
        },
    )
    .await;
    assert_eq!(
        h.in_feed(failed.id).await.unwrap().result,
        Some(session_target(run.session))
    );
}
