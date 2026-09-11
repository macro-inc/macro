use std::sync::{Arc, Mutex};

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::domain::events::{
    AgentSessionLifecycleEvent, SessionIdentity, SessionRenamedMetadata, SessionSettledMetadata,
    TurnSummary,
};
use agent_session::domain::model::{AgentSessionId, TurnId};
use agent_session::domain::ports::AgentSessionLifecyclePublisher;
use agent_session::testing::RecordingLifecyclePublisher;
use bots::domain::models::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use notification::domain::models::{Notification, NotificationResult, SendNotificationRequest};
use notification::domain::service::{NotificationIngress, SendNotificationError};
use rootcause::Report;
use serde::Serialize;
use uuid::Uuid;

use super::NotifyingLifecyclePublisher;

/// Records every request as JSON, the way the SQS ingress would serialize it.
#[derive(Default)]
struct RecordingIngress {
    sent: Mutex<Vec<serde_json::Value>>,
    fail: bool,
}

impl NotificationIngress for RecordingIngress {
    async fn send_notification<
        'a,
        T: Notification + Clone + 'static,
        U: Serialize + Send + Sync + 'static,
    >(
        &'a self,
        req: SendNotificationRequest<'a, T, U>,
    ) -> Result<Option<NotificationResult<'a>>, Report<SendNotificationError>> {
        if self.fail {
            return Err(rootcause::report!("queue down").context(SendNotificationError::Other));
        }
        self.sent
            .lock()
            .unwrap()
            .push(serde_json::to_value(&req).expect("requests serialize"));
        Ok(None)
    }
}

fn owner() -> MacroUserIdStr<'static> {
    MacroUserIdStr::try_from_email("owner@macro.com").unwrap()
}

fn identity() -> SessionIdentity {
    SessionIdentity {
        session_id: AgentSessionId::new_from_uuid(Uuid::from_u128(0xA)),
        session_name: "Fix the flaky test".to_owned(),
        bot_id: BotId::new_from_uuid(Uuid::from_u128(0xB07)),
        bot_name: "Macro Coder".to_owned(),
        owner_id: owner(),
        origin: None,
        audience: vec![owner()],
    }
}

fn settled() -> AgentSessionLifecycleEvent {
    AgentSessionLifecycleEvent::Settled(SessionSettledMetadata {
        identity: identity(),
        last_turn: Some(TurnSummary {
            turn: TurnId(0),
            action_id: AgentActionId::mint(),
            actor: Some(owner()),
            announcement_message_id: None,
            stop_reason: "end_turn".to_owned(),
            excerpt: Some("Done.".to_owned()),
        }),
    })
}

#[tokio::test]
async fn the_fact_is_published_and_the_notification_enqueued() {
    let inner = RecordingLifecyclePublisher::new();
    let ingress = Arc::new(RecordingIngress::default());
    let publisher = NotifyingLifecyclePublisher::new(inner.clone(), Arc::clone(&ingress));

    let event = settled();
    publisher.publish(event.clone()).await;

    assert_eq!(inner.published(), vec![event]);
    let sent = ingress.sent.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_eq!(
        sent[0]["req"]["notification"]["tag"],
        "agent_session_settled"
    );
    assert_eq!(sent[0]["send_conn_gateway"], true);
}

#[tokio::test]
async fn facts_that_notify_nobody_still_publish() {
    let inner = RecordingLifecyclePublisher::new();
    let ingress = Arc::new(RecordingIngress::default());
    let publisher = NotifyingLifecyclePublisher::new(inner.clone(), Arc::clone(&ingress));

    let renamed = AgentSessionLifecycleEvent::Renamed(SessionRenamedMetadata {
        identity: identity(),
    });
    publisher.publish(renamed.clone()).await;

    assert_eq!(inner.published(), vec![renamed]);
    assert!(ingress.sent.lock().unwrap().is_empty());
}

#[tokio::test]
async fn an_ingress_failure_never_loses_the_fact() {
    let inner = RecordingLifecyclePublisher::new();
    let ingress = Arc::new(RecordingIngress {
        fail: true,
        ..RecordingIngress::default()
    });
    let publisher = NotifyingLifecyclePublisher::new(inner.clone(), ingress);

    publisher.publish(settled()).await;

    assert_eq!(inner.published().len(), 1);
}
