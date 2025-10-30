use anthropic::client::Client;
use anthropic::types::stream_response::{ContentDeltaEvent, StreamEvent};
use async_openai::types::{
    ChatCompletionRequestUserMessage, ChatCompletionRequestUserMessageContent,
    ChatCompletionToolArgs, ChatCompletionToolType, CreateChatCompletionRequestArgs,
    FunctionObjectArgs,
};
use futures::StreamExt;
use serde_json::json;
use std::io::Write;

#[tokio::main]
async fn main() {
    let weather_tool = ChatCompletionToolArgs::default()
        .r#type(ChatCompletionToolType::Function)
        .function(
            FunctionObjectArgs::default()
                .name("get_current_weather")
                .description("Get the current weather in a given location")
                .parameters(json!({
                    "type": "object",
                    "properties": {
                        "location": {
                            "type": "string",
                            "description": "The city and state, e.g. San Francisco, CA",
                        },
                        "unit": { "type": "string", "enum": ["celsius", "fahrenheit"] },
                    },
                    "required": ["location"],
                }))
                .build()
                .unwrap(),
        )
        .build()
        .expect("tool");

    let client = Client::dangerously_try_from_env();
    let request = CreateChatCompletionRequestArgs::default()
        .model("claude-haiku-4-5")
        .max_completion_tokens(1000_u32)
        .messages([ChatCompletionRequestUserMessage {
            content: ChatCompletionRequestUserMessageContent::Text(
                "what's the weather today in shenzhen?".into(),
            ),
            name: None,
        }
        .into()])
        .tools(vec![weather_tool])
        .build()
        .expect("request");

    let mut out = std::io::stdout();
    let mut stream = client.chat().create_stream(request).await;
    let mut tool_json = String::new();

    while let Some(part) = stream.next().await {
        writeln!(out, "{:#?}", part);
        if part.is_err() {
            writeln!(out, "{:?}", part).expect("io");
            break;
        }
        let part = part.unwrap();
        match part {
            StreamEvent::ContentBlockStart { content_block, .. } => {}
            StreamEvent::ContentBlockDelta { delta, .. } => match delta {
                ContentDeltaEvent::InputJsonDelta { partial_json } => {
                    tool_json.push_str(&partial_json);
                    write!(out, "{}", partial_json).expect("ok good yes");
                }
                ContentDeltaEvent::TextDelta { text } => {
                    write!(out, "{}", text).expect("io");
                }
                other => writeln!(out, "{:?}", other).expect("io"),
            },
            StreamEvent::ContentBlockStop { .. } | StreamEvent::ContentBlockStart { .. } => {
                writeln!(out).expect("io")
            }
            event => writeln!(out, "{:?}", event).expect("io"),
        }
    }

    let tool_call = serde_json::from_str::<serde_json::Value>(&tool_json);
    println!("tool call {:#?}", tool_call);
}
