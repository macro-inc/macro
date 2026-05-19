use std::time::Duration;

use anyhow::{Context, ensure};
use futures::{SinkExt, StreamExt};
use local_e2e_test_support::{
    LocalE2eConfig, LocalE2eSeed, LocalE2eServices, LocalJwtOptions, encode_local_jwt_with,
};
use serde::Deserialize;
use serde_json::{Value, json};
use tokio::time::{Instant, timeout};
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::{Error as WebsocketError, Message as WebsocketMessage};

const WEBSOCKET_TIMEOUT: Duration = Duration::from_secs(10);

#[tokio::test]
#[ignore = "requires `just local-e2e-seed` plus connection_gateway and document_storage_service"]
async fn channel_message_posts_to_http_and_delivers_to_websocket() -> anyhow::Result<()> {
    let config = LocalE2eConfig::load()?;
    let seed = LocalE2eSeed::from_config(&config)?;
    let services = LocalE2eServices::from_config(&config)?;

    let user = seed.smoke_user()?;
    let channel = seed.general_channel()?;
    let token = encode_local_jwt_with(&config, LocalJwtOptions::new(user))?;
    let ws_url = services.connection_gateway_ws_url_with_token(&token)?;

    let (websocket, _) = connect_async(&ws_url)
        .await
        .context("failed to connect to connection gateway websocket")?;
    let (mut websocket_write, mut websocket_read) = websocket.split();

    websocket_write
        .send(WebsocketMessage::Text("ping".into()))
        .await
        .context("failed to send websocket ping")?;
    wait_for_pong(&mut websocket_read).await?;

    let nonce = format!("rust-local-e2e-{}", uuid_like_nonce());
    let content = format!("Rust local E2E websocket delivery {nonce}");

    let http = reqwest::Client::new();
    let post_response = http
        .post(services.post_channel_message_url(&channel.channel_id))
        .bearer_auth(&token)
        .json(&json!({
            "content": content,
            "mentions": [],
            "thread_id": null,
            "attachments": [],
            "nonce": nonce,
        }))
        .send()
        .await
        .context("failed to POST channel message")?;
    let post_response = require_success(post_response, "POST channel message").await?;
    let posted: PostMessageResponse = post_response
        .json()
        .await
        .context("failed to decode post message response")?;

    ensure!(
        posted.nonce.as_deref() == Some(nonce.as_str()),
        "post response did not echo nonce; response={posted:?}"
    );

    let delivered = wait_for_comms_message(&mut websocket_read, &posted.id, &nonce).await?;
    ensure!(
        delivered.get("content").and_then(Value::as_str) == Some(content.as_str()),
        "websocket message content mismatch: {delivered}"
    );
    ensure!(
        delivered.get("channel_id").and_then(Value::as_str) == Some(channel.channel_id.as_str()),
        "websocket message channel mismatch: {delivered}"
    );
    ensure!(
        delivered.get("sender_id").and_then(Value::as_str) == Some(user.user_id.as_str()),
        "websocket message sender mismatch: {delivered}"
    );

    let get_response = http
        .get(format!(
            "{}?limit=25",
            services.get_channel_url(&channel.channel_id)
        ))
        .bearer_auth(&token)
        .send()
        .await
        .context("failed to GET channel")?;
    let get_response = require_success(get_response, "GET channel").await?;
    let channel_response: Value = get_response
        .json()
        .await
        .context("failed to decode get channel response")?;

    let persisted = channel_response
        .get("messages")
        .and_then(Value::as_array)
        .and_then(|messages| {
            messages.iter().find(|message| {
                message.get("id").and_then(Value::as_str) == Some(posted.id.as_str())
            })
        })
        .with_context(|| {
            format!(
                "posted message {} was not returned by GET channel",
                posted.id
            )
        })?;

    ensure!(
        persisted.get("content").and_then(Value::as_str) == Some(content.as_str()),
        "persisted message content mismatch: {persisted}"
    );

    websocket_write
        .send(WebsocketMessage::Close(None))
        .await
        .ok();

    Ok(())
}

#[derive(Debug, Deserialize)]
struct PostMessageResponse {
    id: String,
    nonce: Option<String>,
}

#[derive(Debug, Deserialize)]
struct GatewayMessage {
    #[serde(rename = "type")]
    message_type: String,
    data: String,
}

async fn require_success(
    response: reqwest::Response,
    context: &str,
) -> anyhow::Result<reqwest::Response> {
    if response.status().is_success() {
        return Ok(response);
    }

    let status = response.status();
    let body = response.text().await.unwrap_or_default();
    anyhow::bail!("{context} failed with {status}: {body}")
}

async fn wait_for_pong<S>(websocket_read: &mut S) -> anyhow::Result<()>
where
    S: StreamExt<Item = Result<WebsocketMessage, WebsocketError>> + Unpin,
{
    loop {
        let message = next_websocket_message(websocket_read, WEBSOCKET_TIMEOUT).await?;
        if let WebsocketMessage::Text(text) = message
            && text == "pong"
        {
            return Ok(());
        }
    }
}

async fn wait_for_comms_message<S>(
    websocket_read: &mut S,
    expected_message_id: &str,
    expected_nonce: &str,
) -> anyhow::Result<Value>
where
    S: StreamExt<Item = Result<WebsocketMessage, WebsocketError>> + Unpin,
{
    let deadline = Instant::now() + WEBSOCKET_TIMEOUT;

    loop {
        let remaining = deadline.saturating_duration_since(Instant::now());
        ensure!(
            !remaining.is_zero(),
            "timed out waiting for websocket comms_message {expected_message_id}"
        );

        let message = next_websocket_message(websocket_read, remaining).await?;
        let WebsocketMessage::Text(text) = message else {
            continue;
        };

        if text == "pong" {
            continue;
        }

        let Some((message_type, data)) = parse_gateway_message(&text) else {
            continue;
        };

        if message_type != "comms_message" {
            continue;
        }

        if data.get("id").and_then(Value::as_str) == Some(expected_message_id)
            && data.get("nonce").and_then(Value::as_str) == Some(expected_nonce)
        {
            return Ok(data);
        }
    }
}

async fn next_websocket_message<S>(
    websocket_read: &mut S,
    duration: Duration,
) -> anyhow::Result<WebsocketMessage>
where
    S: StreamExt<Item = Result<WebsocketMessage, WebsocketError>> + Unpin,
{
    timeout(duration, websocket_read.next())
        .await
        .context("timed out waiting for websocket message")?
        .context("websocket closed before expected message")?
        .context("websocket returned an error")
}

fn parse_gateway_message(text: &str) -> Option<(String, Value)> {
    let gateway: GatewayMessage = serde_json::from_str(text).ok()?;
    let data = serde_json::from_str(&gateway.data).ok()?;
    Some((gateway.message_type, data))
}

fn uuid_like_nonce() -> String {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_nanos()
        .to_string()
}
