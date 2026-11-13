use std::collections::VecDeque;
use std::sync::{Arc, Mutex};

use macro_uuid::Uuid;
use rdkafka::message::{OwnedMessage, Timestamp};
use serde_json::{Value, json};
use macro_db_migrator::MACRO_DB_MIGRATIONS;
use sqlx::PgPool;

use super::*;
use crate::domain::model::{SuggestionError, SuggestionState};
use crate::domain::run::{Advanced, RunStateName};
use crate::domain::service::test::runs::run_harness;
use crate::domain::ports::SuggestionRepo as _;
use crate::domain::service::test::{Harness, OWNER, user};
use crate::outbound::pg_suggestion_repo::PgSuggestionRepo;

const TOPIC: &str = "macro.agent_session_lifecycle";
const SESSION: &str = "01900000-0000-7000-8000-0000000000a1";
const ACTION: &str = "01900000-0000-7000-8000-0000000000b1";

fn record(offset: i64, payload: &Value) -> OwnedMessage {
    OwnedMessage::new(
        Some(serde_json::to_vec(payload).unwrap()),
        Some(SESSION.as_bytes().to_vec()),
        TOPIC.to_owned(),
        Timestamp::NotAvailable,
        0,
        offset,
        None,
    )
}

/// A lifecycle event about `session`, as the session service publishes it.
fn lifecycle(session: &str, event_type: &str, mut metadata: Value) -> Value {
    metadata["identity"] = json!({
        "session_id": session,
        "session_name": "Compare the supplier quotes",
        "bot_id": bot_id::MACRO_NEW_BOT_ID,
        "bot_name": "Macro",
        "owner_id": OWNER,
        "origin": null,
        "source": "user",
    });
    json!({
        "event_id": "01900000-0000-7000-8000-000000000003",
        "schema_version": 1,
        "event_type": event_type,
        "metadata": metadata,
    })
}

/// `session` settled after the turn for `action`, which stopped for `reason`.
fn settled(session: &str, action: &str, reason: &str) -> Value {
    lifecycle(
        session,
        "agent_session.settled",
        json!({
            "last_turn": {
                "turn": 0,
                "action_id": action,
                "actor": OWNER,
                "announcement_message_id": null,
                "stop_reason": reason,
                "excerpt": "The cheapest quote is the third.",
            },
        }),
    )
}

fn decoded(payload: &Value) -> Option<SessionEvent> {
    let message = MessageWrapper::<_, SessionLifecycle>::new(record(0, payload));
    let SessionLifecycle::AgentSessionLifecycleMacroEvent(event) =
        message.decode_payload().unwrap();
    session_event(&event.event().event)
}

fn news(news: SessionNews) -> Option<SessionEvent> {
    Some(SessionEvent {
        session: SESSION.parse().unwrap(),
        news,
    })
}

/// A settled turn, a question, a refused command, a stopped runtime and a
/// deleted session each say what a run needs; the rest say nothing.
#[test]
fn lifecycle_events_say_what_a_run_needs_to_hear() {
    let action: Uuid = ACTION.parse().unwrap();
    assert_eq!(
        decoded(&settled(SESSION, ACTION, "end_turn")),
        news(SessionNews::TurnEnded {
            action,
            finished: true,
        })
    );
    assert_eq!(
        decoded(&settled(SESSION, ACTION, "max_tokens")),
        news(SessionNews::TurnEnded {
            action,
            finished: false,
        })
    );
    assert_eq!(
        decoded(&lifecycle(
            SESSION,
            "agent_session.settled",
            json!({ "last_turn": null })
        )),
        news(SessionNews::Changed)
    );
    assert_eq!(
        decoded(&lifecycle(
            SESSION,
            "agent_session.waiting_for_input",
            json!({
                "turn": 0,
                "action_id": ACTION,
                "announcement_message_id": null,
                "question": "Which supplier?",
            }),
        )),
        news(SessionNews::WaitingForInput { action })
    );
    assert_eq!(
        decoded(&lifecycle(
            SESSION,
            "agent_session.command_rejected",
            json!({
                "action_id": ACTION,
                "actor": OWNER,
                "announcement_message_id": null,
                "failure": { "code": "quota", "message": "Out of credits", "retryable": false },
            }),
        )),
        news(SessionNews::TurnEnded {
            action,
            finished: false,
        })
    );
    assert_eq!(
        decoded(&lifecycle(
            SESSION,
            "agent_session.stopped",
            json!({ "reason": "idle", "turn_in_flight": null }),
        )),
        news(SessionNews::Changed)
    );
    assert_eq!(
        decoded(&lifecycle(SESSION, "agent_session.deleted", json!({}))),
        news(SessionNews::Deleted)
    );
    assert_eq!(
        decoded(&lifecycle(
            SESSION,
            "agent_session.turn_ended",
            json!({
                "turn": 0,
                "action_id": ACTION,
                "actor": OWNER,
                "announcement_message_id": null,
                "stop_reason": "end_turn",
                "queued_remaining": 0,
            }),
        )),
        None
    );
    assert_eq!(
        decoded(&lifecycle(SESSION, "agent_session.renamed", json!({}))),
        None
    );
}

#[derive(Default)]
struct State {
    messages: VecDeque<OwnedMessage>,
    committed: Vec<i64>,
    applied: Vec<SessionEvent>,
    /// What each call answers, in turn; an error once they run out.
    outcomes: VecDeque<RunEventOutcome>,
}

#[derive(Clone, Default)]
struct Fake {
    state: Arc<Mutex<State>>,
    done: tokio_util::sync::CancellationToken,
}

impl Fake {
    fn push(&self, message: OwnedMessage) {
        self.state.lock().unwrap().messages.push_back(message);
    }
}

impl EventConsumer<SessionLifecycle> for Fake {
    type MessageType<'a> = OwnedMessage;

    async fn recv<'a>(
        &'a self,
    ) -> Result<MessageWrapper<Self::MessageType<'a>, SessionLifecycle>, Report> {
        let message = self.state.lock().unwrap().messages.pop_front();
        match message {
            Some(message) => Ok(MessageWrapper::new(message)),
            None => std::future::pending().await,
        }
    }
}

impl CommittingConsumer for Fake {
    fn commit(&self, message: &OwnedMessage) -> Result<(), Report> {
        let mut state = self.state.lock().unwrap();
        state.committed.push(message.offset());
        if state.messages.is_empty() {
            self.done.cancel();
        }
        Ok(())
    }
}

impl SuggestionRuns for Fake {
    async fn on_session_event(
        &self,
        event: SessionEvent,
    ) -> Result<RunEventOutcome, SuggestionError> {
        let mut state = self.state.lock().unwrap();
        state.applied.push(event);
        state
            .outcomes
            .pop_front()
            .ok_or_else(|| SuggestionError::Internal(rootcause::report!("the database is down")))
    }

    async fn reconcile_runs(&self) -> Result<crate::domain::ports::RunsReconciled, SuggestionError> {
        unreachable!("the consumer never sweeps")
    }
}

/// An undecodable record, one whose run stays held, and one that keeps failing
/// are all committed, and the record after each is still applied; an event no
/// run needs is committed without a call.
#[tokio::test(start_paused = true)]
async fn bad_records_never_stall_the_partition() {
    let fake = Fake::default();
    fake.push(record(
        1,
        &json!({ "event_type": "agent_session.settled", "metadata": "nonsense" }),
    ));
    // Held twice, then applied.
    fake.push(record(2, &settled(SESSION, ACTION, "end_turn")));
    // Failing every time.
    fake.push(record(3, &settled(SESSION, ACTION, "end_turn")));
    fake.push(record(
        4,
        &lifecycle(SESSION, "agent_session.renamed", json!({})),
    ));
    fake.state.lock().unwrap().outcomes = VecDeque::from([
        RunEventOutcome::Busy,
        RunEventOutcome::Busy,
        RunEventOutcome::Applied(Advanced::Moved(RunStateName::Finished)),
    ]);

    consume(
        fake.clone(),
        fake.clone(),
        fake.done.clone().cancelled_owned(),
        Duration::from_secs(1),
    )
    .await
    .unwrap();

    let state = fake.state.lock().unwrap();
    assert_eq!(state.committed, vec![1, 2, 3, 4]);
    assert_eq!(state.applied.len(), 3 + usize::from(MAX_ATTEMPTS));
}

/// A run's session settling after its prompt's turn, as published, finishes
/// the run and makes its suggestion done.
#[sqlx::test(migrator = "MACRO_DB_MIGRATIONS")]
async fn a_lifecycle_event_settles_a_run(pool: PgPool) {
    let (h, runs) = run_harness(pool.clone()).await;
    let suggestion = h.background("quotes:compare").await;
    h.accept(&user(OWNER), suggestion.id).await.unwrap();
    let run = runs.last();
    assert_eq!(h.run_state(run.session).await, RunStateName::Running);

    let fake = Fake::default();
    // Another session's turn, then the run's.
    fake.push(record(
        1,
        &settled(&Uuid::now_v7().to_string(), ACTION, "end_turn"),
    ));
    fake.push(record(
        2,
        &settled(
            &run.session.to_string(),
            &run.action.to_string(),
            "end_turn",
        ),
    ));
    let Harness { service, .. } = h;
    consume(
        fake.clone(),
        Arc::new(service),
        fake.done.clone().cancelled_owned(),
        Duration::from_secs(1),
    )
    .await
    .unwrap();

    assert_eq!(fake.state.lock().unwrap().committed, vec![1, 2]);
    let repo = PgSuggestionRepo::new(pool);
    let stored = repo.run(run.session).await.unwrap().unwrap();
    assert_eq!(stored.state.name(), RunStateName::Finished);
    let done = repo.suggestion(&user(OWNER), suggestion.id).await.unwrap().unwrap();
    assert_eq!(done.state, SuggestionState::Done);
}
