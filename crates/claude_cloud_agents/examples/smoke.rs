//! Explicit opt-in live smoke test. Credentials are read privately, never printed.
use agent_runtime_protocol::domain::{
    connection::ServerChannel,
    schema::v0::{AcpMessage, ToRuntimeMessage, ToServerMessage},
};
use clap::Parser;
use claude_cloud_agents::{
    domain::{model::SessionId, models, service::Session},
    inbound::acp,
    outbound::{credentials::FileCredentials, http::Client},
};
use serde_json::{Value, json};

#[derive(Parser)]
struct Args {
    #[arg(long)]
    credentials: std::path::PathBuf,
    #[arg(long)]
    owner: String,
    /// Existing cloud conversation. Omitting this creates one new conversation.
    #[arg(long)]
    session: Option<String>,
    /// Discover choices without creating a session or spending inference.
    #[arg(long)]
    discover_only: bool,
    /// Select a discovered model before sending the smoke prompt.
    #[arg(long)]
    model: Option<String>,
}

fn send(channel: &ServerChannel, value: Value) {
    channel
        .tx
        .send(ToRuntimeMessage::Acp(AcpMessage(
            serde_json::from_value(value).unwrap(),
        )))
        .unwrap();
}

async fn response(channel: &mut ServerChannel, id: u8) -> Value {
    loop {
        let message = tokio::time::timeout(std::time::Duration::from_secs(180), channel.rx.recv())
            .await
            .expect("cloud response timeout")
            .expect("ACP connection closed");
        if let ToServerMessage::Acp(AcpMessage(frame)) = message {
            let frame = serde_json::to_value(frame).unwrap();
            if frame["id"] == id {
                return frame;
            }
        }
    }
}

#[tokio::main(flavor = "current_thread")]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args = Args::parse();
    let credentials = FileCredentials::open(args.credentials).await?;
    let client = Client::new(credentials, args.owner).await?;
    if args.discover_only {
        for option in models::discover(&client).await?.options() {
            println!("{}: {}", option.model.id(), option.name);
        }
        return Ok(());
    }
    let id = match args.session {
        Some(id) => SessionId::parse(&id)?,
        None => {
            client
                .create(
                    "",
                    &models::Model::parse(args.model.as_deref().unwrap_or("default"))?,
                )
                .await?
        }
    };
    println!("Testing Claude cloud session {}", id.as_str());
    let session = Session::new(client, id.clone());
    let mut channel = acp::attach(session);
    send(
        &channel,
        json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}),
    );
    assert!(response(&mut channel, 1).await.get("result").is_some());
    send(
        &channel,
        json!({"jsonrpc":"2.0","id":2,"method":"session/load","params":{"sessionId":id.as_str(),"cwd":"/","mcpServers":[]}}),
    );
    let loaded = response(&mut channel, 2).await;
    assert!(
        loaded.get("result").is_some(),
        "history load failed: {loaded}"
    );
    if let Some(model) = args.model {
        send(
            &channel,
            json!({"jsonrpc":"2.0","id":4,"method":"session/set_config_option","params":{"sessionId":id.as_str(),"configId":"model","value":model}}),
        );
        let selected = response(&mut channel, 4).await;
        assert!(
            selected.get("result").is_some(),
            "model selection failed: {selected}"
        );
    }
    send(
        &channel,
        json!({"jsonrpc":"2.0","id":3,"method":"session/prompt","params":{"sessionId":id.as_str(),"prompt":[{"type":"text","text":"Reply exactly MACRO_CLAUDE_HARNESS_OK. Do not use tools, read files, access the network, or modify anything."}]}}),
    );
    let mut text = String::new();
    let mut chunks = 0;
    loop {
        let message = tokio::time::timeout(std::time::Duration::from_secs(180), channel.rx.recv())
            .await?
            .ok_or("ACP closed")?;
        let ToServerMessage::Acp(AcpMessage(frame)) = message else {
            continue;
        };
        let frame = serde_json::to_value(frame)?;
        if frame["params"]["update"]["sessionUpdate"] == "agent_message_chunk" {
            text.push_str(
                frame["params"]["update"]["content"]["text"]
                    .as_str()
                    .ok_or("missing text")?,
            );
            chunks += 1;
        }
        if frame["id"] == 3 {
            assert_eq!(
                frame["result"]["stopReason"], "end_turn",
                "turn failed: {frame}"
            );
            break;
        }
    }
    assert_eq!(text.trim(), "MACRO_CLAUDE_HARNESS_OK");
    println!(
        "PASS: ACP initialize + history load + prompt + {chunks} text chunks + successful completion. Cloud transcript retained."
    );
    Ok(())
}
