//! Test-only [`ConnectProxy`] that calls an app's API directly with a
//! personal token, for the ignored live previews of the API sources.

use std::time::Duration;

use macro_user_id::user_id::MacroUserIdStr;
use pipedream_mcp::domain::models::{ConnectProxyError, ProxyMethod, ProxyRequest, ProxyResponse};
use pipedream_mcp::domain::ports::ConnectProxy;
use tokio::sync::Mutex;
use tokio::time::Instant;

/// Notion and Linear both allow a few requests per second per token.
const REQUEST_INTERVAL: Duration = Duration::from_millis(350);

/// Sends proxied requests straight to their upstream URL.
pub(crate) struct DirectApi {
    http: reqwest::Client,
    authorization: String,
    next: Mutex<Instant>,
}

impl DirectApi {
    /// Authenticate every request with `authorization` (the whole header value).
    pub(crate) fn new(authorization: impl Into<String>) -> Self {
        Self {
            http: reqwest::Client::new(),
            authorization: authorization.into(),
            next: Mutex::new(Instant::now()),
        }
    }

    async fn send_once(&self, request: &ProxyRequest) -> Result<ProxyResponse, ConnectProxyError> {
        {
            let mut next = self.next.lock().await;
            tokio::time::sleep_until(*next).await;
            *next = Instant::now() + REQUEST_INTERVAL;
        }
        let mut builder = match request.method {
            ProxyMethod::Get => self.http.get(&request.url),
            ProxyMethod::Post => self.http.post(&request.url),
        }
        .header(reqwest::header::AUTHORIZATION, &self.authorization);
        for (name, value) in &request.headers {
            builder = builder.header(name, value);
        }
        if let Some(body) = &request.body {
            builder = builder.json(body);
        }
        let response = builder.send().await.map_err(anyhow::Error::new)?;
        let retry_after = response
            .headers()
            .get(reqwest::header::RETRY_AFTER)
            .and_then(|value| value.to_str().ok()?.trim().parse().ok())
            .map(Duration::from_secs);
        Ok(ProxyResponse {
            status: response.status().as_u16(),
            retry_after,
            body: response.bytes().await.map_err(anyhow::Error::new)?.to_vec(),
        })
    }
}

impl ConnectProxy for DirectApi {
    async fn send(
        &self,
        _: &MacroUserIdStr<'static>,
        _: &str,
        request: ProxyRequest,
    ) -> Result<ProxyResponse, ConnectProxyError> {
        let response = self.send_once(&request).await?;
        if response.status != 429 {
            return Ok(response);
        }
        // Production retries in the domain; a preview just waits once.
        tokio::time::sleep(response.retry_after.unwrap_or(Duration::from_secs(5))).await;
        self.send_once(&request).await
    }
}
