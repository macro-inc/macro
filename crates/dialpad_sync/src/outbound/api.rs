//! Dialpad's REST API, called with the user's token from Macro Connect.
use crate::domain::{
    models::*,
    ports::{Dialpad, Result},
};
use async_trait::async_trait;
use chrono::{DateTime, Utc};
use reqwest::{Method, StatusCode};
use serde::Deserialize;
use serde_json::{Value, json};

/// Production Dialpad. Its sandbox is a separate account system.
pub const DIALPAD_API: &str = "https://dialpad.com/api/v2";

/// [`Dialpad`] over its REST API.
pub struct DialpadApi {
    http: reqwest::Client,
    base_url: String,
}

/// A transcript Dialpad cannot serve now (an outage, a rate limit, an
/// unreadable reply): the call imports without it.
fn transcript_unavailable(error: rootcause::Report) -> Option<Vec<TranscriptLine>> {
    tracing::warn!(error = ?error, "importing a Dialpad call without its transcript");
    None
}

/// The id of a resource Dialpad returned.
#[derive(Deserialize)]
struct Id {
    id: DialpadId,
}

/// Dialpad's answer, whatever its status. Never log the body: it carries call
/// details and, for webhook registration, the signing secret.
struct Reply {
    status: StatusCode,
    body: Value,
}

impl DialpadApi {
    /// A client for the API at `base_url`.
    pub fn new(base_url: impl Into<String>) -> Result<Self> {
        let http = reqwest::Client::builder()
            .connect_timeout(std::time::Duration::from_secs(10))
            .timeout(std::time::Duration::from_secs(30))
            .build()?;
        Ok(Self {
            http,
            base_url: base_url.into(),
        })
    }

    async fn send(
        &self,
        token: &AccessToken,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<Value>,
    ) -> Result<Reply> {
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        let mut request = self
            .http
            .request(method, format!("{}{path}", self.base_url))
            .bearer_auth(token.0.as_str())
            .headers(headers)
            .query(query);
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request.send().await?;
        let status = response.status();
        let text = response.text().await?;
        let body = if text.trim().is_empty() {
            Value::Null
        } else {
            serde_json::from_str(&text).unwrap_or(Value::Null)
        };
        Ok(Reply { status, body })
    }

    /// The body on success, `None` when the resource does not exist.
    async fn request(
        &self,
        token: &AccessToken,
        method: Method,
        path: &str,
        query: &[(&str, String)],
        body: Option<Value>,
    ) -> Result<Option<Value>> {
        let reply = self.send(token, method, path, query, body).await?;
        match reply.status {
            status if status.is_success() => Ok(Some(reply.body)),
            StatusCode::NOT_FOUND => Ok(None),
            StatusCode::UNAUTHORIZED => {
                Err(rootcause::report!("Dialpad rejected the access token"))
            }
            status => Err(rootcause::report!("Dialpad API returned HTTP {status}")),
        }
    }

    async fn created_id(&self, token: &AccessToken, path: &str, body: Value) -> Result<DialpadId> {
        let body = self
            .request(token, Method::POST, path, &[], Some(body))
            .await?
            .ok_or_else(|| rootcause::report!("Dialpad has no {path} endpoint for this account"))?;
        Ok(serde_json::from_value::<Id>(body)?.id)
    }

    /// Gone already, or no longer this token's to delete (403), is success.
    async fn delete(&self, token: &AccessToken, path: &str) -> Result<()> {
        let reply = self.send(token, Method::DELETE, path, &[], None).await?;
        match reply.status {
            status if status.is_success() => Ok(()),
            StatusCode::NOT_FOUND | StatusCode::FORBIDDEN => Ok(()),
            StatusCode::UNAUTHORIZED => {
                Err(rootcause::report!("Dialpad rejected the access token"))
            }
            status => Err(rootcause::report!("Dialpad API returned HTTP {status}")),
        }
    }
}

#[async_trait]
impl Dialpad for DialpadApi {
    #[tracing::instrument(name = "dialpad.users_me", skip_all, err(Display))]
    async fn me(&self, token: &AccessToken) -> Result<DialpadId> {
        let body = self
            .request(token, Method::GET, "/users/me", &[], None)
            .await?
            .ok_or_else(|| rootcause::report!("Dialpad did not return the connected user"))?;
        Ok(serde_json::from_value::<Id>(body)?.id)
    }

    #[tracing::instrument(name = "dialpad.create_webhook", skip_all, err(Display))]
    async fn create_webhook(
        &self,
        token: &AccessToken,
        url: &str,
        secret: &SigningSecret,
    ) -> Result<DialpadId> {
        self.created_id(
            token,
            "/webhooks",
            json!({ "hook_url": url, "secret": secret.0 }),
        )
        .await
    }

    #[tracing::instrument(name = "dialpad.subscribe", skip_all, err(Display))]
    async fn subscribe(
        &self,
        token: &AccessToken,
        webhook: DialpadId,
        user: DialpadId,
    ) -> Result<DialpadId> {
        let states: Vec<&str> = CallState::SUBSCRIBED.iter().map(AsRef::as_ref).collect();
        self.created_id(
            token,
            "/subscriptions/call",
            json!({
                "endpoint_id": webhook,
                "call_states": states,
                "enabled": true,
                "target_type": "user",
                "target_id": user,
            }),
        )
        .await
    }

    #[tracing::instrument(name = "dialpad.unregister", skip_all, err(Display))]
    async fn unregister(&self, token: &AccessToken, registration: Registration) -> Result<()> {
        self.delete(
            token,
            &format!("/subscriptions/call/{}", registration.subscription_id),
        )
        .await?;
        self.delete_webhook(token, registration.webhook_id).await
    }

    #[tracing::instrument(name = "dialpad.delete_webhook", skip_all, err(Display))]
    async fn delete_webhook(&self, token: &AccessToken, webhook: DialpadId) -> Result<()> {
        self.delete(token, &format!("/webhooks/{webhook}")).await
    }

    #[tracing::instrument(name = "dialpad.fetch_transcript", skip_all, err(Display))]
    async fn transcript(
        &self,
        token: &AccessToken,
        call: DialpadId,
    ) -> Result<Option<Vec<TranscriptLine>>> {
        #[derive(Deserialize)]
        struct Transcript {
            #[serde(default)]
            lines: Vec<TranscriptLine>,
        }
        let reply = match self
            .send(
                token,
                Method::GET,
                &format!("/transcripts/{call}"),
                &[],
                None,
            )
            .await
        {
            Ok(reply) => reply,
            Err(error) => return Ok(transcript_unavailable(error)),
        };
        match reply.status {
            StatusCode::UNAUTHORIZED => {
                Err(rootcause::report!("Dialpad rejected the access token"))
            }
            // No transcript, or transcripts are off for the company (as for recaps).
            StatusCode::NOT_FOUND | StatusCode::FORBIDDEN => Ok(None),
            status if status.is_success() => {
                match serde_json::from_value::<Transcript>(reply.body) {
                    Ok(transcript) => Ok(Some(transcript.lines)),
                    Err(error) => Ok(transcript_unavailable(error.into())),
                }
            }
            status => Ok(transcript_unavailable(rootcause::report!(
                "Dialpad API returned HTTP {status}"
            ))),
        }
    }

    #[tracing::instrument(name = "dialpad.fetch_recap", skip_all, err(Display))]
    async fn recap(&self, token: &AccessToken, call: DialpadId) -> Result<Option<Recap>> {
        #[derive(Deserialize)]
        struct Item {
            content: Option<String>,
        }
        #[derive(Deserialize)]
        struct Summary {
            content: Option<String>,
            #[serde(default)]
            null_summary: bool,
        }
        #[derive(Deserialize)]
        struct AiRecap {
            summary: Option<Summary>,
            #[serde(default)]
            action_items: Vec<Item>,
        }
        let reply = self
            .send(
                token,
                Method::GET,
                &format!("/call/{call}/ai_recap"),
                &[],
                None,
            )
            .await?;
        // No recap, or AI recaps are off for the company: import without one.
        if matches!(reply.status, StatusCode::NOT_FOUND | StatusCode::FORBIDDEN) {
            return Ok(None);
        }
        if !reply.status.is_success() {
            return Err(rootcause::report!(
                "Dialpad API returned HTTP {}",
                reply.status
            ));
        }
        let recap: AiRecap = serde_json::from_value(reply.body)?;
        Ok(Some(Recap {
            summary: recap
                .summary
                .filter(|summary| !summary.null_summary)
                .and_then(|summary| summary.content),
            action_items: recap
                .action_items
                .into_iter()
                .filter_map(|item| item.content)
                .collect(),
        }))
    }

    #[tracing::instrument(name = "dialpad.list_calls", skip_all, err(Display))]
    async fn calls(
        &self,
        token: &AccessToken,
        user: DialpadId,
        since: DateTime<Utc>,
        cursor: Option<&str>,
    ) -> Result<CallPage> {
        #[derive(Deserialize)]
        struct Page {
            #[serde(default)]
            items: Vec<Value>,
            cursor: Option<String>,
        }
        // Without a target, an admin's token lists the whole company's calls.
        let mut query = vec![
            ("started_after", since.timestamp_millis().to_string()),
            ("target_type", "user".to_owned()),
            ("target_id", user.to_string()),
        ];
        if let Some(cursor) = cursor {
            query.push(("cursor", cursor.to_owned()));
        }
        let body = self
            .request(token, Method::GET, "/call", &query, None)
            .await?
            .ok_or_else(|| rootcause::report!("Dialpad call listing is unavailable"))?;
        let page: Page = serde_json::from_value(body)?;
        // One unreadable call must not hold up the rest of the page.
        let calls = page
            .items
            .into_iter()
            .filter_map(|item| {
                let call_id = item
                    .get("call_id")
                    .and_then(|id| DialpadId::deserialize(id).ok());
                CallEvent::decode(item)
                    .inspect_err(|path| {
                        tracing::warn!(
                            call_id = ?call_id,
                            path = %path,
                            "skipped a past Dialpad call that could not be read"
                        );
                    })
                    .ok()
            })
            .collect();
        Ok(CallPage {
            calls,
            cursor: page.cursor.filter(|cursor| !cursor.is_empty()),
        })
    }
}

#[cfg(test)]
mod test;
