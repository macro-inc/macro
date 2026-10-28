use std::sync::{Arc, Mutex};

use agent_runtime_protocol::domain::schema::v0::{SystemEvent, ToServerMessage};
use agent_session::domain::events::{LogAppendedEntry, LogAppendedMetadata};
use agent_session::domain::model::{AgentSessionId, Message};
use macro_uuid::Uuid;
use rootcause::Report;

use super::AgentSessionLogConsumerService;
use crate::domain::ports::{AgentSessionLogConsumer, DeliveryId, ReceivedRun};

/// Hands out queued runs, then blocks forever; records what was acknowledged.
#[derive(Clone, Default)]
struct QueuedConsumer {
    runs: Arc<Mutex<Vec<LogAppendedMetadata>>>,
    acked: Arc<Mutex<Vec<DeliveryId>>>,
    refuses_acks: bool,
}

impl QueuedConsumer {
    fn acked(&self) -> Vec<String> {
        self.acked
            .lock()
            .expect("not poisoned")
            .iter()
            .map(|delivery| delivery.as_str().to_owned())
            .collect()
    }
}

impl AgentSessionLogConsumer for QueuedConsumer {
    async fn recv(&self) -> Result<ReceivedRun, Report> {
        loop {
            let next = self.runs.lock().expect("not poisoned").pop();
            match next {
                Some(run) => {
                    let delivery = DeliveryId::new(run.entries[0].id.to_string());
                    return Ok(ReceivedRun {
                        run,
                        delivery,
                        redelivered: false,
                    });
                }
                None => tokio::time::sleep(std::time::Duration::from_millis(5)).await,
            }
        }
    }

    async fn ack(&self, delivery: &DeliveryId) -> Result<(), Report> {
        if self.refuses_acks {
            return Err(rootcause::report!("refused"));
        }
        self.acked
            .lock()
            .expect("not poisoned")
            .push(delivery.clone());
        Ok(())
    }
}

/// Polls `condition` until it holds or two seconds pass.
async fn eventually(condition: impl Fn() -> bool) {
    tokio::time::timeout(std::time::Duration::from_secs(2), async {
        while !condition() {
            tokio::time::sleep(std::time::Duration::from_millis(5)).await;
        }
    })
    .await
    .expect("condition held in time");
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

#[tokio::test]
async fn acknowledges_each_run_after_handing_it_to_subscribers() {
    let consumer = QueuedConsumer::default();
    let service = Arc::new(AgentSessionLogConsumerService::new(consumer.clone()));
    let mut a = service.subscribe(AgentSessionId::TEST_A);
    let running = tokio::spawn({
        let service = Arc::clone(&service);
        async move { service.run().await }
    });

    consumer
        .runs
        .lock()
        .expect("not poisoned")
        .push(run(AgentSessionId::TEST_A, [7]));

    tokio::time::timeout(std::time::Duration::from_secs(2), a.recv())
        .await
        .expect("delivered in time")
        .expect("open");
    eventually(|| consumer.acked() == [Uuid::from_u128(7).to_string()]).await;
    running.abort();
}

#[tokio::test]
async fn acknowledges_a_run_nobody_here_subscribed_to() {
    let consumer = QueuedConsumer::default();
    let service = Arc::new(AgentSessionLogConsumerService::new(consumer.clone()));
    let running = tokio::spawn({
        let service = Arc::clone(&service);
        async move { service.run().await }
    });

    consumer
        .runs
        .lock()
        .expect("not poisoned")
        .push(run(AgentSessionId::TEST_B, [9]));

    eventually(|| consumer.acked() == [Uuid::from_u128(9).to_string()]).await;
    running.abort();
}

#[tokio::test]
async fn a_refused_acknowledgement_does_not_stop_the_fan_out() {
    let consumer = QueuedConsumer {
        refuses_acks: true,
        ..QueuedConsumer::default()
    };
    let service = Arc::new(AgentSessionLogConsumerService::new(consumer.clone()));
    let mut a = service.subscribe(AgentSessionId::TEST_A);
    let running = tokio::spawn({
        let service = Arc::clone(&service);
        async move { service.run().await }
    });

    consumer.runs.lock().expect("not poisoned").extend([
        run(AgentSessionId::TEST_A, [2]),
        run(AgentSessionId::TEST_A, [1]),
    ]);

    for expected in [1, 2] {
        let rows = tokio::time::timeout(std::time::Duration::from_secs(2), a.recv())
            .await
            .expect("delivered in time")
            .expect("open");
        assert_eq!(rows[0].id, Uuid::from_u128(expected));
    }
    assert!(!running.is_finished(), "the fan-out keeps running");
    running.abort();
}
