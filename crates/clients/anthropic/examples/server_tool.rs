use anthropic::openai::request::{AnthropicRequestExtension, AnthropicRequestExtensions};
use anthropic::prelude::CODE_EXECUTION_TOOL;
use std::io::Write;
use std::process::exit;

use anthropic::client::Client;
use anthropic::types::request::{
    CreateMessageRequestBody, RequestContent, RequestMessage, Role, SystemPrompt,
};
use anthropic::types::response::{ContentDeltaEvent, StreamEvent};
use futures::StreamExt;
use std::fs::OpenOptions;

const LOG_MODE: bool = false;

#[tokio::main]
async fn main() {
    let client = Client::dangerously_try_from_env(Some(AnthropicRequestExtensions(vec![
        AnthropicRequestExtension::CodeExecutionTool,
    ])));
    let mut request = CreateMessageRequestBody {
        max_tokens: 1000,
        system: Some(SystemPrompt::Text(
            "You are a helpful AI assistant in a CLI based demo. Use the code execution tool eagerly"
                .into(),
        )),
        model: "claude-haiku-4-5".into(),
        tools: Some(vec![CODE_EXECUTION_TOOL.clone().into()]),
        ..Default::default()
    };
    let mut out = std::io::stdout();

    loop {
        write!(out, ">>> ").expect("io");
        out.flush().expect("io");

        let mut user_input = String::new();
        std::io::stdin().read_line(&mut user_input).expect("io");
        let message = RequestMessage {
            role: Role::User,
            content: RequestContent::Text(user_input),
        };
        request.messages.push(message);
        let chat = client.chat();
        let mut stream = chat.create_stream(request.clone()).await;
        let mut assistant_message = String::new();

        let mut file = OpenOptions::new()
            .write(true)
            .create(LOG_MODE)
            .open("stream.json")
            .ok();

        while let Some(event) = stream.next().await {
            if LOG_MODE {
                if let Some(ref mut file) = file {
                    if let Ok(e) = event {
                        write!(file, "\n{}\n", serde_json::to_string_pretty(&e).unwrap()).unwrap();
                    } else {
                        write!(file, "{:#?}", event.unwrap_err()).unwrap();
                    }
                }
                continue;
            }
            if let Err(error) = event {
                writeln!(out, "\nerror: {:#?}", error).expect("io");
                exit(1);
            } else {
                let event = event.unwrap();
                let response_text = match event {
                    StreamEvent::MessageDelta { delta, .. } => match delta.content {
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
                        ContentDeltaEvent::CitationsDelta { .. } => "[Citation]".into(),
                        ContentDeltaEvent::BashCodeExecutionToolResult(result) => {
                            format!("{:#?}", result)
                        }
                        ContentDeltaEvent::TextEditorCodeExecutionToolResult(result) => {
                            format!("{:#?}", result)
                        }
                        ContentDeltaEvent::ServerToolUse(tool) => {
                            format!("{:#?}", tool)
                        }
                        _ => "".into(),
                    },
                    StreamEvent::Error { error } => format!("error: {:?}", error),
                    StreamEvent::ContentBlockStart { content_block, .. } => match content_block {
                        ContentDeltaEvent::ServerToolUse(tool) => {
                            format!("{:#?}", tool)
                        }
                        ContentDeltaEvent::BashCodeExecutionToolResult(result) => {
                            format!("{:#?}", result)
                        }
                        ContentDeltaEvent::TextEditorCodeExecutionToolResult(result) => {
                            format!("{:#?}", result)
                        }
                        _ => "".into(),
                    },
                    _ => "".into(),
                };
                write!(out, "{}", response_text).expect("io");
                assistant_message.push_str(&response_text);
                out.flush().expect("io");
            }
        }
        let response = RequestMessage {
            role: Role::Assistant,
            content: RequestContent::Text(assistant_message),
        };
        request.messages.push(response);
        writeln!(out).expect("io");
    }
}
