//! The experimentally verified OAuth API origin, not the cookie-authenticated web origin.
use crate::domain::{
    credentials::AccountCredentials,
    environment::gateway_network_patch,
    model::{Error, Event, Result, SessionId},
    ports::{Cloud, CloudLifecycle, CloudProvider, Events},
};
use futures::StreamExt;
use serde_json::{Value, json};
use std::collections::VecDeque;

const API: &str = "https://api.anthropic.com";
const BETA: &str = "ccr-byoc-2025-07-29";

/// HTTP client pinned to one Macro account and the official Anthropic origin.
#[derive(Clone)]
pub struct Client {
    credentials: AccountCredentials,
    owner: String,
    http: reqwest::Client,
}
impl Client {
    /// Resolve account allowlisting before attaching a runtime.
    pub async fn new(credentials: AccountCredentials, owner: String) -> Result<Self> {
        credentials.resolve(&owner).await?;
        let http = reqwest::Client::builder()
            .redirect(reqwest::redirect::Policy::none())
            .connect_timeout(std::time::Duration::from_secs(15))
            .build()
            .map_err(|_| Error::Network)?;
        Ok(Self {
            credentials,
            owner,
            http,
        })
    }

    async fn request(&self, path: &str, body: Option<Value>) -> Result<reqwest::Response> {
        let credentials = self.credentials.resolve(&self.owner).await?;
        let url = format!("{API}{path}");
        let request = match body {
            Some(body) => self.http.post(url).json(&body),
            None => self.http.get(url),
        };
        let response = request
            .bearer_auth(credentials.access_token.expose())
            .header("anthropic-version", "2023-06-01")
            .header("anthropic-beta", BETA)
            .header("anthropic-client-feature", "ccr")
            .header("x-organization-uuid", &credentials.organization_id)
            .header("anthropic-client-platform", "desktop_app")
            .header("anthropic-client-app", "com.anthropic.claudefordesktop")
            .header("anthropic-client-version", "1.24012.9")
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|_| Error::Network)?;
        checked(response)
    }

    async fn environment_request(&self, path: &str, body: Option<Value>) -> Result<Value> {
        let credentials = self.credentials.resolve(&self.owner).await?;
        let url = format!("{API}{path}");
        let request = match body {
            Some(body) => self.http.post(url).json(&body),
            None => self.http.get(url),
        };
        let response = request
            .bearer_auth(credentials.access_token.expose())
            .header("anthropic-version", "2023-06-01")
            .header(
                "anthropic-beta",
                "environments-2026-03-01,environments-package-support-2025-12-09",
            )
            .header("x-organization-uuid", &credentials.organization_id)
            .timeout(std::time::Duration::from_secs(30))
            .send()
            .await
            .map_err(|_| Error::Network)?;
        checked(response)?.json().await.map_err(|_| Error::Protocol)
    }

    async fn selected_environment(&self) -> Result<Value> {
        let credentials = self.credentials.resolve(&self.owner).await?;
        let environments = self.environment_request("/v1/environments", None).await?;
        environments["data"]
            .as_array()
            .and_then(|all| {
                all.iter().find(|e| {
                    e["id"].as_str() == Some(&credentials.environment_id)
                        && e["config"]["type"] == "cloud"
                        && e["state"] == "active"
                        && e["archived_at"].is_null()
                })
            })
            .cloned()
            .ok_or(Error::CloudEnvironment)
    }

    /// Create only in the explicitly selected, active Anthropic cloud environment.
    pub async fn create(&self, instructions: &str) -> Result<SessionId> {
        let environment = self.selected_environment().await?;
        let mut config = json!({"sources": [], "outcomes": []});
        if !instructions.is_empty() {
            config["append_system_prompt"] = json!(instructions);
        }
        let response = self
            .request(
                "/v1/code/sessions",
                Some(json!({
                    "title": "Macro Claude Cloud demo", "environment_id": environment["id"],
                    "config": config, "events": []
                })),
            )
            .await
            .map_err(|error| match error {
                Error::Network => Error::UncertainCreate,
                other => other,
            })?;
        let data: Value = response.json().await.map_err(|_| Error::UncertainCreate)?;
        SessionId::parse(
            data["session"]["id"]
                .as_str()
                .ok_or(Error::UncertainCreate)?,
        )
    }

    /// Reversible cleanup; never deletes the user's Claude transcript.
    pub async fn archive(&self, session: &SessionId) -> Result<()> {
        self.request(
            &format!("/v1/code/sessions/{}/archive", session.as_str()),
            Some(json!({})),
        )
        .await?;
        Ok(())
    }
}

/// Factory using the shared account credential service supplied by the host.
pub struct Provider(pub Option<AccountCredentials>);

impl CloudProvider for Provider {
    type Client = Client;

    async fn connect(&self, owner: &str) -> Result<Client> {
        Client::new(self.0.clone().ok_or(Error::NotConnected)?, owner.to_owned()).await
    }
}

impl CloudLifecycle for Client {
    async fn prepare_mcp_access(&self, host: &str) -> Result<()> {
        let environment = self.selected_environment().await?;
        let Some(networking) = gateway_network_patch(&environment["config"]["networking"], host)?
        else {
            return Ok(());
        };
        let id = environment["id"].as_str().ok_or(Error::Protocol)?;
        self.environment_request(
            &format!("/v1/environments/{id}"),
            Some(json!({"config":{"type":"cloud", "networking":networking}})),
        )
        .await?;
        // Do not launch a container if the provider failed to apply the policy.
        let updated = self.selected_environment().await?;
        if updated["id"] != environment["id"]
            || gateway_network_patch(&updated["config"]["networking"], host)?.is_some()
        {
            return Err(Error::EnvironmentNetwork);
        }
        Ok(())
    }

    async fn create(&self, instructions: &str) -> Result<SessionId> {
        Client::create(self, instructions).await
    }

    async fn archive(&self, session: &SessionId) -> Result<()> {
        Client::archive(self, session).await
    }
}

impl Cloud for Client {
    async fn recent_sessions(&self) -> Result<Vec<SessionId>> {
        let response: Value = self
            .request("/v1/code/sessions?limit=5", None)
            .await?
            .json()
            .await
            .map_err(|_| Error::Protocol)?;
        response["data"]
            .as_array()
            .ok_or(Error::Protocol)?
            .iter()
            .take(5)
            .map(|row| SessionId::parse(row["id"].as_str().ok_or(Error::Protocol)?))
            .collect()
    }
    async fn send_batch(&self, session: &SessionId, payloads: Vec<Value>) -> Result<()> {
        self.request(
            &format!("/v1/code/sessions/{}/events", session.as_str()),
            Some(event_batch(payloads)),
        )
        .await?;
        Ok(())
    }
    async fn send(&self, session: &SessionId, payload: Value) -> Result<()> {
        self.request(
            &format!("/v1/code/sessions/{}/events", session.as_str()),
            Some(json!({"events": [{"payload": payload}]})),
        )
        .await?;
        Ok(())
    }

    async fn history(&self, session: &SessionId) -> Result<Vec<Event>> {
        let mut events = Vec::new();
        let mut next = None::<String>;
        // Bound memory and requests; never silently treat a partial history as complete.
        for _ in 0..20 {
            let mut url = reqwest::Url::parse(&format!(
                "{API}/v1/code/sessions/{}/events",
                session.as_str()
            ))
            .map_err(|_| Error::Protocol)?;
            url.query_pairs_mut()
                .append_pair("limit", "500")
                .append_pair("sort_order", "asc");
            if let Some(cursor) = &next {
                url.query_pairs_mut().append_pair("cursor", cursor);
            }
            let path = format!("{}?{}", url.path(), url.query().unwrap_or_default());
            let response: Value = self
                .request(&path, None)
                .await?
                .json()
                .await
                .map_err(|_| Error::Protocol)?;
            for data in response["data"].as_array().ok_or(Error::Protocol)? {
                events.push(Event {
                    kind: "client_event".into(),
                    sequence: sequence(&data["sequence_num"]),
                    data: data.clone(),
                });
            }
            match response["next_cursor"].as_str().filter(|s| !s.is_empty()) {
                None => return Ok(events),
                Some(cursor) if next.as_deref() != Some(cursor) => next = Some(cursor.to_owned()),
                _ => return Err(Error::Recovery),
            }
        }
        Err(Error::Recovery)
    }

    async fn stream(&self, session: &SessionId, cursor: Option<u64>) -> Result<Events> {
        let credentials = self.credentials.resolve(&self.owner).await?;
        let mut request = self
            .http
            .get(format!(
                "{API}/v1/code/sessions/{}/events/stream",
                session.as_str()
            ))
            .bearer_auth(credentials.access_token.expose())
            .header("Accept", "text/event-stream")
            .header("anthropic-version", "2023-06-01")
            .header("anthropic-beta", BETA)
            .header("x-organization-uuid", &credentials.organization_id);
        if let Some(cursor) = cursor {
            request = request
                .query(&[("from_sequence_num", cursor)])
                .header("last-event-id", cursor.to_string());
        }
        let response = tokio::time::timeout(std::time::Duration::from_secs(30), request.send())
            .await
            .map_err(|_| Error::Network)?
            .map_err(|_| Error::Network)?;
        let response = checked(response)?;
        if !response
            .headers()
            .get("content-type")
            .and_then(|h| h.to_str().ok())
            .is_some_and(|s| s.starts_with("text/event-stream"))
        {
            return Err(Error::Protocol);
        }
        let state = (
            response.bytes_stream().boxed(),
            sse_core::SseDecoder::with_limit(
                std::num::NonZeroUsize::new(4 * 1024 * 1024).expect("nonzero payload bound"),
            ),
            VecDeque::new(),
        );
        Ok(
            futures::stream::try_unfold(
                state,
                |(mut bytes, mut decoder, mut pending)| async move {
                    loop {
                        if let Some(event) = pending.pop_front() {
                            return Ok(Some((event, (bytes, decoder, pending))));
                        }
                        match tokio::time::timeout(std::time::Duration::from_secs(45), bytes.next())
                            .await
                        {
                            Ok(Some(Ok(mut chunk))) => {
                                while let Some(record) = decoder.next(&mut chunk) {
                                    let sse_core::SseEvent::Message(message) =
                                        record.map_err(|_| Error::Protocol)?
                                    else {
                                        continue;
                                    };
                                    if message.data.is_empty() {
                                        continue;
                                    }
                                    let data: Value = serde_json::from_str(&message.data)
                                        .map_err(|_| Error::Protocol)?;
                                    let sequence = message
                                        .last_event_id
                                        .as_ref()
                                        .and_then(|s| s.parse().ok())
                                        .or_else(|| sequence(&data["sequence_num"]));
                                    pending.push_back(Event {
                                        kind: message.event.into_owned(),
                                        data,
                                        sequence,
                                    });
                                }
                            }
                            Ok(None) => return Ok(None),
                            _ => return Err(Error::Network),
                        }
                    }
                },
            )
            .boxed(),
        )
    }
}

fn checked(response: reqwest::Response) -> Result<reqwest::Response> {
    match response.status().as_u16() {
        200..=299 => Ok(response),
        401 | 403 => Err(Error::Authorization),
        410 => Err(Error::Recovery),
        status => Err(Error::Http(status)),
    }
}
fn sequence(value: &Value) -> Option<u64> {
    value.as_u64().or_else(|| value.as_str()?.parse().ok())
}

fn event_batch(payloads: Vec<Value>) -> Value {
    json!({"events": payloads.into_iter().map(|payload| json!({"payload":payload})).collect::<Vec<_>>()})
}

#[cfg(test)]
mod test;
