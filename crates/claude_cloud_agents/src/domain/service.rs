//! Session orchestration: single-turn admission, replay, and bounded stream reconnect.
use super::{
    mcp::McpServers,
    model::{Error, Result, SessionId},
    models::{Catalog, Model},
    ports::{Cloud, DenyToolPermissions, ToolPermissions},
    translate::{Translator, Update},
};
use futures::StreamExt;
use serde_json::json;
use std::sync::Arc;
use tokio::sync::Mutex;

/// One owner-bound cloud conversation.
pub struct Session<C> {
    cloud: C,
    id: SessionId,
    turn: Mutex<()>,
    prompt_admission: Mutex<()>,
    cursor: Mutex<Option<u64>>,
    translator: Mutex<Translator>,
    model: Mutex<Model>,
    catalog: Mutex<Catalog>,
    account_catalog: Mutex<Catalog>,
    mcp_servers: Mutex<Option<McpServers>>,
}

#[cfg(test)]
mod test;

impl<C: Cloud> Session<C> {
    /// Construct around an already-persisted provider identity.
    pub fn new(cloud: C, id: SessionId) -> Arc<Self> {
        Self::with_model(cloud, id, Model::default())
    }
    /// Restore the model projected by Macro's acknowledged config responses.
    pub fn with_model(cloud: C, id: SessionId, model: Model) -> Arc<Self> {
        Arc::new(Self {
            cloud,
            id,
            turn: Mutex::new(()),
            prompt_admission: Mutex::new(()),
            cursor: Mutex::new(None),
            translator: Mutex::new(Translator::default()),
            model: Mutex::new(model),
            catalog: Mutex::new(Catalog::Unknown),
            account_catalog: Mutex::new(Catalog::Unknown),
            mcp_servers: Mutex::new(None),
        })
    }
    /// Saved preference for the next turn, not the worker's current running model.
    pub async fn model(&self) -> Model {
        self.model.lock().await.clone()
    }

    /// Current session aliases supplemented by the direct account catalog.
    pub async fn catalog(&self) -> Catalog {
        self.catalog
            .lock()
            .await
            .clone()
            .supplemented_by(self.account_catalog.lock().await.clone())
    }

    /// Read-only discovery; never starts a cloud worker merely to populate a picker.
    pub async fn refresh_catalog(&self) -> Result<()> {
        let history = self.cloud.history(&self.id).await?;
        let account = super::models::discover(&self.cloud).await?;
        *self.catalog.lock().await = Catalog::from_history(&history);
        *self.account_catalog.lock().await = account;
        Ok(())
    }

    async fn learn_catalog(
        &self,
        event: &super::model::Event,
        emit: impl Fn(Update) -> Result<()>,
    ) -> Result<()> {
        if let Some(next) = Catalog::from_event(event) {
            let mut catalog = self.catalog.lock().await;
            if *catalog != next {
                emit(Update::Models {
                    catalog: next
                        .clone()
                        .supplemented_by(self.account_catalog.lock().await.clone()),
                    current: self.model().await,
                })?;
                *catalog = next;
            }
        }
        Ok(())
    }

    /// Submit a preference without waiting for an idle worker to wake. The next
    /// prompt repeats it in the same ordered batch, like the desktop client.
    pub async fn set_model(&self, model: Model) -> Result<()> {
        let _admission = self.prompt_admission.try_lock().map_err(|_| Error::Busy)?;
        let _turn = self.turn.lock().await;
        self.refresh_catalog().await?;
        if !self.catalog().await.contains(&model) {
            return Err(Error::ModelUnavailable);
        }
        self.cloud
            .send(&self.id, model_request(model.clone()).1)
            .await?;
        *self.model.lock().await = model;
        Ok(())
    }

    /// Provider identity; also used as the ACP session identity.
    pub fn id(&self) -> &SessionId {
        &self.id
    }

    /// Retain the host's MCP configuration until the next user-requested turn.
    /// An empty restore preserves the cloud worker's existing configuration when
    /// the host no longer has the original plaintext egress token.
    pub async fn configure_mcp(&self, servers: McpServers) -> Result<()> {
        let _turn = self.turn.try_lock().map_err(|_| Error::Busy)?;
        if !servers.is_empty() {
            *self.mcp_servers.lock().await = Some(servers);
        }
        Ok(())
    }

    /// Replay durable transcript for Macro's normal ACP load flow.
    pub async fn load(&self) -> Result<Vec<Update>> {
        let _turn = self.turn.try_lock().map_err(|_| Error::Busy)?;
        let mut translator = Translator::default();
        let mut updates = Vec::new();
        let mut cursor = None;
        for event in self.cloud.history(&self.id).await? {
            if let Some(catalog) = Catalog::from_event(&event) {
                *self.catalog.lock().await = catalog;
            }
            updates.extend(translator.accept(&event, true)?);
            if let Some(seq) = event.sequence {
                cursor = Some(cursor.unwrap_or(0).max(seq));
            }
        }
        *self.cursor.lock().await = cursor;
        *self.translator.lock().await = translator;
        *self.account_catalog.lock().await = super::models::discover(&self.cloud).await?;
        Ok(updates)
    }

    /// Mirror cloud-side durable messages while idle. The turn gate prevents
    /// interleaving with Macro prompts; cursor and translator are shared with SSE.
    pub async fn sync_foreign(&self, emit: impl Fn(Update) -> Result<()> + Send) -> Result<()> {
        let Ok(_turn) = self.turn.try_lock() else {
            return Ok(());
        };
        let history = self.cloud.history(&self.id).await?;
        let mut cursor = self.cursor.lock().await;
        let mut translator = self.translator.lock().await;
        for event in history {
            let sequence = event.sequence.ok_or(Error::Recovery)?;
            if cursor.is_some_and(|last| sequence <= last) {
                continue;
            }
            // A malformed record must not enter the dedup set and disappear on
            // the next poll. Commit translation and cursor only after delivery.
            let mut next = translator.clone();
            self.learn_catalog(&event, &emit).await?;
            for update in next.accept(&event, true)? {
                emit(update)?;
            }
            *translator = next;
            *cursor = Some(sequence);
        }
        Ok(())
    }

    /// Run a single text prompt, opening the stream first and never retrying the send.
    pub async fn prompt(
        &self,
        text: String,
        emit: impl Fn(Update) -> Result<()> + Send,
    ) -> Result<()> {
        self.prompt_with_permissions(text, emit, &DenyToolPermissions)
            .await
    }

    /// Run a turn using the host's existing permission policy.
    pub async fn prompt_with_permissions(
        &self,
        text: String,
        emit: impl Fn(Update) -> Result<()> + Send,
        permissions: &impl ToolPermissions,
    ) -> Result<()> {
        // Wait behind a short idle poll, but never admit two Macro prompts.
        let _admission = self.prompt_admission.try_lock().map_err(|_| Error::Busy)?;
        let _turn = self.turn.lock().await;
        if text.trim().is_empty() {
            return Err(Error::Protocol);
        }
        let mut cursor = *self.cursor.lock().await;
        // An interrupted Macro process does not stop the cloud worker. Do not
        // attribute a previous/out-of-band turn's output to this new prompt.
        let history = self.cloud.history(&self.id).await?;
        if let Some(event) = history
            .iter()
            .rev()
            .find(|event| Catalog::from_event(event).is_some())
        {
            self.learn_catalog(event, &emit).await?;
        }
        let mut pending = std::collections::BTreeSet::new();
        for event in &history {
            let payload = &event.data["payload"];
            let content = &payload["message"]["content"];
            if payload["type"] == "user"
                && (content.is_string()
                    || content
                        .as_array()
                        .is_some_and(|blocks| blocks.iter().any(|block| block["type"] == "text")))
                && let Some(id) = payload["uuid"].as_str()
            {
                pending.insert(id);
            }
            if payload["type"] == "result" {
                if let Some(id) = payload["user_message_uuid"].as_str() {
                    pending.remove(id);
                }
                for id in payload["user_message_uuids"]
                    .as_array()
                    .into_iter()
                    .flatten()
                    .filter_map(|id| id.as_str())
                {
                    pending.remove(id);
                }
            }
        }
        if !pending.is_empty() {
            return Err(Error::Busy);
        }
        if !self.catalog().await.contains(&self.model().await) {
            self.refresh_catalog().await?;
            if !self.catalog().await.contains(&self.model().await) {
                return Err(Error::ModelUnavailable);
            }
        }
        let mut translator = self.translator.lock().await;
        // Catch completed foreign turns even if a prompt beats the next poll.
        for event in &history {
            let seq = event.sequence.ok_or(Error::Recovery)?;
            if cursor.is_some_and(|last| seq <= last) {
                continue;
            }
            for update in translator.accept(event, true)? {
                emit(update)?;
            }
            cursor = Some(seq);
            *self.cursor.lock().await = cursor;
        }
        let mut stream = self.cloud.stream(&self.id, cursor).await?;
        let mcp_request = self.mcp_servers.lock().await.as_ref().map(|servers| {
            let id = uuid::Uuid::now_v7().to_string();
            let request = json!({"type":"control_request", "request_id":id,
                "request":{"subtype":"mcp_set_servers", "servers":servers}});
            (id, request)
        });
        let mcp_request_id = mcp_request.as_ref().map(|(id, _)| id.clone());
        let mut mcp_ready = mcp_request_id.is_none();
        let message_id = uuid::Uuid::now_v7().to_string();
        let (model_request_id, model_event) = model_request(self.model().await);
        let mut batch = Vec::new();
        if matches!(Catalog::from_history(&history), Catalog::Unknown) {
            // Ask the worker for its catalog as part of the user's first turn,
            // never by creating or waking a session during settings discovery.
            batch.push(json!({"type":"control_request","request_id":uuid::Uuid::now_v7().to_string(),"request":{"subtype":"initialize"}}));
        }
        // An idle cloud worker wakes for the user event. Configure its tools in
        // the same ordered batch before that event, as with the model choice.
        if let Some((_, request)) = mcp_request {
            batch.push(request);
        }
        batch.push(model_event);
        batch.push(
            json!({"type":"user", "uuid":message_id, "session_id":self.id.as_str(),
            "parent_tool_use_id":null, "message":{"role":"user","content":text}}),
        );
        self.cloud.send_batch(&self.id, batch).await?;
        let mut retries = 0u8;
        let deadline = tokio::time::Instant::now() + std::time::Duration::from_secs(600);
        loop {
            let event = tokio::time::timeout_at(deadline, stream.next())
                .await
                .map_err(|_| Error::Network)?;
            match event {
                Some(Ok(event)) => {
                    if event.kind == "client_event"
                        && event
                            .sequence
                            .is_some_and(|seq| cursor.is_some_and(|last| seq <= last))
                    {
                        continue;
                    }
                    let payload = &event.data["payload"];
                    self.learn_catalog(&event, &emit).await?;
                    if payload["type"] == "control_response"
                        && mcp_request_id.as_deref().is_some_and(|id| {
                            payload["response"]["request_id"].as_str() == Some(id)
                        })
                    {
                        let response = &payload["response"];
                        if response["subtype"] != "success"
                            || !response["response"]["errors"]
                                .as_object()
                                .is_some_and(|errors| errors.is_empty())
                        {
                            let _ = self.cancel().await;
                            return Err(Error::McpConfiguration);
                        }
                        mcp_ready = true;
                    }
                    if payload["type"] == "control_response"
                        && payload["response"]["request_id"].as_str() == Some(&model_request_id)
                        && payload["response"]["subtype"] == "error"
                    {
                        // The batch is accepted already; best-effort interrupt
                        // avoids knowingly continuing with a rejected preference.
                        let _ = self.cancel().await;
                        return Err(Error::ModelUnavailable);
                    }
                    if payload["type"] == "control_request"
                        && payload["request"]["subtype"] == "can_use_tool"
                    {
                        let request = &payload["request"];
                        let allowed = mcp_ready
                            && permissions
                                .allow(
                                    request["tool_use_id"].as_str().ok_or(Error::Protocol)?,
                                    request["tool_name"].as_str().ok_or(Error::Protocol)?,
                                    &request["input"],
                                )
                                .await?;
                        let decision = if allowed {
                            json!({"behavior":"allow", "updatedInput":request["input"]})
                        } else {
                            json!({"behavior":"deny", "message":"Tool use was declined by the session host"})
                        };
                        self.cloud
                            .send(
                                &self.id,
                                json!({"type":"control_response", "response":{
                                    "subtype":"success", "request_id":payload["request_id"],
                                    "response":decision
                                }}),
                            )
                            .await?;
                    }
                    let own_result = payload["type"] == "result"
                        && (payload["user_message_uuid"].as_str() == Some(&message_id)
                            || payload["user_message_uuids"].as_array().is_some_and(|ids| {
                                ids.iter().any(|id| id.as_str() == Some(&message_id))
                            }));
                    if own_result && !mcp_ready {
                        let _ = self.cancel().await;
                        return Err(Error::McpConfiguration);
                    }
                    for update in translator.accept(&event, false)? {
                        if matches!(update, Update::Finished { .. }) && !own_result {
                            continue;
                        }
                        emit(update)?;
                    }
                    if event.kind == "client_event"
                        && let Some(seq) = event.sequence
                    {
                        cursor = Some(seq);
                        *self.cursor.lock().await = cursor;
                    }
                    if own_result {
                        return Ok(());
                    }
                }
                Some(Err(error @ (Error::Authorization | Error::Protocol | Error::Recovery))) => {
                    return Err(error);
                }
                Some(Err(_)) | None => {
                    if retries >= 3 {
                        return Err(Error::Network);
                    }
                    retries += 1;
                    tokio::time::sleep(std::time::Duration::from_secs(u64::from(retries))).await;
                    stream = self.cloud.stream(&self.id, cursor).await?;
                }
            }
        }
    }

    /// Ask the cloud worker to interrupt; closing SSE alone would not stop it.
    pub async fn cancel(&self) -> Result<()> {
        self.cloud.send(&self.id, json!({"type":"control_request", "request_id":format!("interrupt-{}",uuid::Uuid::now_v7()), "request":{"subtype":"interrupt"}})).await
    }
}

fn model_request(model: Model) -> (String, serde_json::Value) {
    let id = uuid::Uuid::now_v7().to_string();
    let payload = json!({"type":"control_request","request_id":id,
        "request":{"subtype":"set_model","model":model.provider_value()}});
    (id, payload)
}
