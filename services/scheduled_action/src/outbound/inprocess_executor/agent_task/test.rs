use super::*;
use macro_uuid::generate_uuid_v7;
use serde_json::json;

struct Memory {
    fail: bool,
    value: Option<String>,
}

impl MemoryService for Memory {
    async fn get_or_generate_memory(
        &self,
        _: MacroUserIdStr<'static>,
    ) -> memory::domain::ports::Result<Option<String>> {
        if self.fail {
            return Err(memory::domain::ports::MemoryError::NoGeneration);
        }
        Ok(self.value.clone())
    }
}

#[tokio::test]
async fn automation_instructions_survive_absent_and_failed_memory() {
    let owner = MacroUserIdStr::parse_from_str("macro|owner@macro.com").unwrap();
    for fail in [false, true] {
        let memory = Memory { fail, value: None };
        let prompt = system_prompt(&memory, &owner, "tools", "task").await;
        assert_eq!(prompt, format!("tools\n{SCHEDULED_AGENT_PROMPT}\ntask"));
    }
    let memory = Memory {
        fail: false,
        value: Some("remember".into()),
    };
    assert_eq!(
        system_prompt(&memory, &owner, "tools", "task").await,
        format!("tools\n{SCHEDULED_AGENT_PROMPT}\n<user_memory>\nremember\n</user_memory>\ntask"),
    );
}

#[tokio::test]
async fn partial_stream_error_is_not_success() {
    let stream = futures::stream::iter(vec![
        Ok(StreamPart::Content("partial".into())),
        Err(agent::AgentError::Other(anyhow::anyhow!("provider failed"))),
    ]);
    assert!(
        collect_stream(stream, Duration::from_secs(1))
            .await
            .is_err()
    );
}

#[tokio::test]
async fn idle_after_partial_content_is_not_success() {
    let stream = futures::stream::once(async { Ok(StreamPart::Content("partial".into())) })
        .chain(futures::stream::pending());
    let error = collect_stream(stream, Duration::from_millis(1))
        .await
        .unwrap_err();
    assert!(error.to_string().contains("idle timeout"));
}

#[tokio::test]
async fn completed_stream_retains_assistant_text() {
    let parts = collect_stream(
        futures::stream::iter(vec![Ok(StreamPart::Content("complete".into()))]),
        Duration::from_secs(1),
    )
    .await
    .unwrap();
    assert!(matches!(&parts[..], [AssistantMessagePart::Text { text }] if text == "complete"));
}

#[test]
fn event_is_separate_user_data_not_a_prompt_rewrite() {
    let task = AgentTask {
        model: "test".into(),
        prompt: "original system".into(),
        user_prompt: "original user".into(),
    };
    let event: EventReference = serde_json::from_value(json!({
        "event_id": generate_uuid_v7(), "event_name": "channel.message_posted",
        "entity_id": generate_uuid_v7(), "message_id": generate_uuid_v7(),
    }))
    .unwrap();
    let messages = user_messages(&task, Some(&event)).unwrap();
    assert_eq!(messages.len(), 2);
    assert!(
        messages
            .iter()
            .all(|message| matches!(message.role, Role::User))
    );
    assert!(
        matches!(&messages[0].content, ChatMessageContent::Text(text) if text == "original user")
    );
    let ChatMessageContent::Text(context) = &messages[1].content else {
        panic!("expected context text")
    };
    assert!(context.contains(&event.event_id().as_uuid().to_string()));
    assert!(context.contains(&event.entity_id().to_string()));
    assert!(context.contains(&event.message_id().unwrap().to_string()));
    assert_eq!(task.prompt, "original system");
    assert_eq!(task.user_prompt, "original user");
    assert_eq!(user_messages(&task, None).unwrap().len(), 1);
}
