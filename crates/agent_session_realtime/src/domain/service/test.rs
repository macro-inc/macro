use std::sync::{Arc, Mutex};

use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToServerMessage};
use agent_session::domain::events::{LogAppendedEntry, LogAppendedMetadata};
use agent_session::domain::model::{AgentSessionId, Message};
use macro_uuid::Uuid;
use rootcause::Report;

use super::AgentSessionLogConsumerService;
use crate::domain::ports::AgentSessionLogConsumer;

/// Hands out queued runs, then blocks forever.
#[derive(Clone, Default)]
struct QueuedConsumer {
    runs: Arc<Mutex<Vec<LogAppendedMetadata>>>,
}

impl AgentSessionLogConsumer for QueuedConsumer {
    async fn recv(&self) -> Result<LogAppendedMetadata, Report> {
        loop {
            let next = self.runs.lock().expect("not poisoned").pop();
            match next {
                Some(run) => return Ok(run),
                None => tokio::time::sleep(std::time::Duration::from_millis(5)).await,
            }
        }
    }
}

fn run(session: AgentSessionId, ids: impl IntoIterator<Item = u128>) -> LogAppendedMetadata {
    LogAppendedMetadata {
        agent_session_id: session,
        entries: ids
            .into_iter()
            .map(|id| LogAppendedEntry {
                id: Uuid::from_u128(id),
                created_at: chrono::Utc::now(),
                user_id: None,
                content: Message::ToServer(ToServerMessage::Event {
                    event: SystemEvent::AcpReady,
                }),
            })
            .collect(),
    }
}

#[tokio::test]
async fn delivers_each_run_to_its_sessions_subscribers_as_stored_rows() {
    let consumer = QueuedConsumer::default();
    let service = Arc::new(AgentSessionLogConsumerService::new(consumer.clone()));
    let mut a = service.subscribe(AgentSessionId::TEST_A);
    let mut b = service.subscribe(AgentSessionId::TEST_B);
    let running = tokio::spawn({
        let service = Arc::clone(&service);
        async move { service.run().await }
    });

    consumer.runs.lock().expect("not poisoned").extend([
        run(AgentSessionId::TEST_B, [3]),
        run(AgentSessionId::TEST_A, [1, 2]),
    ]);

    let rows = tokio::time::timeout(std::time::Duration::from_secs(2), a.recv())
        .await
        .expect("delivered in time")
        .expect("open");
    assert_eq!(
        rows.iter().map(|row| row.id).collect::<Vec<_>>(),
        [Uuid::from_u128(1), Uuid::from_u128(2)]
    );
    assert!(
        rows.iter()
            .all(|row| row.entry.agent_session_id == AgentSessionId::TEST_A)
    );
    let rows = tokio::time::timeout(std::time::Duration::from_secs(2), b.recv())
        .await
        .expect("delivered in time")
        .expect("open");
    assert_eq!(rows.len(), 1);
    assert_eq!(rows[0].id, Uuid::from_u128(3));
    assert!(
        a.try_recv().is_err(),
        "a session's run does not reach another session"
    );
    running.abort();
}
