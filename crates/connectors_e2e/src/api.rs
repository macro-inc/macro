//! Macro's public HTTP API on dev, as one test account: the gateway, with
//! the account's user API key, the way an SDK client reaches it.

use std::time::Duration;

use macro_service_urls::{AgentHarnessServiceUrl, DocumentCognitionServiceUrl};
use reqwest::header::{HeaderMap, HeaderValue};
use reqwest::{Method, StatusCode};
use rootcause::prelude::*;
use serde::de::DeserializeOwned;
use serde_json::{Value, json};
use uuid::Uuid;

use crate::Report;
use crate::connector::{ConnectStep, Connector, app_key};

/// The header a user API key travels in (`crates/macro_auth` `credential.rs`).
const API_KEY_HEADER: &str = "x-macro-user-api-key";
/// Longest one request may take.
const REQUEST_TIMEOUT: Duration = Duration::from_secs(60);

/// Which of the two test accounts.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AccountKind {
    /// The `@macro.com` account, on the `macro-connect` rollout.
    Flagged,
    /// The account off the rollout.
    Unflagged,
}

/// One test account's view of the API.
#[derive(Clone)]
pub struct Account {
    kind: AccountKind,
    http: reqwest::Client,
    cognition: String,
    harness: String,
}

/// A failed call: what was asked, and what came back.
#[derive(Debug, thiserror::Error)]
#[error("{method} {path} answered {status}: {body}")]
pub struct ApiError {
    method: Method,
    path: String,
    status: StatusCode,
    body: String,
}

/// An answer, whatever its status.
#[derive(Debug, Clone)]
pub struct Response {
    /// Its status.
    pub status: StatusCode,
    /// Its body, as JSON, or as a string when it is not JSON.
    pub body: Value,
}

/// Which service a path is under.
#[derive(Debug, Clone, Copy)]
enum Service {
    /// The cognition server: `/connectors` and the imports.
    Cognition,
    /// The agent harness: agent sessions.
    Harness,
}

impl Account {
    /// The account whose user API key is `api_key`, on dev.
    pub fn new(kind: AccountKind, api_key: &str) -> Result<Self, Report> {
        let mut headers = HeaderMap::new();
        let mut key = HeaderValue::from_str(api_key)
            .context("the account's API key is not a valid header value")?;
        key.set_sensitive(true);
        headers.insert(API_KEY_HEADER, key);
        let http = reqwest::Client::builder()
            .default_headers(headers)
            .timeout(REQUEST_TIMEOUT)
            .build()
            .context("could not build the HTTP client")?;
        Ok(Self {
            kind,
            http,
            cognition: DocumentCognitionServiceUrl::dev().as_str().to_owned(),
            harness: AgentHarnessServiceUrl::dev().as_str().to_owned(),
        })
    }

    /// Which account this is.
    pub fn kind(&self) -> AccountKind {
        self.kind
    }

    async fn call(
        &self,
        service: Service,
        method: Method,
        path: &str,
        body: Option<Value>,
    ) -> Result<Response, Report> {
        let base = match service {
            Service::Cognition => &self.cognition,
            Service::Harness => &self.harness,
        };
        let mut request = self.http.request(method.clone(), format!("{base}{path}"));
        if let Some(body) = body {
            request = request.json(&body);
        }
        let response = request
            .send()
            .await
            .context(format!("{method} {path} did not answer"))?;
        let status = response.status();
        let text = response
            .text()
            .await
            .context(format!("{method} {path} answered an unreadable body"))?;
        let body = serde_json::from_str(&text).unwrap_or(Value::String(text));
        Ok(Response { status, body })
    }

    /// `call`, failing unless it answers `expected`.
    async fn expect(
        &self,
        service: Service,
        method: Method,
        path: &str,
        body: Option<Value>,
        expected: StatusCode,
    ) -> Result<Value, Report> {
        let response = self.call(service, method.clone(), path, body).await?;
        if response.status != expected {
            return Err(rootcause::Report::new(ApiError {
                method,
                path: path.to_owned(),
                status: response.status,
                body: response.body.to_string(),
            })
            .into_dynamic());
        }
        Ok(response.body)
    }

    /// `GET /connectors`, unread: what a check on the wire shape reads.
    pub async fn connectors_raw(&self) -> Result<Vec<Value>, Report> {
        let body = self
            .expect(
                Service::Cognition,
                Method::GET,
                "/connectors",
                None,
                StatusCode::OK,
            )
            .await?;
        decode(body, "GET /connectors")
    }

    /// `GET /connectors`: every app and server the account holds or can see.
    pub async fn connectors(&self) -> Result<Vec<Connector>, Report> {
        self.connectors_raw()
            .await?
            .into_iter()
            .map(|connector| decode(connector, "a connector"))
            .collect()
    }

    /// The connector `key`, if `GET /connectors` lists it.
    pub async fn connector(&self, key: &str) -> Result<Option<Connector>, Report> {
        Ok(self
            .connectors()
            .await?
            .into_iter()
            .find(|connector| connector.key == key))
    }

    /// The catalog app `slug`, if listed.
    pub async fn app(&self, slug: &str) -> Result<Option<Connector>, Report> {
        self.connector(&app_key(slug)).await
    }

    /// `GET /connectors/catalog?search=`: the catalog page's app keys.
    pub async fn catalog_keys(&self, search: &str) -> Result<Vec<String>, Report> {
        let path = format!("/connectors/catalog?search={search}&limit=20");
        let body = self
            .expect(Service::Cognition, Method::GET, &path, None, StatusCode::OK)
            .await?;
        let apps = body
            .get("apps")
            .and_then(Value::as_array)
            .ok_or_else(|| report!("{path} answered no apps: {body}"))?;
        Ok(apps
            .iter()
            .filter_map(|app| app.get("key").and_then(Value::as_str).map(str::to_owned))
            .collect())
    }

    /// `POST /connectors {url, name}`: add a server by URL.
    pub async fn add_server(&self, url: &str, name: &str) -> Result<Connector, Report> {
        let body = self
            .expect(
                Service::Cognition,
                Method::POST,
                "/connectors",
                Some(json!({ "url": url, "name": name })),
                StatusCode::CREATED,
            )
            .await?;
        decode(body, "POST /connectors")
    }

    /// `POST /connectors/{key}/connect`, whatever it answers.
    pub async fn start_connect_raw(&self, key: &str) -> Result<Response, Report> {
        self.call(
            Service::Cognition,
            Method::POST,
            &format!("/connectors/{key}/connect"),
            None,
        )
        .await
    }

    /// `POST /connectors/{key}/connect`: what to open to connect `key`.
    pub async fn start_connect(&self, key: &str) -> Result<ConnectStep, Report> {
        let path = format!("/connectors/{key}/connect");
        let body = self
            .expect(
                Service::Cognition,
                Method::POST,
                &path,
                None,
                StatusCode::OK,
            )
            .await?;
        decode(body, &path)
    }

    /// `POST /connectors/{key}/complete`: record a connection whose consent
    /// is already given.
    pub async fn complete_connect(&self, key: &str) -> Result<Connector, Report> {
        let path = format!("/connectors/{key}/complete");
        let body = self
            .expect(
                Service::Cognition,
                Method::POST,
                &path,
                None,
                StatusCode::OK,
            )
            .await?;
        decode(body, &path)
    }

    /// `PATCH /connectors/{key} {enabled}`.
    pub async fn set_enabled(&self, key: &str, enabled: bool) -> Result<(), Report> {
        self.expect(
            Service::Cognition,
            Method::PATCH,
            &format!("/connectors/{key}"),
            Some(json!({ "enabled": enabled })),
            StatusCode::NO_CONTENT,
        )
        .await
        .map(drop)
    }

    /// `PATCH /connectors/{key} {name}`.
    pub async fn rename(&self, key: &str, name: &str) -> Result<(), Report> {
        self.expect(
            Service::Cognition,
            Method::PATCH,
            &format!("/connectors/{key}"),
            Some(json!({ "name": name })),
            StatusCode::NO_CONTENT,
        )
        .await
        .map(drop)
    }

    /// `DELETE /connectors/{key}`, whatever it answers.
    pub async fn remove_raw(&self, key: &str) -> Result<Response, Report> {
        self.call(
            Service::Cognition,
            Method::DELETE,
            &format!("/connectors/{key}"),
            None,
        )
        .await
    }

    /// `DELETE /connectors/{key}`.
    pub async fn remove(&self, key: &str) -> Result<(), Report> {
        self.expect(
            Service::Cognition,
            Method::DELETE,
            &format!("/connectors/{key}"),
            None,
            StatusCode::NO_CONTENT,
        )
        .await
        .map(drop)
    }

    /// `POST /import/notion/pages {page}`: import one Notion page through the
    /// account's Notion connection, which calls Notion's API. Answers the
    /// outcome (`imported`, `already_imported`, …).
    pub async fn import_notion_page(&self, page: &str) -> Result<String, Report> {
        let body = self
            .expect(
                Service::Cognition,
                Method::POST,
                "/import/notion/pages",
                Some(json!({ "page": page })),
                StatusCode::OK,
            )
            .await?;
        body.get("outcome")
            .and_then(Value::as_str)
            .map(str::to_owned)
            .ok_or_else(|| report!("POST /import/notion/pages answered no outcome: {body}"))
    }

    /// `POST /agent-sessions {prompt}`: open a session of the default agent
    /// with `prompt` as its first turn. Answers its id.
    pub async fn open_session(&self, prompt: &str) -> Result<Uuid, Report> {
        let body = self
            .expect(
                Service::Harness,
                Method::POST,
                "/agent-sessions",
                Some(json!({ "prompt": prompt })),
                StatusCode::CREATED,
            )
            .await?;
        body.pointer("/session/id")
            .and_then(Value::as_str)
            .and_then(|id| Uuid::parse_str(id).ok())
            .ok_or_else(|| report!("POST /agent-sessions answered no session id: {body}"))
    }

    /// `GET /agent-sessions/{id}/log/folded`: the session's messages.
    pub async fn session_messages(&self, session: Uuid) -> Result<Vec<Value>, Report> {
        let path = format!("/agent-sessions/{session}/log/folded");
        let body = self
            .expect(Service::Harness, Method::GET, &path, None, StatusCode::OK)
            .await?;
        match body.get("messages") {
            Some(Value::Array(messages)) => Ok(messages.clone()),
            _ => bail!("{path} answered no messages: {body}"),
        }
    }

    /// `PUT /agent-sessions/{id}/archived {archived: true}`.
    pub async fn archive_session(&self, session: Uuid) -> Result<(), Report> {
        self.expect(
            Service::Harness,
            Method::PUT,
            &format!("/agent-sessions/{session}/archived"),
            Some(json!({ "archived": true })),
            StatusCode::NO_CONTENT,
        )
        .await
        .map(drop)
    }
}

fn decode<T: DeserializeOwned>(value: Value, what: &str) -> Result<T, Report> {
    let shown = value.to_string();
    Ok(serde_json::from_value(value)
        .context(format!("{what} answered an unexpected body: {shown}"))?)
}
