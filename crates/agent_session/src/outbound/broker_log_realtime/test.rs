use std::sync::{Arc, Mutex};

use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToServerMessage};
use macro_event_broker::{EventBrokerError, MacroEvent, MacroEventBroker};
use macro_uuid::Uuid;

use super::BrokerLogRealtime;
use crate::domain::model::{
    AgentSessionId, AgentSessionLog, LogAppended, Message, StoredAgentSessionLog,
};
use crate::domain::ports::{AgentSessionRealtime, NoOpRealtime};

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

/// Counts what the wrapped realtime was handed.
#[derive(Clone, Default)]
struct CountingRealtime {
    published: Arc<Mutex<usize>>,
}

impl AgentSessionRealtime for CountingRealtime {
    async fn publish(&self, _event: LogAppended) -> Result<(), rootcause::Report> {
        *self.published.lock().expect("not poisoned") += 1;
        Ok(())
    }
}

fn appended() -> LogAppended {
    LogAppended {
        turn_state: None,
        agent_session_id: AgentSessionId::TEST_A,
        entries: vec![StoredAgentSessionLog {
            id: Uuid::from_u128(1),
            created_at: chrono::Utc::now(),
            entry: AgentSessionLog {
                agent_session_id: AgentSessionId::TEST_A,
                user_id: None,
                content: Message::ToServer(ToServerMessage::Event {
                    event: SystemEvent::AcpReady,
                }),
            },
        }],
    }
}

#[tokio::test]
async fn publishes_the_run_to_both_the_inner_realtime_and_the_log_topic() {
    let broker = FakeBroker::default();
    let inner = CountingRealtime::default();
    let realtime = BrokerLogRealtime::new(inner.clone(), broker.clone());

    realtime.publish(appended()).await.expect("published");

    assert_eq!(*inner.published.lock().expect("not poisoned"), 1);
    let published = broker
        .published
        .lock()
        .expect("fake broker is not poisoned");
    assert_eq!(published.len(), 1);
    assert_eq!(published[0].topic, "macro.agent_session_log");
    assert_eq!(published[0].key, AgentSessionId::TEST_A.to_string());
    assert_eq!(
        published[0].envelope["event_type"],
        "agent_session_log.appended"
    );
    assert_eq!(published[0].envelope["schema_version"], 1);
    let entries = published[0].envelope["metadata"]["entries"]
        .as_array()
        .expect("entries");
    assert_eq!(entries.len(), 1);
    assert_eq!(entries[0]["id"], Uuid::from_u128(1).to_string());
    assert_eq!(entries[0]["content"]["direction"], "to_server");
}

#[tokio::test]
async fn a_refused_broker_publish_does_not_fail_the_append() {
    let broker = FakeBroker {
        refuses: true,
        ..FakeBroker::default()
    };
    let realtime = BrokerLogRealtime::new(NoOpRealtime, broker.clone());

    realtime
        .publish(appended())
        .await
        .expect("inner result wins");
}
