use std::sync::Mutex;

use agent_client_protocol::RawJsonRpcMessage;
use agent_egress::domain::approval::{ApprovalAnswer, ToolApprovalError, ToolApprovalId};
use agent_egress::domain::error::EgressError;
use agent_egress::domain::model::AgentSessionId;
use agent_runtime_protocol::domain::action::AgentActionId;
use agent_runtime_protocol::domain::schema::v0::{AcpMessage, ToServerMessage};
use agent_runtime_protocol::domain::tool_approval::{ToolApprovalNotice, ToolApprovalStatus};
use agent_session::domain::error::AgentSessionError;
use agent_session::domain::events::{
    SessionDeletedMetadata, SessionIdentity, SessionRenamedMetadata, SessionStoppedMetadata,
};
use agent_session::domain::service::MockAgentSessionService;
use agent_session::testing::RecordingLifecyclePublisher;
use bot_id::BotId;
use macro_uuid::Uuid;

use super::*;
use crate::domain::notifications::PlannedNotification;

#[derive(Default)]
struct RecordingReleases(Mutex<Vec<AgentSessionId>>);

impl ToolApprovalAnswers for RecordingReleases {
    async fn answer(
        &self,
        _session: AgentSessionId,
        _id: ToolApprovalId,
        _answer: ApprovalAnswer,
        _by: &MacroUserIdStr<'static>,
    ) -> Result<ToolApproval, ToolApprovalError> {
        unimplemented!("releases only")
    }

    async fn release_session(&self, session: AgentSessionId) -> Result<(), EgressError> {
        self.0.lock().unwrap().push(session);
        Ok(())
    }
}

fn identity(session: AgentSessionId) -> SessionIdentity {
    SessionIdentity {
        session_id: session,
        session_name: "Session".to_owned(),
        bot_id: BotId::new_from_uuid(Uuid::from_u128(1)),
        bot_name: "Macro".to_owned(),
        owner_id: MacroUserIdStr::try_from_email("owner@macro.com").unwrap(),
        origin: None,
        audience: Vec::new(),
    }
}

#[tokio::test]
async fn stopping_or_deleting_a_session_releases_its_held_calls_before_publishing() {
    let releases = Arc::new(RecordingReleases::default());
    let published = RecordingLifecyclePublisher::new();
    let publisher = ReleaseHeldCallsOnTurnEnd::new(published.clone(), Arc::clone(&releases));
    let stopped = AgentSessionId::new();
    let deleted = AgentSessionId::new();
    let renamed = AgentSessionId::new();

    publisher
        .publish(AgentSessionLifecycleEvent::Stopped(
            SessionStoppedMetadata {
                identity: identity(stopped),
                reason: "closed".to_owned(),
                turn_in_flight: None,
            },
        ))
        .await;
    publisher
        .publish(AgentSessionLifecycleEvent::Deleted(
            SessionDeletedMetadata {
                identity: identity(deleted),
            },
        ))
        .await;
    publisher
        .publish(AgentSessionLifecycleEvent::Renamed(
            SessionRenamedMetadata {
                identity: identity(renamed),
            },
        ))
        .await;

    assert_eq!(*releases.0.lock().unwrap(), [stopped, deleted]);
    assert_eq!(published.published().len(), 3, "every fact still goes out");
}

#[derive(Clone, Default)]
struct RecordingNotifier(Arc<Mutex<Vec<PlannedNotification>>>);

impl AgentSessionNotifier for RecordingNotifier {
    fn notify(
        &self,
        notification: PlannedNotification,
    ) -> Pin<Box<dyn Future<Output = ()> + Send + '_>> {
        self.0.lock().unwrap().push(notification);
        Box::pin(async {})
    }
}

#[derive(Clone, Default)]
struct RecordingHeldCalls(Arc<Mutex<Vec<(AgentSessionId, ToolApprovalChange)>>>);

impl HeldToolCallObserver for RecordingHeldCalls {
    fn changed(&self, session: AgentSessionId, change: ToolApprovalChange) {
        self.0.lock().unwrap().push((session, change));
    }
}

fn approval(session: AgentSessionId, status: ToolApprovalStatus) -> ToolApproval {
    ToolApproval {
        id: ToolApprovalId::mint(),
        session,
        turn_action_id: AgentActionId::mint(),
        request_id: serde_json::json!(1),
        owner: MacroUserIdStr::try_from_email("owner@macro.com").unwrap(),
        requested_by: Some(MacroUserIdStr::try_from_email("asker@macro.com").unwrap()),
        server_slug: "macro".to_owned(),
        server_name: "Macro".to_owned(),
        tool_name: "ListEmails".to_owned(),
        arguments: serde_json::json!({}),
        status,
        resolved_by: None,
        remembered: false,
    }
}

fn notice_of(message: &ToServerMessage) -> ToolApprovalNotice {
    let ToServerMessage::Acp(AcpMessage(RawJsonRpcMessage::Notification(frame))) = message else {
        panic!("a notice is a notification");
    };
    ToolApprovalNotice::from_notification(&frame.method, frame.params.as_ref()).unwrap()
}

#[tokio::test]
async fn every_state_of_a_held_call_is_recorded_and_told_to_the_harness() {
    let session = AgentSessionId::new();
    let recorded: Arc<Mutex<Vec<ToolApprovalNotice>>> = Arc::default();
    let mut sessions = MockAgentSessionService::new();
    let frames = Arc::clone(&recorded);
    sessions
        .expect_record_frame()
        .times(2)
        .returning(move |id, message| {
            assert_eq!(id, session);
            frames.lock().unwrap().push(notice_of(&message));
            Box::pin(async { Ok(()) })
        });
    // The owner's notification reads the session; a lookup that fails
    // costs the notification and nothing else.
    sessions
        .expect_get_session()
        .returning(move |_| Box::pin(async move { Err(AgentSessionError::Disconnected(session)) }));
    let notifier = RecordingNotifier::default();
    let held = RecordingHeldCalls::default();
    let announcer = SessionToolApprovalAnnouncer::new(sessions, notifier.clone(), held.clone());

    let pending = approval(session, ToolApprovalStatus::Pending);
    announcer.requested(&pending, &pending.owner).await;
    announcer
        .resolved(&ToolApproval {
            status: ToolApprovalStatus::Approved,
            ..pending.clone()
        })
        .await;

    let recorded = recorded.lock().unwrap();
    assert_eq!(
        recorded
            .iter()
            .map(|notice| notice.status)
            .collect::<Vec<_>>(),
        [ToolApprovalStatus::Pending, ToolApprovalStatus::Approved]
    );
    assert_eq!(recorded[0].approval_id, pending.id.to_string());
    assert!(notifier.0.lock().unwrap().is_empty());
    assert_eq!(
        *held.0.lock().unwrap(),
        [
            (
                session,
                ToolApprovalChange::Held(HeldToolCall {
                    approval_id: pending.id.to_string(),
                    server_slug: "macro".to_owned(),
                    server_name: "Macro".to_owned(),
                    tool_name: "ListEmails".to_owned(),
                })
            ),
            (
                session,
                ToolApprovalChange::Settled {
                    approval_id: pending.id.to_string(),
                }
            ),
        ]
    );
}
