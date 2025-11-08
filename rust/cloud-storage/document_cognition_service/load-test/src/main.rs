mod config;
use anyhow::{Context, Result, anyhow};
use futures::{SinkExt, StreamExt};
use http::uri::Uri;
use serde::{Deserialize, Serialize};
use std::{sync::Arc, time::Duration};
use tokio_tungstenite::{connect_async, tungstenite::Message};
use tungstenite::ClientRequestBuilder;

/// Returns a chat id of a newly created chat
async fn create_chat(config: Arc<config::Config>) -> anyhow::Result<String> {
    let client = reqwest::Client::new();

    let response = client
        .post(format!("https://{}/chats", config.base_url))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(
            "Authorization",
            format!("Bearer {}", std::env::var("TOKEN").unwrap()),
        )
        .body(r#"{}"#)
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;

    let data = response.get("data").context("missing data")?;

    let id = data.get("id").context("missing id")?.as_str().unwrap();

    Ok(id.to_string())
}

/// deletes a chat given the chat id
async fn delete_chat(config: &config::Config, chat_id: &str) -> anyhow::Result<()> {
    let client = reqwest::Client::new();

    client
        .delete(format!("https://{}/chats/{}", config.base_url, chat_id))
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .header(
            "Authorization",
            format!("Bearer {}", std::env::var("TOKEN").unwrap()),
        )
        .send()
        .await?
        .json::<serde_json::Value>()
        .await?;

    Ok(())
}

#[derive(Debug)]
struct ConnectionReport {
    pub messages_sent: usize,
    pub messages_acknowledged: usize,
    pub messages_finished: usize,
    pub messages_received: usize,
    pub times_to_acknowledge: Vec<f64>,
    pub times_to_finish: Vec<f64>,
}

#[derive(Serialize, Deserialize)]
struct SendMessagePayload {
    #[serde(rename = "type")]
    message_type: String,
    content: String,
    chat_id: String,
}

/// Represents a single user connection to the websocket
async fn connection(config: Arc<config::Config>) -> Result<ConnectionReport> {
    let mut messages_sent = 0;
    let mut messages_received = 0;
    let mut messages_acknowledged = 0;
    let mut messages_finished = 0;
    let mut times_to_acknowledge = Vec::new();
    let mut times_to_finish = Vec::new();
    let chat_id = create_chat(config.clone()).await?;

    let req =
        ClientRequestBuilder::new("wss://document-cognition-dev.macro.com/stream".parse::<Uri>()?)
            .with_header(
                "Authorization",
                format!("Bearer {}", std::env::var("TOKEN").unwrap()),
            );

    let (ws_stream, _) = connect_async(req).await?;
    let (mut wx, mut rx) = ws_stream.split();

    let connection_start = std::time::Instant::now();

    for _ in 0..config.request_per_connection {
        let mut time_to_acknowledge = 0.0;
        let mut time_to_finish = 0.0;
        let outgoing_message = SendMessagePayload {
            message_type: "send_message".to_string(),
            content: "Hello world!".to_string(),
            chat_id: chat_id.clone(),
        };

        let message = Message::text(serde_json::to_string(&outgoing_message)?);

        let start = std::time::Instant::now();
        wx.send(message).await?;
        messages_sent += 1;

        let mut message_complete = false;
        while !message_complete {
            let timeout_duration = config
                .connection_timeout
                .saturating_sub(connection_start.elapsed());
            match tokio::time::timeout(timeout_duration, rx.next()).await {
                Ok(Some(Ok(Message::Text(text)))) => {
                    let message: serde_json::Value = serde_json::from_str(&text)?;
                    let message_type = message
                        .get("type")
                        .context("missing type")?
                        .as_str()
                        .context("invalid type")?;

                    match message_type {
                        "message_ack" => {
                            messages_received += 1;
                            messages_acknowledged += 1;
                            time_to_acknowledge = start.elapsed().as_millis() as f64;
                        }
                        "message_finished" => {
                            messages_received += 1;
                            messages_finished += 1;
                            time_to_finish = start.elapsed().as_millis() as f64;
                            message_complete = true;
                        }
                        _ => {
                            messages_received += 1;
                        }
                    }
                }
                Ok(Some(Err(e))) => eprintln!("Error receiving message: {:?}", e),
                Ok(None) => break,
                Err(_) => {
                    break;
                }
                _ => {
                    eprintln!("Unexpected message");
                    break;
                }
            }

            if connection_start.elapsed() >= config.connection_timeout {
                break;
            }
        }

        if connection_start.elapsed() >= config.connection_timeout {
            break;
        }

        times_to_acknowledge.push(time_to_acknowledge);
        times_to_finish.push(time_to_finish);
    }

    delete_chat(&config, &chat_id).await?;

    Ok(ConnectionReport {
        messages_sent,
        messages_received,
        messages_finished,
        messages_acknowledged,
        times_to_acknowledge,
        times_to_finish,
    })
}

async fn run_connections(config: Arc<config::Config>) -> anyhow::Result<Vec<ConnectionReport>> {
    let mut handles = Vec::new();
    let delay_per_connection =
        Duration::from_secs(config.ramp_up_duration.as_secs() / (config.num_connections as u64));

    for i in 0..config.num_connections {
        let config = config.clone();
        let handle = tokio::spawn(async move {
            // Delay based on connection index for ramp-up tokio::time::sleep(delay).await;
            tokio::time::sleep(delay_per_connection * (i as u32)).await;

            // Small additional delay between connections
            tokio::time::sleep(config.delay_between_connections).await;

            connection(config.clone()).await.map_err(|e| {
                eprintln!("connection error: {}", e);
            })
        });
        handles.push(handle);
    }

    let mut results = Vec::new();
    for handle in handles {
        if let Ok(Ok(report)) = handle.await {
            results.push(report);
        }
    }

    Ok(results)
}

fn display_results(
    config: &config::Config,
    results: Vec<ConnectionReport>,
    duration: Duration,
) -> anyhow::Result<()> {
    let (sent_count, received_count, acknowledged_cout, finished_count) = results
        .iter()
        .map(|r| {
            (
                r.messages_sent,
                r.messages_received,
                r.messages_acknowledged,
                r.messages_finished,
            )
        })
        .reduce(|a, b| (a.0 + b.0, a.1 + b.1, a.2 + b.2, a.3 + b.3))
        .context("failed to calculate stats")?;

    let avg_ack = results
        .iter()
        .flat_map(|r| &r.times_to_acknowledge)
        .sum::<f64>()
        / results
            .iter()
            .map(|r| r.times_to_acknowledge.len())
            .sum::<usize>() as f64;

    let avg_finish = results.iter().flat_map(|r| &r.times_to_finish).sum::<f64>()
        / results
            .iter()
            .map(|r| r.times_to_finish.len())
            .sum::<usize>() as f64;

    println!("Load test report:");
    println!(
        "Ran {} connections, across {} chats, sending up to {} messages over {:?}",
        config.num_connections,
        config.num_connections,
        config.request_per_connection * config.num_connections,
        duration
    );
    println!("Ramp-up duration: {:?}", config.ramp_up_duration);
    println!(
        "Delay between connections: {:?}",
        config.delay_between_connections
    );
    println!("Messages sent: {}", sent_count);
    println!("Messages received: {}", received_count);
    println!("Messages acknowledged: {}", acknowledged_cout);
    println!("Messages finished: {}", finished_count);
    println!("Average time to acknowledge message: {:.2}ms", avg_ack);
    println!("Average time to finish message: {:.2}ms", avg_finish);
    Ok(())
}

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    let config_path: String = std::env::args()
        .collect::<Vec<String>>()
        .get(1)
        .context("ERROR: expected load config path in args. eg: `cargo run -- config.json`")?
        .to_string();

    if std::env::var("TOKEN").is_err() {
        return Err(anyhow!("please set `TOKEN` env var with your macro-token"));
    }

    let config = Arc::new(config::read(&config_path)?);
    let chat_id = create_chat(config.clone()).await.unwrap();
    delete_chat(&config, &chat_id)
        .await
        .context("failed to delete chat")?;

    let start_time = std::time::Instant::now();
    let results = run_connections(config.clone()).await?;
    let total_duration = start_time.elapsed();

    display_results(&config, results, total_duration).context("failed to display results")?;

    Ok(())
}
