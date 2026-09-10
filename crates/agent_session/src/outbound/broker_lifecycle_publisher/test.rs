use std::sync::{Arc, Mutex};

use crate::domain::events::{AgentSessionLifecycleEvent, SessionDeletedMetadata, SessionIdentity};
use bots::domain::models::BotId;
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_user_id::cowlike::CowLike as _;
use macro_user_id::user_id::MacroUserIdStr;

use super::BrokerLifecyclePublisher;
use crate::domain::model::AgentSessionId;
use crate::domain::ports::AgentSessionLifecyclePublisher as _;

#[derive(Debug, Clone)]
struct Published {
    topic: String,
    key: String,
    envelope: serde_json::Value,
}

/// Records what was handed to the broker, or refuses everything.
#[derive(Clone, Default)]
struct FakeBroker {
    published: Arc<Mutex<Vec<Published>>>,
    refuses: bool,
}

impl MacroEventBroker for FakeBroker {
    fn send_event<E: MacroEvent + ?Sized>(
        &self,
        event: &E,
    ) -> Result<tokio::task::JoinHandle<Result<(), EventBrokerError>>, EventBrokerError> {
        self.published
            .lock()
            .expect("fake broker is not poisoned")
            .push(Published {
                topic: event.topic().to_string(),
                key: event.key().to_string(),
                envelope: serde_json::to_value(event.event())?,
            });
        let refuses = self.refuses;
        Ok(tokio::spawn(async move {
            if refuses {
                Err(EventBrokerError::UnknownTopic("refused".to_owned()))
            } else {
                Ok(())
            }
        }))
    }
}

fn deleted() -> AgentSessionLifecycleEvent {
    AgentSessionLifecycleEvent::Deleted(SessionDeletedMetadata {
        identity: SessionIdentity {
            session_id: AgentSessionId::TEST_A,
            session_name: "Agent Session".to_owned(),
            bot_id: BotId::TEST_A,
            bot_name: "Test Agent".to_owned(),
            owner_id: MacroUserIdStr::parse_from_str("macro|owner@example.com")
                .expect("valid user id")
                .into_owned(),
            origin: None,
        },
    })
}

#[tokio::test]
async fn publishes_on_the_lifecycle_topic_keyed_by_session_id() {
    let broker = FakeBroker::default();
    let publisher = BrokerLifecyclePublisher::new(broker.clone());

    publisher.publish(deleted()).await;

    let published = broker
        .published
        .lock()
        .expect("fake broker is not poisoned");
    assert_eq!(published.len(), 1);
    assert_eq!(published[0].topic, "macro.agent_session_lifecycle");
    assert_eq!(published[0].key, AgentSessionId::TEST_A.to_string());
    assert_eq!(published[0].envelope["event_type"], "agent_session.deleted");
    assert_eq!(published[0].envelope["schema_version"], 1);
}

#[tokio::test]
async fn a_refused_publish_is_swallowed() {
    let broker = FakeBroker {
        refuses: true,
        ..FakeBroker::default()
    };
    let publisher = BrokerLifecyclePublisher::new(broker.clone());

    // Best effort by contract: the caller never learns, and never fails.
    publisher.publish(deleted()).await;

    assert_eq!(
        broker
            .published
            .lock()
            .expect("fake broker is not poisoned")
            .len(),
        1
    );
}
