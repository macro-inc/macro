//! Versioned mTLS RPC. Only normalized bounded values cross the process boundary.
use crate::domain::{
    linked::{models::*, ports::Sessions},
    models::MessagingError,
    ports::PortResult,
};
use crate::outbound::repository::failure;
use async_trait::async_trait;
use serde::{Serialize, de::DeserializeOwned};
use uuid::Uuid;

/// Dedicated client identity and CA authenticate both ends of each session RPC.
#[derive(Clone)]
pub struct HttpSessions {
    http: reqwest::Client,
    base: url::Url,
}
impl HttpSessions {
    /// Require TLS, client authentication and bounded requests; never accept redirects.
    pub fn new(
        base: url::Url,
        identity: reqwest::Identity,
        ca: reqwest::Certificate,
    ) -> PortResult<Self> {
        if base.scheme() != "https" || base.query().is_some() || base.fragment().is_some() {
            return Err(MessagingError::ConfigurationRequired.into());
        }
        let http = reqwest::Client::builder()
            .identity(identity)
            .add_root_certificate(ca)
            .timeout(std::time::Duration::from_secs(60))
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(failure)?;
        Ok(Self { http, base })
    }
    fn request(
        &self,
        scope: &SessionScope,
        method: reqwest::Method,
        path: &str,
    ) -> PortResult<reqwest::RequestBuilder> {
        let url = self
            .base
            .join(&format!("v1/accounts/{}/{path}", scope.account_id))
            .map_err(failure)?;
        let mut headers = reqwest::header::HeaderMap::new();
        macro_tower_layers::inject_trace_headers(&mut headers);
        Ok(self
            .http
            .request(method, url)
            .headers(headers)
            .header("X-Authorization-Generation", scope.authorization_generation)
            .header("X-Owner-Epoch", scope.owner_epoch))
    }
    /// Internal JSON request; response capacity is bounded before deserialization.
    #[tracing::instrument(skip_all,fields(account_id=%scope.account_id,owner_epoch=scope.owner_epoch))]
    pub async fn json<T: DeserializeOwned>(
        &self,
        scope: &SessionScope,
        method: reqwest::Method,
        path: &str,
        body: Option<&impl Serialize>,
    ) -> PortResult<T> {
        let mut request = self.request(scope, method, path)?;
        if let Some(body) = body {
            request = request.json(body);
        }
        let mut response = request
            .send()
            .await
            .map_err(|_| MessagingError::Unavailable)?;
        if !response.status().is_success() {
            return Err(MessagingError::Unavailable.into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| MessagingError::Unavailable)?
        {
            if bytes.len() + chunk.len() > 4 * 1024 * 1024 {
                return Err(MessagingError::Unavailable.into());
            }
            bytes.extend_from_slice(&chunk);
        }
        serde_json::from_slice(&bytes).map_err(failure)
    }
    /// Private authorized outgoing media. No public staging URL is created.
    pub async fn upload(
        &self,
        scope: &SessionScope,
        group: &str,
        id: Uuid,
        bytes: Vec<u8>,
    ) -> PortResult<()> {
        let response = self
            .request(scope, reqwest::Method::PUT, &format!("media/{id}"))?
            .header("X-Group-Jid", group)
            .body(bytes)
            .send()
            .await
            .map_err(|_| MessagingError::Unavailable)?;
        if !response.status().is_success() {
            return Err(MessagingError::Unavailable.into());
        }
        Ok(())
    }
    /// Fetch only a journaled adopted-group media reservation, with a byte ceiling.
    pub async fn download(
        &self,
        scope: &SessionScope,
        group: &str,
        id: &str,
    ) -> PortResult<Vec<u8>> {
        if id.len() != 64 || !id.bytes().all(|b| b.is_ascii_hexdigit()) {
            return Err(MessagingError::Invalid("invalid media reference").into());
        }
        let mut response = self
            .request(scope, reqwest::Method::POST, &format!("media/{id}"))?
            .json(&serde_json::json!({"groupJid":group}))
            .send()
            .await
            .map_err(|_| MessagingError::Unavailable)?;
        if !response.status().is_success() {
            return Err(MessagingError::Unavailable.into());
        }
        let mut bytes = Vec::new();
        while let Some(chunk) = response
            .chunk()
            .await
            .map_err(|_| MessagingError::Unavailable)?
        {
            if bytes.len() + chunk.len() > 32 * 1024 * 1024 {
                return Err(MessagingError::Invalid("attachment exceeds supported limit").into());
            }
            bytes.extend_from_slice(&chunk);
        }
        Ok(bytes)
    }
}
#[async_trait]
impl Sessions for HttpSessions {
    async fn start(&self, a: &Account, p: Option<&Pairing>) -> PortResult<SessionScope> {
        let scope = SessionScope {
            account_id: a.id,
            authorization_generation: a.authorization_generation,
            owner_epoch: a.owner_epoch.unwrap_or(0),
        };
        self.json(&scope,reqwest::Method::POST,"start",Some(&serde_json::json!({"userId":a.user_id,"authorizationGeneration":a.authorization_generation,"pairingId":p.map(|p|p.id.to_string()).unwrap_or_default(),"expiresAt":p.map(|p|p.expires_at).unwrap_or_else(chrono::Utc::now)}))).await
    }
    async fn pair_state(&self, s: &SessionScope, id: Uuid) -> PortResult<PairState> {
        self.json(s, reqwest::Method::GET, &format!("pair/{id}"), None::<&()>)
            .await
    }
    async fn passkey(
        &self,
        s: &SessionScope,
        id: Uuid,
        response: &serde_json::Value,
    ) -> PortResult<()> {
        let _: serde_json::Value = self
            .json(
                s,
                reqwest::Method::POST,
                &format!("pair/{id}/passkey"),
                Some(response),
            )
            .await?;
        Ok(())
    }
    async fn confirm(&self, s: &SessionScope, id: Uuid) -> PortResult<()> {
        let _: serde_json::Value = self
            .json(
                s,
                reqwest::Method::POST,
                &format!("pair/{id}/confirm"),
                Some(&()),
            )
            .await?;
        Ok(())
    }
    async fn groups(&self, s: &SessionScope) -> PortResult<Vec<GroupInfo>> {
        self.json(s, reqwest::Method::GET, "groups", None::<&()>)
            .await
    }
    async fn group(&self, s: &SessionScope, group: &str) -> PortResult<GroupInfo> {
        self.json(
            s,
            reqwest::Method::POST,
            "group",
            Some(&serde_json::json!({"jid":group})),
        )
        .await
    }
    async fn allowlist(&self, s: &SessionScope, bindings: &[ObservationGrant]) -> PortResult<()> {
        let mut groups = std::collections::BTreeMap::new();
        for b in bindings {
            groups
                .entry(&b.binding.group_jid)
                .and_modify(|start: &mut chrono::DateTime<chrono::Utc>| {
                    *start = (*start).min(b.starts_at)
                })
                .or_insert(b.starts_at);
        }
        let _: serde_json::Value = self
            .json(s, reqwest::Method::POST, "allowlist", Some(&groups))
            .await?;
        Ok(())
    }
    async fn outcome(
        &self,
        a: &Account,
        generation: i64,
        command: Uuid,
    ) -> PortResult<TransportOutcome> {
        let scope = SessionScope {
            account_id: a.id,
            authorization_generation: a.authorization_generation,
            owner_epoch: a.owner_epoch.unwrap_or(0),
        };
        self.json(
            &scope,
            reqwest::Method::GET,
            &format!("outcomes/{generation}/{command}"),
            None::<&()>,
        )
        .await
    }
    async fn stop(&self, s: &SessionScope, unlink: bool) -> PortResult<bool> {
        let result: serde_json::Value = self
            .json(
                s,
                reqwest::Method::POST,
                "stop",
                Some(&serde_json::json!({"unlink":unlink})),
            )
            .await?;
        Ok(result
            .get("remoteUnlinkConfirmed")
            .and_then(serde_json::Value::as_bool)
            .unwrap_or(false))
    }
    async fn events(&self, s: &SessionScope) -> PortResult<Vec<Event>> {
        self.json(s, reqwest::Method::GET, "events", None::<&()>)
            .await
    }
    async fn acknowledge(&self, s: &SessionScope, id: Uuid) -> PortResult<()> {
        let _: serde_json::Value = self
            .json(
                s,
                reqwest::Method::DELETE,
                &format!("events/{id}"),
                None::<&()>,
            )
            .await?;
        Ok(())
    }
}
