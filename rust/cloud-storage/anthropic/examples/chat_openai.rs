use std::io::Write;
use std::process::exit;

use anthropic::client::Client;
use anthropic::error::AnthropicError;
use anthropic::types::stream_response::{ContentDeltaEvent, StreamEvent};
use async_openai::types::{
    ChatCompletionRequestAssistantMessage, ChatCompletionRequestAssistantMessageContent,
    ChatCompletionRequestMessage, ChatCompletionRequestSystemMessageArgs,
    ChatCompletionRequestUserMessage, ChatCompletionRequestUserMessageContent,
    CreateChatCompletionRequestArgs,
};
use futures::StreamExt;

#[tokio::main]
async fn main() {
    let client = Client::dangerously_try_from_env();

    let mut request = CreateChatCompletionRequestArgs::default()
        .model("claude-haiku-4-5")
        .max_completion_tokens(1000_u32)
        .messages([ChatCompletionRequestSystemMessageArgs::default()
            .content("you are donkey boy. refer to yourself only as donkey boy")
            .build()
            .expect("system message")
            .into()])
        .build()
        .expect("request");

    let mut out = std::io::stdout();

    loop {
        write!(out, ">>> ").expect("io");
        out.flush().expect("io");

        let mut user_input = String::new();
        std::io::stdin().read_line(&mut user_input).expect("io");
        let message = ChatCompletionRequestMessage::User(ChatCompletionRequestUserMessage {
            content: ChatCompletionRequestUserMessageContent::Text(user_input),
            name: None,
        });
        request.messages.push(message);
        let chat = client.chat();
        let mut stream = chat.create_stream(request.clone()).await;
        let mut assistant_response = String::new();

        while let Some(event) = stream.next().await {
            if let Err(error) = event {
                match error {
                    AnthropicError::StreamClosed(done) => {
                        writeln!(out, "\nstream closed {:#?}", done).expect("io");
                        break;
                    }
                    other => {
                        writeln!(out, "\nerror: {:#?}", other).expect("io");
                        exit(1);
                    }
                }
            } else {
                let event = event.unwrap();
                let response_text = match event {
                    StreamEvent::MessageDelta { delta } => match delta.content {
                        Some(anthropic::types::response::Content::Text(txt)) => txt,
                        Some(anthropic::types::response::Content::Array(arr)) => {
                            format!("{:?}", arr)
                        }
                        _ => "".into(),
                    },
                    StreamEvent::ContentBlockDelta { delta, .. } => match delta {
                        ContentDeltaEvent::StartTextDelta { text } => text,
                        ContentDeltaEvent::TextDelta { text } => text,
                        ContentDeltaEvent::ThinkingDelta { thinking } => thinking,
                        _ => "other-block-delta\n".into(),
                    },
                    StreamEvent::ContentBlockStart { .. } => "content-block-start\n".into(),
                    StreamEvent::ContentBlockStop { .. } => "\ncontent-block-stop\n".into(),
                    StreamEvent::Ping => "".into(),
                    StreamEvent::MessageStart { .. } => "message-start\n".into(),
                    StreamEvent::MessageStop { .. } => "message-stop\n".into(),
                };
                write!(out, "{}", response_text).expect("io");
                assistant_response.push_str(&response_text);
                out.flush().expect("io");
            }
        }
        let mut response = ChatCompletionRequestAssistantMessage::default();
        response.content = Some(ChatCompletionRequestAssistantMessageContent::Text(
            assistant_response,
        ));
        request.messages.push(response.into());
        writeln!(out).expect("io");
    }
}
