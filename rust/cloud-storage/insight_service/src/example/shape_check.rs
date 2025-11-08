use crate::insight::consumer::generator::generate_insights;
use chrono::Utc;
use macro_entrypoint::MacroEntrypoint;
use model::insight_context::chat::{ChatContext, Conversation, UserMessage};

const MESSAGES: &str = include_str!("../../../test/chat_log.txt");

fn make_context() -> ChatContext {
    let my_messages = MESSAGES
        .lines()
        .map(|m| UserMessage {
            attachment_insights: vec![],
            date: Utc::now(),
            content: m.to_string(),
        })
        .collect::<Vec<_>>();

    ChatContext(vec![Conversation {
        conversation_title: "test conversation".to_string(),
        messages: my_messages,
    }])
}

#[tokio::main]
async fn main() -> Result<(), anyhow::Error> {
    MacroEntrypoint::default().init();

    let mock_chat_context = make_context();
    let log_description = "ai chat messages sent by a user";
    let new_insights = generate_insights(
        "chat",
        "user@user.com",
        log_description,
        mock_chat_context.into(),
        &[],
    )
    .await
    .expect("no error");
    assert!(!new_insights.is_empty(), "not empty");
    panic!("INSPECT THE GENERATED INSPECT\n{:#?}", new_insights);
}
