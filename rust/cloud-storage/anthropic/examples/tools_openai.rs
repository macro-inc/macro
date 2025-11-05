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
    // define tool (copy-pasted from openai playground)
    let weather_tool_schema = json!(
        {
              "type": "object",
              "properties": {
                "location": {
                  "type": "string",
                  "description": "The city and state e.g. San Francisco, CA"
                },
                "unit": {
                  "type": "string",
                  "enum": [
                    "c",
                    "f"
                  ]
                }
              },
              "additionalProperties": false,
              "required": [
                "location",
                "unit"
              ]
            }
    );

    let weather_tool = ChatCompletionToolArgs::default()
        .r#type(ChatCompletionToolType::Function)
        .function(
            FunctionObjectArgs::default()
                .name("check_weather")
                .description("get the weather")
                .parameters(weather_tool_schema)
                .build()
                .expect("function object"),
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
        if part.is_err() {
            writeln!(out, "{:?}", part).expect("io");
            break;
        }
        let part = part.unwrap();
        match part {
            StreamEvent::ContentBlockDelta { delta, .. } => match delta {
                ContentDeltaEvent::InputJsonDelta { partial_json } => {
                    tool_json.push_str(&partial_json)
                }
                ContentDeltaEvent::TextDelta { text } => {
                    write!(out, "{}", text).expect("io");
                }
                _ => {}
            },
            StreamEvent::ContentBlockStop { .. } | StreamEvent::ContentBlockStart { .. } => {
                writeln!(out).expect("io")
            }
            _ => {}
        }
    }

    let tool_call = serde_json::from_str::<serde_json::Value>(&tool_json);
    println!("tool call {:#?}", tool_call);
}
