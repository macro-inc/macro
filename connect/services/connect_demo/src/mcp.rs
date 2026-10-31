use connect_client::ConnectClient;
use connect_platform::inject_trace_headers;
use futures::StreamExt as _;
use reqwest::header::{ACCEPT, CONTENT_TYPE, HeaderMap, HeaderValue};
use serde_json::{Value, json};
use sse_stream::SseStream;
use std::collections::HashSet;
use tracing::Span;

#[derive(Debug, thiserror::Error)]
pub enum McpError {
    #[error("gateway request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("gateway returned HTTP {0}")]
    Status(reqwest::StatusCode),
    #[error("gateway response was not valid MCP JSON")]
    InvalidResponse,
    #[error("gateway returned an MCP error: {0}")]
    Protocol(Value),
}

struct McpSession {
    id: Option<String>,
    protocol_version: String,
}

pub async fn list_tools(
    client: &ConnectClient,
    http: &reqwest::Client,
    user_id: &str,
    app_id: &str,
) -> Result<Value, McpError> {
    let session = initialize(client, http, user_id, app_id).await?;
    let upstream = client.mcp_upstream(user_id, app_id);
    send(
        http,
        &upstream,
        Some(&session),
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
    )
    .await?;
    let mut tools = Vec::new();
    let mut cursor: Option<String> = None;
    let mut seen = HashSet::new();
    loop {
        let params = cursor
            .as_ref()
            .map_or_else(|| json!({}), |cursor| json!({"cursor":cursor}));
        let result = request(
            http,
            &upstream,
            Some(&session),
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list","params":params}),
        )
        .await?;
        tools.extend(
            result
                .get("tools")
                .and_then(Value::as_array)
                .ok_or(McpError::InvalidResponse)?
                .iter()
                .cloned(),
        );
        cursor = result
            .get("nextCursor")
            .and_then(Value::as_str)
            .map(str::to_owned);
        match &cursor {
            Some(next) if !seen.insert(next.clone()) => return Err(McpError::InvalidResponse),
            Some(_) => {}
            None => return Ok(json!({"tools":tools})),
        }
    }
}

pub async fn call_tool(
    client: &ConnectClient,
    http: &reqwest::Client,
    user_id: &str,
    app_id: &str,
    name: &str,
    arguments: Value,
) -> Result<Value, McpError> {
    let session = initialize(client, http, user_id, app_id).await?;
    let upstream = client.mcp_upstream(user_id, app_id);
    send(
        http,
        &upstream,
        Some(&session),
        json!({"jsonrpc":"2.0","method":"notifications/initialized"}),
    )
    .await?;
    request(http, &upstream, Some(&session), json!({"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":name,"arguments":arguments}})).await
}

async fn initialize(
    client: &ConnectClient,
    http: &reqwest::Client,
    user_id: &str,
    app_id: &str,
) -> Result<McpSession, McpError> {
    let upstream = client.mcp_upstream(user_id, app_id);
    let (result, session) = send(http, &upstream, None, json!({
        "jsonrpc":"2.0", "id":1, "method":"initialize",
        "params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"connect-demo","version":"0.1.0"}}
    })).await?;
    let protocol_version = result
        .as_ref()
        .and_then(|value| value.get("protocolVersion"))
        .and_then(Value::as_str)
        .ok_or(McpError::InvalidResponse)?;
    Ok(McpSession {
        id: session,
        protocol_version: protocol_version.to_owned(),
    })
}

async fn request(
    http: &reqwest::Client,
    upstream: &connect_client::McpUpstream,
    session: Option<&McpSession>,
    payload: Value,
) -> Result<Value, McpError> {
    let (response, _) = send(http, upstream, session, payload).await?;
    response.ok_or(McpError::InvalidResponse)
}

async fn send(
    http: &reqwest::Client,
    upstream: &connect_client::McpUpstream,
    session: Option<&McpSession>,
    payload: Value,
) -> Result<(Option<Value>, Option<String>), McpError> {
    let mut headers = HeaderMap::new();
    inject_trace_headers(&mut headers);
    headers.insert(
        ACCEPT,
        HeaderValue::from_static("application/json, text/event-stream"),
    );
    headers.insert(CONTENT_TYPE, HeaderValue::from_static("application/json"));
    if let Some(session) = session {
        if let Some(id) = &session.id {
            headers.insert(
                "mcp-session-id",
                HeaderValue::from_str(id).map_err(|_| McpError::InvalidResponse)?,
            );
        }
        headers.insert(
            "mcp-protocol-version",
            HeaderValue::from_str(&session.protocol_version)
                .map_err(|_| McpError::InvalidResponse)?,
        );
    }
    let response = http
        .post(upstream.url.clone())
        .headers(headers)
        .bearer_auth(&upstream.bearer_token)
        .json(&payload)
        .send()
        .await?;
    if !response.status().is_success() {
        return Err(McpError::Status(response.status()));
    }
    let session = response
        .headers()
        .get("mcp-session-id")
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    if response.status() == reqwest::StatusCode::ACCEPTED && payload.get("id").is_none() {
        return Ok((None, session));
    }
    let is_sse = response
        .headers()
        .get(CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .is_some_and(|value| value.starts_with("text/event-stream"));
    let value = if is_sse {
        let mut events = SseStream::from_byte_stream(response.bytes_stream());
        let mut result = None;
        while let Some(event) = events.next().await {
            let event = event.map_err(|_| McpError::InvalidResponse)?;
            if let Some(data) = event.data
                && let Ok(value) = serde_json::from_str::<Value>(&data)
                && value.get("id") == payload.get("id")
                && (value.get("result").is_some() || value.get("error").is_some())
            {
                result = Some(value);
                break;
            }
        }
        result.ok_or(McpError::InvalidResponse)?
    } else {
        let body = response.bytes().await?;
        if body.is_empty() {
            return Ok((None, session));
        }
        serde_json::from_slice::<Value>(&body).map_err(|_| McpError::InvalidResponse)?
    };
    if let Some(error) = value.get("error") {
        Span::current().record("outcome", "protocol_error");
        return Err(McpError::Protocol(error.clone()));
    }
    Ok((value.get("result").cloned(), session))
}

#[cfg(test)]
mod test;
