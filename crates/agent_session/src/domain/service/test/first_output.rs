use super::*;
use crate::domain::ports::AgentSessionLogWriter as _;
use serde_json::json;

async fn flush_start(logs: &mut LiveSessionLogWriter<InMemoryAgentSessionRepo, RecordingRealtime>) {
    let deadline = logs.flush_deadline().expect("output schedules a flush");
    assert!(deadline - tokio::time::Instant::now() <= std::time::Duration::from_millis(100));
    tokio::time::sleep_until(deadline).await;
    logs.flush().await.unwrap();
}

fn prompt(id: &str) -> AgentSessionLog {
    parse_log_as(
        test_session(),
        &json!({"direction": "to_runtime", "content": {
            "type": "acp", "jsonrpc": "2.0", "id": id, "method": "session/prompt",
            "params": {"sessionId": "acp-1", "prompt": [{"type": "text", "text": "go"}]}
        }})
        .to_string(),
    )
    .remove(0)
}

fn chunk(kind: &str, text: &str) -> AgentSessionLog {
    parse_log_as(
        test_session(),
        &json!({"direction": "to_server", "content": {
            "type": "acp", "jsonrpc": "2.0", "method": "session/update",
            "params": {"sessionId": "acp-1", "update": {
                "sessionUpdate": kind, "content": {"type": "text", "text": text}
            }}
        }})
        .to_string(),
    )
    .remove(0)
}

#[tokio::test]
async fn runtime_replies_publish_pending_frames_and_configuration_immediately() {
    let realtime = RecordingRealtime::new();
    let (repo, mut logs) = fenced_connection(realtime.clone()).await;
    let buffered = logs
        .append(chunk("agent_thought_chunk", "pending"))
        .await
        .unwrap();
    let response = parse_log_as(
        test_session(),
        &json!({
            "direction": "to_server", "content": {
                "type": "acp", "jsonrpc": "2.0", "id": "config", "result": {"configOptions": []}
            }
        })
        .to_string(),
    )
    .remove(0);
    let replied = logs.append(response).await.unwrap();
    let stored = AgentSessionLogRepo::list_by_session(&repo, test_session())
        .await
        .unwrap();
    assert_eq!(
        stored.iter().map(|e| e.id).collect::<Vec<_>>(),
        vec![buffered.log_id, replied.log_id]
    );
    let published = realtime.published();
    assert_eq!(published.len(), 1);
    assert_eq!(
        published[0]
            .entries
            .iter()
            .map(|e| e.id)
            .collect::<Vec<_>>(),
        vec![buffered.log_id, replied.log_id]
    );
    assert!(logs.flush_deadline().is_none());
}

#[tokio::test(start_paused = true)]
async fn first_thought_and_first_text_publish_before_the_regular_batch_deadline() {
    let realtime = RecordingRealtime::new();
    let (repo, mut logs) = fenced_connection(realtime.clone()).await;
    logs.append(prompt("first")).await.unwrap();
    let first = logs
        .append(chunk("agent_thought_chunk", "Thinking"))
        .await
        .unwrap();
    flush_start(&mut logs).await;
    assert_eq!(realtime.published().len(), 2);
    assert_eq!(realtime.published()[1].entries[0].id, first.log_id);
    assert!(logs.flush_deadline().is_none());

    let next = logs
        .append(chunk("agent_thought_chunk", " more"))
        .await
        .unwrap();
    assert_eq!(
        realtime.published().len(),
        2,
        "later thoughts remain batched"
    );
    let text = logs
        .append(chunk("agent_message_chunk", "The answer has enough words to fill the initial text batch before later chunks arrive."))
        .await
        .unwrap();
    flush_start(&mut logs).await;
    let published = realtime.published();
    assert_eq!(published.len(), 3);
    assert_eq!(
        published[2]
            .entries
            .iter()
            .map(|e| e.id)
            .collect::<Vec<_>>(),
        vec![next.log_id, text.log_id]
    );
    let stored = AgentSessionLogRepo::list_by_session(&repo, test_session())
        .await
        .unwrap();
    assert_eq!(
        stored.last().unwrap().id,
        text.log_id,
        "publish follows the durable write"
    );

    logs.append(chunk("agent_message_chunk", " continues"))
        .await
        .unwrap();
    assert_eq!(realtime.published().len(), 3, "later prose remains batched");
    assert!(logs.flush_deadline().is_some());

    logs.append(prompt("second")).await.unwrap();
    let second = logs
        .append(chunk("agent_message_chunk", "Next answer"))
        .await
        .unwrap();
    flush_start(&mut logs).await;
    assert_eq!(
        realtime.published().len(),
        5,
        "a new prompt resets both milestones"
    );
    assert_eq!(realtime.published()[4].entries[0].id, second.log_id);
    assert!(logs.flush_deadline().is_none());
}

#[tokio::test(start_paused = true)]
async fn empty_chunks_do_not_consume_the_first_output_flush() {
    let realtime = RecordingRealtime::new();
    let (_, mut logs) = fenced_connection(realtime.clone()).await;
    logs.append(prompt("first")).await.unwrap();
    logs.append(chunk("agent_thought_chunk", " "))
        .await
        .unwrap();
    logs.append(chunk("agent_message_chunk", "\n"))
        .await
        .unwrap();
    assert_eq!(realtime.published().len(), 1);
    let text = logs
        .append(chunk("agent_message_chunk", "Visible"))
        .await
        .unwrap();
    flush_start(&mut logs).await;
    let published = realtime.published();
    assert_eq!(published.len(), 2);
    assert_eq!(published[1].entries.last().unwrap().id, text.log_id);
    assert!(logs.flush_deadline().is_none());
}

#[tokio::test(start_paused = true)]
async fn changing_model_during_a_turn_does_not_delay_its_first_prose() {
    let realtime = RecordingRealtime::new();
    let (_, mut logs) = fenced_connection(realtime.clone()).await;
    logs.append(prompt("first")).await.unwrap();
    logs.append(chunk("agent_thought_chunk", "Thinking"))
        .await
        .unwrap();
    flush_start(&mut logs).await;
    let control = parse_log_as(test_session(), &json!({
        "direction": "to_runtime", "content": {
            "type": "acp", "jsonrpc": "2.0", "id": "config", "method": "session/set_config_option",
            "params": {"sessionId": "acp-1", "configId": "model", "value": "new-model"}
        }
    }).to_string()).remove(0);
    logs.append(control).await.unwrap();
    assert_eq!(realtime.published().len(), 3);
    let text = logs
        .append(chunk("agent_message_chunk", "The answer"))
        .await
        .unwrap();
    flush_start(&mut logs).await;
    let published = realtime.published();
    assert_eq!(published.len(), 4);
    assert_eq!(published[3].entries[0].id, text.log_id);
    assert!(logs.flush_deadline().is_none());
}

#[tokio::test]
async fn first_output_cannot_bypass_a_superseded_fence() {
    let realtime = RecordingRealtime::new();
    let (repo, mut logs) = fenced_connection(realtime.clone()).await;
    logs.append(prompt("first")).await.unwrap();
    repo.release(logs.claim.as_ref().unwrap()).await.unwrap();
    let _successor = claim_for_test(&repo, test_session()).await;
    logs.append(chunk("agent_message_chunk", "Stale"))
        .await
        .unwrap();
    assert!(matches!(
        logs.flush().await,
        Err(AgentSessionError::FencedOut(_))
    ));
    assert_eq!(
        realtime.published().len(),
        1,
        "uncommitted output is never published"
    );
}

#[tokio::test(start_paused = true)]
async fn markdown_prefix_and_words_share_the_early_batch_without_extending_its_deadline() {
    let realtime = RecordingRealtime::new();
    let (_, mut logs) = fenced_connection(realtime.clone()).await;
    logs.append(prompt("first")).await.unwrap();
    let prefix = logs
        .append(chunk("agent_message_chunk", "**"))
        .await
        .unwrap();
    let deadline = logs.flush_deadline();
    tokio::time::advance(std::time::Duration::from_millis(10)).await;
    let words = logs
        .append(chunk("agent_message_chunk", "Sunlight**"))
        .await
        .unwrap();
    assert_eq!(
        logs.flush_deadline(),
        deadline,
        "subsequent chunks cannot postpone the initial flush"
    );
    assert_eq!(realtime.published().len(), 1);
    flush_start(&mut logs).await;
    let published = realtime.published();
    assert_eq!(published.len(), 2);
    assert_eq!(
        published[1]
            .entries
            .iter()
            .map(|e| e.id)
            .collect::<Vec<_>>(),
        vec![prefix.log_id, words.log_id]
    );
}

#[tokio::test(start_paused = true)]
async fn words_arriving_after_a_prefix_was_published_still_get_an_early_flush() {
    let realtime = RecordingRealtime::new();
    let (_, mut logs) = fenced_connection(realtime.clone()).await;
    logs.append(prompt("first")).await.unwrap();
    logs.append(chunk("agent_message_chunk", "1. **"))
        .await
        .unwrap();
    flush_start(&mut logs).await;
    assert_eq!(realtime.published().len(), 2);
    tokio::time::advance(std::time::Duration::from_millis(100)).await;
    let words = logs
        .append(chunk("agent_message_chunk", "Sunlight**"))
        .await
        .unwrap();
    flush_start(&mut logs).await;
    let published = realtime.published();
    assert_eq!(published.len(), 3);
    assert_eq!(published[2].entries[0].id, words.log_id);
}

#[tokio::test(start_paused = true)]
async fn reasoning_after_short_prose_does_not_keep_triggering_early_flushes() {
    let realtime = RecordingRealtime::new();
    let (_, mut logs) = fenced_connection(realtime.clone()).await;
    logs.append(prompt("first")).await.unwrap();
    logs.append(chunk("agent_message_chunk", "Checking."))
        .await
        .unwrap();
    flush_start(&mut logs).await;
    logs.append(chunk("agent_thought_chunk", "Thinking more"))
        .await
        .unwrap();
    assert!(
        logs.flush_deadline().unwrap() - tokio::time::Instant::now()
            >= std::time::Duration::from_secs(1)
    );
}
