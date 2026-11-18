use std::collections::HashMap;

use agent_session::domain::model::AgentSessionId;
use agent_session::domain::routines::{
    PrepareRoutineSession, PreparedRoutineSession, PromptRoutineSession, RoutineActionStatus,
    RoutinePromptAccepted, RoutineSessionAction, RoutineSessions, ValidateRoutineSession,
    ValidatedRoutineSession,
};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::*;
use crate::domain::code_check::test::Checker;
use crate::domain::code_upgrade::NoCodeUpgrades;
use crate::domain::drafts::{Draft, DraftAgent, DraftContext, DraftRequest, RoutineDrafts};
use crate::domain::ports::{DraftHandBacks, RequestSessions, RoutineDraftService};
use crate::outbound::pg_draft_hand_backs::PgDraftHandBacks;

/// A replica's scheduler: its own service over its own adapters.
fn checking_service(
    hand_backs: Arc<dyn DraftHandBacks>,
    sessions: Arc<dyn RequestSessions>,
) -> impl ScheduledActionService {
    let repo = Arc::new(FakeRepo::default());
    let (tx, mut rx) = tokio::sync::mpsc::channel(32);
    tokio::spawn(async move { while rx.recv().await.is_some() {} });
    ScheduledActionServiceImpl::new(
        Arc::clone(&repo),
        Arc::new(FakeExecutor::default()),
        tx,
        grants(&repo),
    )
    .with_event_routines(Rollout(Some(true)))
    .with_code(Arc::new(Checker::default()), Arc::new(NoCodeUpgrades))
    .with_draft_hand_backs(hand_backs, sessions)
}

/// Code-mode invocations by session, as their credentials name them.
#[derive(Default)]
struct Invocations(Mutex<HashMap<Uuid, Uuid>>);

#[async_trait::async_trait]
impl RequestSessions for Invocations {
    async fn session_of(&self, correlation: Uuid) -> Result<Option<Uuid>> {
        Ok(self.0.lock().unwrap().get(&correlation).copied())
    }
}

fn steps(sources: &[&str]) -> serde_json::Value {
    json!(
        sources
            .iter()
            .map(|source| json!({ "type": "code", "title": "Make a task", "source": source }))
            .collect::<Vec<_>>()
    )
}

#[tokio::test]
async fn a_check_says_what_saving_would_refuse_and_saves_nothing() {
    let repo = Arc::new(FakeRepo::default());
    let (tx, mut rx) = tokio::sync::mpsc::channel(32);
    tokio::spawn(async move { while rx.recv().await.is_some() {} });
    let svc = ScheduledActionServiceImpl::new(
        Arc::clone(&repo),
        Arc::new(FakeExecutor::default()),
        tx,
        grants(&repo),
    )
    .with_code(Arc::new(Checker::default()), Arc::new(NoCodeUpgrades));
    let config = program_configuration(
        // Event triggers are off on this host.
        json!({"type": "events", "filters": [{"events": ["email.message_received"]}]}),
        json!([
            { "type": "agent", "model": "m", "instructions": "Research it" },
            { "type": "code", "title": "Label it", "source": "bad" },
        ]),
    );

    let check = svc
        .check_action(&user_principal(), config, Vec::new(), None)
        .await
        .unwrap();

    assert!(!check.ok);
    assert_eq!(
        check.problems,
        [ActionPolicyError::EventManagementDisabled.to_string()]
    );
    let [failing] = check.steps.as_slice() else {
        panic!("{:?}", check.steps);
    };
    // Its place among all the steps.
    assert_eq!(failing.index, 1);
    assert_eq!(failing.title, "Label it");
    assert!(repo.actions.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_clean_check_returns_the_routine_as_saving_would_store_it() {
    let svc = checking_service(
        Arc::new(PanickingHandBacks),
        Arc::new(Invocations::default()),
    );
    let config = program_configuration(
        json!({ "type": "cron", "schedule": "0 0 9 * * *", "timezone": "UTC" }),
        steps(&["good"]),
    );

    let check = svc
        .check_action(&user_principal(), config, Vec::new(), None)
        .await
        .unwrap();

    assert!(check.ok, "{check:?}");
    assert!(check.problems.is_empty() && check.steps.is_empty());
    assert_eq!(check.routine.task["steps"][0]["id"], "make_a_task");
    assert!(check.routine.task["sdk"].is_string());
}

/// A check outside any draft never reaches the store.
struct PanickingHandBacks;

#[async_trait::async_trait]
impl DraftHandBacks for PanickingHandBacks {
    async fn begin(&self, _: Uuid, _: &MacroUserIdStr<'static>, _: bot_id::BotId) -> Result<()> {
        unreachable!()
    }
    async fn record(
        &self,
        _: Uuid,
        _: &MacroUserIdStr<'static>,
        _: &crate::domain::models::RoutineCheck,
        _: &[crate::domain::models::CreatedItem],
    ) -> Result<bool> {
        unreachable!("a check without an invocation is no draft's")
    }
    async fn handed_back(&self, _: Uuid) -> Result<crate::domain::ports::HandedBack> {
        unreachable!()
    }
    async fn finish(&self, _: Uuid) -> Result<()> {
        unreachable!()
    }
    async fn stale(
        &self,
        _: DateTime<Utc>,
        _: u16,
    ) -> Result<Vec<crate::domain::ports::StaleDraft>> {
        unreachable!()
    }
}

#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn only_a_draft_sessions_own_check_is_kept_as_its_answer(pool: PgPool) {
    let hand_backs = Arc::new(PgDraftHandBacks::new(pool));
    let invocations = Arc::new(Invocations::default());
    let svc = checking_service(hand_backs.clone(), invocations.clone());
    let (session, correlation) = (generate_uuid_v7(), generate_uuid_v7());
    hand_backs
        .begin(session, &user(), bot_id::MACRO_NEW_BOT_ID)
        .await
        .unwrap();
    invocations.0.lock().unwrap().insert(correlation, session);
    let config = program_configuration(
        json!({ "type": "cron", "schedule": "0 0 9 * * *", "timezone": "UTC" }),
        steps(&["good"]),
    );

    // Someone else's program can't answer this draft...
    let stranger = CreationPrincipal::User(
        MacroUserIdStr::try_from("macro|stranger@macro.com".to_owned()).unwrap(),
    );
    svc.check_action(&stranger, config.clone(), Vec::new(), Some(correlation))
        .await
        .unwrap();
    // ...nor can a check that isn't from a session.
    svc.check_action(&user_principal(), config.clone(), Vec::new(), None)
        .await
        .unwrap();
    assert_eq!(hand_backs.handed_back(session).await.unwrap().checks, 0);

    svc.check_action(&user_principal(), config, Vec::new(), Some(correlation))
        .await
        .unwrap();
    let handed_back = hand_backs.handed_back(session).await.unwrap();
    assert_eq!(handed_back.checks, 1);
    assert!(handed_back.check.unwrap().ok);
}

/// A draft's session, whose turn checks its routine on another replica.
struct SessionOnAnotherReplica<Check> {
    replica: Check,
    invocations: Arc<Invocations>,
    deleted: Mutex<Vec<AgentSessionId>>,
}

impl<Check: ScheduledActionService> RoutineSessions for SessionOnAnotherReplica<Check> {
    async fn validate(
        &self,
        _: ValidateRoutineSession,
    ) -> Result<ValidatedRoutineSession, RoutineSessionError> {
        unreachable!()
    }

    async fn prepare(
        &self,
        command: PrepareRoutineSession,
    ) -> Result<PreparedRoutineSession, RoutineSessionError> {
        Ok(PreparedRoutineSession {
            session_id: command.session_id,
        })
    }

    async fn prompt(
        &self,
        command: PromptRoutineSession,
    ) -> Result<RoutinePromptAccepted, RoutineSessionError> {
        // The program's credential names an invocation of this session.
        let correlation = generate_uuid_v7();
        self.invocations
            .0
            .lock()
            .unwrap()
            .insert(correlation, command.action.session_id.as_uuid());
        let config = program_configuration(
            json!({ "type": "cron", "schedule": "0 0 9 * * *", "timezone": "UTC" }),
            steps(&["good"]),
        );
        self.replica
            .check_action(
                &CreationPrincipal::User(command.action.owner.clone()),
                ActionConfiguration {
                    name: "Bug tasks".into(),
                    ..config
                },
                vec![crate::domain::models::CreatedItem {
                    entity_type: model_entity::EntityType::Database,
                    entity_id: "bug-log".into(),
                }],
                Some(correlation),
            )
            .await
            .unwrap();
        Ok(RoutinePromptAccepted {
            action_id: command.action.action_id,
            queued: false,
        })
    }

    async fn status(
        &self,
        _: RoutineSessionAction,
    ) -> Result<RoutineActionStatus, RoutineSessionError> {
        Ok(RoutineActionStatus::Succeeded)
    }

    async fn cancel(&self, _: RoutineSessionAction) -> Result<(), RoutineSessionError> {
        Ok(())
    }

    async fn delete(&self, command: RoutineSessionAction) -> Result<(), RoutineSessionError> {
        self.deleted.lock().unwrap().push(command.session_id);
        Ok(())
    }
}

/// The drafter and the session's check run in different processes: each
/// replica has its own service and its own store over one database, and
/// nothing in memory passes between them.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_check_made_on_one_replica_answers_a_draft_waiting_on_another(pool: PgPool) {
    let invocations = Arc::new(Invocations::default());
    // Replica B serves the check route the session's program calls.
    let replica_b = checking_service(
        Arc::new(PgDraftHandBacks::new(pool.clone())),
        invocations.clone(),
    );
    // Replica A serves the draft request and waits.
    let sessions = Arc::new(SessionOnAnotherReplica {
        replica: replica_b,
        invocations,
        deleted: Mutex::new(Vec::new()),
    });
    let replica_a = RoutineDrafts::new(
        Arc::new(Checker::default()),
        Arc::clone(&sessions),
        Arc::new(PgDraftHandBacks::new(pool.clone())) as Arc<dyn DraftHandBacks>,
        DraftAgent {
            bot: bot_id::MACRO_NEW_BOT_ID,
            guide: "",
        },
    );

    let draft = replica_a
        .draft(
            user(),
            DraftRequest::Routine {
                description: "every morning make a task".into(),
            },
            DraftContext {
                timezone: "UTC".into(),
                agent_model: "anthropic/claude-sonnet-5-5".into(),
                code: true,
                conditions: false,
                ignored_workspace: serde::de::IgnoredAny,
            },
        )
        .await
        .unwrap();

    let Draft::Routine(routine) = draft else {
        panic!("{draft:?}");
    };
    assert_eq!(routine.name, "Bug tasks");
    assert_eq!(routine.steps[0]["id"], "make_a_task");
    assert_eq!(
        routine.created.len(),
        1,
        "what the session made crosses too"
    );
    assert_eq!(sessions.deleted.lock().unwrap().len(), 1);
    let left = sqlx::query_scalar!(r#"SELECT COUNT(*) AS "count!" FROM scheduled_action_draft"#)
        .fetch_one(&pool)
        .await
        .unwrap();
    assert_eq!(left, 0, "the draft's row is gone");
}
