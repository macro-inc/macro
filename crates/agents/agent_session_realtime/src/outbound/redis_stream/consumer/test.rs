//! Integration tests against a running Redis.
//!
//! Run with: `REDIS_URL=redis://localhost:6379 cargo test -p agent_session_realtime -- --ignored`

use std::time::Duration;

use agent_client_protocol::RawJsonRpcMessage;
use agent_runtime_protocol::domain::schema::v0::{AcpMessage, SystemEvent, ToServerMessage};
use agent_session::domain::model::{
    AgentSessionId, AgentSessionLog, LogAppended, Message, StoredAgentSessionLog,
};
use agent_session::domain::ports::{AgentSessionRealtime as _, NoOpRealtime};
use macro_uuid::Uuid;
use redis::AsyncCommands as _;
use redis::streams::StreamInfoGroupsReply;

use super::*;
use crate::outbound::redis_stream::publisher::RedisLogStreamRealtime;

const RECV_TIMEOUT: Duration = Duration::from_secs(10);

fn client() -> redis::Client {
    let url = macro_env_var::maybe_read_env("REDIS_URL")
        .unwrap_or_else(|| "redis://127.0.0.1:6379".to_owned());
    redis::Client::open(url).expect("valid Redis URL")
}

/// A stream key of the test's own, deleted when dropped.
struct TestStream {
    key: String,
}

impl TestStream {
    fn new(test: &str) -> Self {
        Self {
            key: format!("test:{test}:{}", macro_uuid::generate_uuid_v7()),
        }
    }

    async fn consumer(&self) -> RedisLogStreamConsumer {
        RedisLogStreamConsumer::connect_to(client(), self.key.clone())
            .await
            .expect("connected")
    }

    fn publisher(&self) -> RedisLogStreamRealtime<NoOpRealtime> {
        RedisLogStreamRealtime::to_stream(NoOpRealtime, client(), self.key.clone())
    }

    async fn connection(&self) -> redis::aio::MultiplexedConnection {
        client()
            .get_multiplexed_async_connection()
            .await
            .expect("connected")
    }

    async fn groups(&self) -> Vec<String> {
        let groups: StreamInfoGroupsReply = self
            .connection()
            .await
            .xinfo_groups(&self.key)
            .await
            .expect("XINFO GROUPS");
        groups.groups.into_iter().map(|group| group.name).collect()
    }

    async fn pending(&self, group: &str) -> usize {
        let groups: StreamInfoGroupsReply = self
            .connection()
            .await
            .xinfo_groups(&self.key)
            .await
            .expect("XINFO GROUPS");
        groups
            .groups
            .into_iter()
            .find(|candidate| candidate.name == group)
            .map(|group| group.pending)
            .expect("group exists")
    }
}

impl Drop for TestStream {
    fn drop(&mut self) {
        if let Ok(mut connection) = client().get_connection() {
            let _: Result<(), _> = redis::Commands::del(&mut connection, &self.key);
        }
    }
}

fn appended(session: AgentSessionId, ids: impl IntoIterator<Item = u128>) -> LogAppended {
    LogAppended {
        turn_state: None,
        agent_session_id: session,
        entries: ids
            .into_iter()
            .map(|id| StoredAgentSessionLog {
                id: Uuid::from_u128(id),
                created_at: chrono::Utc::now(),
                entry: AgentSessionLog {
                    agent_session_id: session,
                    user_id: None,
                    content: Message::ToServer(ToServerMessage::Event {
                        event: SystemEvent::AcpReady,
                    }),
                    logged_at: None,
                },
            })
            .collect(),
    }
}

async fn recv(consumer: &RedisLogStreamConsumer) -> ReceivedRun {
    tokio::time::timeout(RECV_TIMEOUT, consumer.recv())
        .await
        .expect("received in time")
        .expect("received")
}

fn ids(received: &ReceivedRun) -> Vec<Uuid> {
    received.run.entries.iter().map(|entry| entry.id).collect()
}

#[tokio::test]
#[ignore = "Redis doesn't exist in CI"]
async fn a_published_run_is_received_whole_and_acknowledged() {
    let stream = TestStream::new("roundtrip");
    let consumer = stream.consumer().await;

    stream
        .publisher()
        .publish(appended(AgentSessionId::TEST_A, [1, 2]))
        .await
        .expect("published");

    let received = recv(&consumer).await;
    assert_eq!(received.run.agent_session_id, AgentSessionId::TEST_A);
    assert_eq!(ids(&received), [Uuid::from_u128(1), Uuid::from_u128(2)]);
    assert!(!received.redelivered);
    assert_eq!(
        stream.pending(consumer.group()).await,
        1,
        "owed until acked"
    );

    consumer.ack(&received.delivery).await.expect("acked");
    assert_eq!(stream.pending(consumer.group()).await, 0);
}

#[tokio::test]
#[ignore = "Redis doesn't exist in CI"]
async fn a_run_larger_than_kafkas_limit_goes_through() {
    let stream = TestStream::new("large");
    let consumer = stream.consumer().await;
    let mut event = appended(AgentSessionId::TEST_A, [1]);
    // ~3 MiB of tool output, the shape that broke the Kafka topic.
    event.entries[0].entry.content = Message::ToServer(ToServerMessage::Acp(AcpMessage(
        RawJsonRpcMessage::notification(
            "session/update".to_owned(),
            serde_json::json!({
                "sessionId": "s",
                "update": {
                    "sessionUpdate": "tool_call_update",
                    "toolCallId": "t",
                    "rawOutput": { "text": "x".repeat(3 * 1024 * 1024) }
                }
            }),
        )
        .expect("valid notification"),
    )));

    stream.publisher().publish(event).await.expect("published");

    let received = recv(&consumer).await;
    assert_eq!(ids(&received), [Uuid::from_u128(1)]);
}

#[tokio::test]
#[ignore = "Redis doesn't exist in CI"]
async fn every_process_receives_every_run() {
    let stream = TestStream::new("fan_out");
    let first = stream.consumer().await;
    let second = stream.consumer().await;

    stream
        .publisher()
        .publish(appended(AgentSessionId::TEST_B, [5]))
        .await
        .expect("published");

    assert_eq!(ids(&recv(&first).await), [Uuid::from_u128(5)]);
    assert_eq!(ids(&recv(&second).await), [Uuid::from_u128(5)]);
}

#[tokio::test]
#[ignore = "Redis doesn't exist in CI"]
async fn an_unacknowledged_run_is_redelivered_after_a_failed_read() {
    let stream = TestStream::new("redelivery");
    let consumer = stream.consumer().await;
    let publisher = stream.publisher();

    publisher
        .publish(appended(AgentSessionId::TEST_A, [1]))
        .await
        .expect("published");
    let first = recv(&consumer).await;
    assert!(!first.redelivered);

    // What a failed read leaves behind: no connection, replay pending next.
    {
        let mut state = consumer.state.lock().await;
        state.connection = None;
        state.mode = ReadMode::Pending;
    }
    publisher
        .publish(appended(AgentSessionId::TEST_A, [2]))
        .await
        .expect("published");

    let again = recv(&consumer).await;
    assert!(again.redelivered, "the unacknowledged run comes back first");
    assert_eq!(ids(&again), [Uuid::from_u128(1)]);
    assert_eq!(again.delivery, first.delivery);
    consumer.ack(&again.delivery).await.expect("acked");

    let next = recv(&consumer).await;
    assert!(!next.redelivered);
    assert_eq!(ids(&next), [Uuid::from_u128(2)]);
}

#[tokio::test]
#[ignore = "Redis doesn't exist in CI"]
async fn a_pending_run_trimmed_before_its_ack_is_skipped_and_settled() {
    let stream = TestStream::new("trimmed");
    let consumer = stream.consumer().await;
    let publisher = stream.publisher();

    publisher
        .publish(appended(AgentSessionId::TEST_A, [1]))
        .await
        .expect("published");
    let first = recv(&consumer).await;
    let _: usize = stream
        .connection()
        .await
        .xdel(&stream.key, &[first.delivery.as_str()])
        .await
        .expect("XDEL");
    {
        let mut state = consumer.state.lock().await;
        state.mode = ReadMode::Pending;
    }
    publisher
        .publish(appended(AgentSessionId::TEST_A, [2]))
        .await
        .expect("published");

    let next = recv(&consumer).await;
    assert_eq!(ids(&next), [Uuid::from_u128(2)]);
    consumer.ack(&next.delivery).await.expect("acked");
    assert_eq!(
        stream.pending(consumer.group()).await,
        0,
        "the trimmed entry was acknowledged, not left pending forever"
    );
}

#[tokio::test]
#[ignore = "Redis doesn't exist in CI"]
async fn a_lost_group_is_recreated_and_reading_resumes() {
    let stream = TestStream::new("lost_group");
    let consumer = stream.consumer().await;
    let _: usize = stream
        .connection()
        .await
        .xgroup_destroy(&stream.key, consumer.group())
        .await
        .expect("XGROUP DESTROY");

    let receiving = tokio::time::timeout(RECV_TIMEOUT, consumer.recv());
    let publishing = async {
        // After the read that recreates the group.
        tokio::time::sleep(Duration::from_millis(500)).await;
        stream
            .publisher()
            .publish(appended(AgentSessionId::TEST_A, [3]))
            .await
            .expect("published");
    };
    let (received, ()) = tokio::join!(receiving, publishing);

    let received = received.expect("received in time").expect("received");
    assert_eq!(ids(&received), [Uuid::from_u128(3)]);
    assert!(stream.groups().await.contains(&consumer.group().to_owned()));
}

#[tokio::test]
#[ignore = "Redis doesn't exist in CI"]
async fn a_group_without_consumers_is_reaped_and_others_are_left_alone() {
    let stream = TestStream::new("reap");
    let live = stream.consumer().await;
    let abandoned = format!("{GROUP_PREFIX}abandoned");
    let foreign = "someone-elses-group";
    let mut connection = stream.connection().await;
    let () = connection
        .xgroup_create_mkstream(&stream.key, &abandoned, "$")
        .await
        .expect("XGROUP CREATE");
    let () = connection
        .xgroup_create_mkstream(&stream.key, foreign, "$")
        .await
        .expect("XGROUP CREATE");

    live.reap_abandoned_groups().await.expect("reaped");

    let groups = stream.groups().await;
    assert!(!groups.contains(&abandoned), "{groups:?}");
    assert!(groups.contains(&foreign.to_owned()), "{groups:?}");
    assert!(groups.contains(&live.group().to_owned()), "{groups:?}");
}

#[tokio::test]
#[ignore = "Redis doesn't exist in CI"]
async fn closing_destroys_the_process_group() {
    let stream = TestStream::new("close");
    let consumer = stream.consumer().await;
    assert!(stream.groups().await.contains(&consumer.group().to_owned()));

    consumer.close().await.expect("closed");

    assert!(!stream.groups().await.contains(&consumer.group().to_owned()));
}

#[tokio::test]
#[ignore = "Redis doesn't exist in CI"]
async fn a_young_group_that_has_not_read_yet_is_not_reaped() {
    let stream = TestStream::new("young");
    // Connected, so created, but never read: no consumers yet.
    let starting = stream.consumer().await;
    let other = stream.consumer().await;

    other.reap_abandoned_groups().await.expect("reaped");

    assert!(stream.groups().await.contains(&starting.group().to_owned()));
}

#[test]
fn a_group_minted_now_is_young_and_a_foreign_name_has_no_age() {
    let group = format!("{GROUP_PREFIX}{}", macro_uuid::generate_uuid_v7());
    let age = group_age(&group).expect("a minted group has an age");
    assert!(age < Duration::from_secs(5), "{age:?}");
    assert_eq!(group_age("someone-elses-group"), None);
    assert_eq!(group_age(&format!("{GROUP_PREFIX}abandoned")), None);
}
