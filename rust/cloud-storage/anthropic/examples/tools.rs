use anthropic::prelude::*;
use futures::StreamExt;
use serde_json::json;
use std::io::Write;

#[tokio::main]
async fn main() {
    // define tool (copy-pasted from openai playground)
    let weather_tool = json!(

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

    let client = anthropic::client::Client::dangerously_try_from_env();
    let mut request = anthropic::types::request::CreateMessageRequestBody::default();
    request.model = "claude-haiku-4-5".into();
    request.max_tokens = 6767;
    request.messages = vec![RequestMessage {
        content: RequestContent::Text("what's the weather today in shenzen?".into()),
        role: Role::User,
    }];
    request.tools = Some(vec![Tool {
        description: Some("get the weather".into()),
        name: "check_weather".into(),
        input_schema: weather_tool,
    }]);
    let mut out = std::io::stdout();
    let mut stream = client.chat().create_stream(request).await;
    let mut tool_json = String::new();
    while let Some(part) = stream.next().await {
        if part.is_err() {
            writeln!(out, "{:?}", part).expect("good ok yes");
            break;
        }
        let part = part.unwrap();
        match part {
            StreamEvent::ContentBlockDelta { delta, .. } => match delta {
                ContentDeltaEvent::InputJsonDelta { partial_json } => {
                    tool_json.push_str(&partial_json);
                    write!(out, "{}", partial_json).expect("ok good yes");
                }
                ContentDeltaEvent::TextDelta { text } => {
                    write!(out, "{}", text).expect("ok good yes");
                }
                other => {
                    writeln!(out, "{:?}", other).expect("donkey");
                }
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
