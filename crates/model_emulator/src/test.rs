use std::collections::BTreeMap;

use futures::StreamExt;
use rig_core::client::CompletionClient;
use rig_core::completion::{CompletionModel, ToolDefinition};
use rig_core::providers::gemini;
use rig_core::streaming::StreamedAssistantContent;
use serde_json::{Value, json};

use crate::{DEFAULT_REPLY, ModelEmulator, Reply, Script, ScriptName, ToolCall};

fn name(name: &str) -> ScriptName {
    ScriptName::try_from(name.to_owned()).unwrap()
}

fn user(text: &str) -> Value {
    json!({ "role": "user", "parts": [{ "text": text }] })
}

fn model_called(tool: &str) -> Value {
    json!({ "role": "model", "parts": [{ "functionCall": { "name": tool, "args": {} } }] })
}

fn tool_answered(tool: &str) -> Value {
    json!({
        "role": "user",
        "parts": [{ "functionResponse": { "name": tool, "response": { "ok": true } } }],
    })
}

/// Posts a GenerateContent request and answers the reply's parts.
async fn parts(emulator: &ModelEmulator, body: Value) -> Value {
    let response: Value = reqwest::Client::new()
        .post(format!(
            "{}/v1beta/models/gemini-3.8-flash:generateContent",
            emulator.base_url()
        ))
        .json(&body)
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    response["candidates"][0]["content"]["parts"].clone()
}

fn tools() -> Value {
    json!([{ "functionDeclarations": [{ "name": "Look" }] }])
}

#[tokio::test]
async fn a_conversation_is_answered_its_scripts_replies_in_order() {
    let emulator = ModelEmulator::start().await.unwrap();
    emulator
        .set_script(
            name("look"),
            Script {
                replies: vec![
                    Reply {
                        text: None,
                        calls: vec![ToolCall {
                            name: "Look".to_owned(),
                            args: json!({ "turn": "{{turn}}", "at": ["{{turn}}/inbox"] }),
                        }],
                    },
                    Reply {
                        text: Some("Looked in turn {{turn}}.".to_owned()),
                        calls: Vec::new(),
                    },
                ],
                captures: BTreeMap::from([(
                    "turn".to_owned(),
                    r#"<invocation turn_id="([^"]+)">"#.to_owned(),
                )]),
            },
        )
        .unwrap();
    let asked = [
        user(r#"<invocation turn_id="old">"#),
        user("[[script:other]] Something else."),
        json!({ "role": "model", "parts": [{ "text": "Done." }] }),
        user(r#"[[script:look]] Look. <invocation turn_id="t-1">"#),
    ];

    let first = parts(&emulator, json!({ "contents": asked, "tools": tools() })).await;
    assert_eq!(first[0]["functionCall"]["name"], "Look");
    assert_eq!(
        first[0]["functionCall"]["args"],
        json!({ "turn": "t-1", "at": ["t-1/inbox"] })
    );

    let mut continued = asked.to_vec();
    continued.extend([model_called("Look"), tool_answered("Look")]);
    let second = parts(
        &emulator,
        json!({ "contents": continued, "tools": tools() }),
    )
    .await;
    assert_eq!(second, json!([{ "text": "Looked in turn t-1." }]));

    // Past the script's last reply the model has nothing more to say.
    continued.extend([model_called("Look"), tool_answered("Look")]);
    let third = parts(
        &emulator,
        json!({ "contents": continued, "tools": tools() }),
    )
    .await;
    assert_eq!(third, json!([{ "text": DEFAULT_REPLY }]));

    let received = emulator.requests(Some(&name("look")));
    assert_eq!(
        received
            .iter()
            .map(|request| request.reply)
            .collect::<Vec<_>>(),
        [Some(0), Some(1), None]
    );
    assert_eq!(received[0].model, "gemini-3.8-flash");
    emulator.shutdown().await;
}

#[tokio::test]
async fn a_request_outside_a_scripted_conversation_gets_the_default_reply() {
    let emulator = ModelEmulator::start().await.unwrap();
    emulator
        .set_script(
            name("look"),
            Script {
                replies: vec![Reply {
                    text: Some("Scripted.".to_owned()),
                    calls: Vec::new(),
                }],
                captures: BTreeMap::new(),
            },
        )
        .unwrap();

    // A title or a summary quotes the user's message but offers no tools.
    let untooled = parts(
        &emulator,
        json!({ "contents": [user("Name this: [[script:look]] Look.")] }),
    )
    .await;
    assert_eq!(untooled, json!([{ "text": DEFAULT_REPLY }]));

    let unnamed = parts(
        &emulator,
        json!({ "contents": [user("Look.")], "tools": tools() }),
    )
    .await;
    assert_eq!(unnamed, json!([{ "text": DEFAULT_REPLY }]));

    let unknown = parts(
        &emulator,
        json!({ "contents": [user("[[script:gone]] Look.")], "tools": tools() }),
    )
    .await;
    assert_eq!(unknown, json!([{ "text": DEFAULT_REPLY }]));

    let scripted = parts(
        &emulator,
        json!({ "contents": [user("[[script:look]] Look.")], "tools": tools() }),
    )
    .await;
    assert_eq!(scripted, json!([{ "text": "Scripted." }]));
    emulator.shutdown().await;
}

#[tokio::test]
async fn the_control_api_sets_scripts_and_reads_requests() {
    let emulator = ModelEmulator::start().await.unwrap();
    let http = reqwest::Client::new();
    let control = format!("{}/_emulator", emulator.base_url());

    let set = http
        .put(format!("{control}/scripts/look"))
        .json(&json!({ "replies": [{ "text": "Scripted." }] }))
        .send()
        .await
        .unwrap();
    assert_eq!(set.status(), 204);
    let refused = http
        .put(format!("{control}/scripts/look"))
        .json(&json!({ "replies": [], "captures": { "turn": "no group" } }))
        .send()
        .await
        .unwrap();
    assert_eq!(refused.status(), 400);

    let body = json!({ "contents": [user("[[script:look]] Look.")], "tools": tools() });
    assert_eq!(
        parts(&emulator, body.clone()).await,
        json!([{ "text": "Scripted." }])
    );
    parts(&emulator, json!({ "contents": [user("Hello.")] })).await;

    let received: Value = http
        .get(format!("{control}/requests?script=look"))
        .send()
        .await
        .unwrap()
        .json()
        .await
        .unwrap();
    assert_eq!(
        received,
        json!([{ "model": "gemini-3.8-flash", "script": "look", "reply": 0, "body": body }])
    );

    http.delete(format!("{control}/scripts/look"))
        .send()
        .await
        .unwrap();
    assert_eq!(
        parts(&emulator, body).await,
        json!([{ "text": DEFAULT_REPLY }])
    );
    http.delete(format!("{control}/requests"))
        .send()
        .await
        .unwrap();
    assert!(emulator.requests(None).is_empty());
    emulator.shutdown().await;
}

/// The client the agent's model router builds reads the emulator's stream:
/// the text, then the tool call with its arguments.
#[tokio::test]
async fn rigs_gemini_client_streams_a_scripted_reply() {
    let emulator = ModelEmulator::start().await.unwrap();
    emulator
        .set_script(
            name("look"),
            Script {
                replies: vec![Reply {
                    text: Some("Looking.".to_owned()),
                    calls: vec![ToolCall {
                        name: "Look".to_owned(),
                        args: json!({ "at": "inbox" }),
                    }],
                }],
                captures: BTreeMap::new(),
            },
        )
        .unwrap();
    let client: gemini::Client = gemini::Client::builder()
        .api_key("no-key")
        .base_url(emulator.base_url())
        .build()
        .unwrap();
    let model = client.completion_model("gemini-3.8-flash");

    let mut stream = model
        .completion_request("[[script:look]] Look.")
        .tool(ToolDefinition {
            name: "Look".to_owned(),
            description: "Looks.".to_owned(),
            parameters: json!({ "type": "object", "properties": { "at": { "type": "string" } } }),
        })
        .stream()
        .await
        .unwrap();
    let mut text = String::new();
    let mut calls = Vec::new();
    while let Some(part) = stream.next().await {
        match part.unwrap() {
            StreamedAssistantContent::Text(delta) => text.push_str(&delta.text),
            StreamedAssistantContent::ToolCall { tool_call, .. } => {
                calls.push((tool_call.function.name, tool_call.function.arguments));
            }
            _ => {}
        }
    }

    assert_eq!(text, "Looking.");
    assert_eq!(calls, [("Look".to_owned(), json!({ "at": "inbox" }))]);
    emulator.shutdown().await;
}
