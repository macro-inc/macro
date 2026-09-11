use std::sync::{Arc, Mutex};

use agent_runtime_protocol::domain::action::AgentActionId;
use agent_session::domain::events::{
    AgentSessionLifecycleEvent, SessionIdentity, SessionSettledMetadata, TurnSummary,
};
use agent_session::domain::model::{AgentSessionId, TurnId};
use bot_id::BotId;
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use notification::domain::models::{Notification, NotificationResult, SendNotificationRequest};
use notification::domain::service::{NotificationIngress, SendNotificationError};
use rootcause::Report;
use serde::Serialize;

use super::IngressAgentSessionNotifier;
use crate::domain::notifications::plan;
use crate::domain::ports::AgentSessionNotifier;

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

fn settled() -> AgentSessionLifecycleEvent {
    AgentSessionLifecycleEvent::Settled(SessionSettledMetadata {
        identity: SessionIdentity {
            session_id: AgentSessionId::new_from_uuid(Uuid::from_u128(0xA)),
            session_name: "Fix the flaky test".to_owned(),
            bot_id: BotId::new_from_uuid(Uuid::from_u128(0xB07)),
            bot_name: "Macro Coder".to_owned(),
            owner_id: owner(),
            origin: None,
            audience: vec![owner()],
        },
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
async fn a_planned_notification_becomes_an_ingress_request() {
    let ingress = Arc::new(RecordingIngress::default());
    let notifier = IngressAgentSessionNotifier::new(Arc::clone(&ingress));

    for notification in plan(&settled()) {
        notifier.notify(notification).await;
    }

    let sent = ingress.sent.lock().unwrap();
    assert_eq!(sent.len(), 1);
    assert_eq!(
        sent[0]["req"]["notification"]["tag"],
        "agent_session_settled"
    );
    assert_eq!(sent[0]["send_conn_gateway"], true);
    assert!(
        sent[0]["build_apns"].is_object(),
        "push is built: {:#}",
        sent[0]
    );
}

#[tokio::test]
async fn an_ingress_failure_is_swallowed() {
    let ingress = Arc::new(RecordingIngress {
        fail: true,
        ..RecordingIngress::default()
    });
    let notifier = IngressAgentSessionNotifier::new(ingress);

    for notification in plan(&settled()) {
        notifier.notify(notification).await;
    }
}
