//! Composition of the native Macro tool capability and canonical session reviews.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};

use agent_client_protocol::RawJsonRpcMessage;
use agent_client_protocol::schema::v1::{
    CreateElicitationRequest, ElicitationFormMode, ElicitationSchema, ElicitationSessionScope,
    McpServer, SessionId, StringPropertySchema, ToolCallId,
};
use agent_inmem::domain::engine::AgentIdentity;
use agent_inmem::domain::mcp::{DynMcpToolConnector, dialable_servers};
use agent_inmem::domain::user_input::{
    UserInputError, UserInputOutcome, UserInputRequest, UserInputRequester,
};
use agent_inmem::voice_tools::{VoiceToolFactory, VoiceToolSessionOptions, VoiceTools};
use agent_runtime_protocol::domain::schema::v0::{AcpMessage, ToServerMessage};
use agent_session::domain::{model::AgentSessionId, service::AgentSessionService};
use agent_voice::domain::model::VoiceLease;
use ai_tools::user_tool_review::{ReviewError, ReviewOutcome, ReviewRequest, UserToolReviewer};
use anyhow::Context as _;
use serde_json::{Value, json};
use tokio::sync::{mpsc::UnboundedSender, oneshot};
use tokio_util::sync::CancellationToken;

use crate::voice_runtime::{WorkerToolFactory, WorkerToolSession};

/// Product services used by the authenticated runtime attachment.
pub struct ServiceVoiceToolFactory<Sessions> {
    sessions: Sessions,
    tools: VoiceToolFactory,
    mcp: Arc<dyn DynMcpToolConnector>,
}

impl<Sessions> ServiceVoiceToolFactory<Sessions> {
    /// Compose the same Macro tools and MCP connector used by the text runtime.
    pub fn new(
        sessions: Sessions,
        tools: VoiceToolFactory,
        mcp: Arc<dyn DynMcpToolConnector>,
    ) -> Self {
        Self {
            sessions,
            tools,
            mcp,
        }
    }
}

#[async_trait::async_trait]
impl<Sessions: AgentSessionService> WorkerToolFactory for ServiceVoiceToolFactory<Sessions> {
    async fn prepare(
        &self,
        lease: &VoiceLease,
        mcp_servers: Vec<McpServer>,
        updates: UnboundedSender<ToServerMessage>,
        lifetime: CancellationToken,
    ) -> anyhow::Result<Arc<dyn WorkerToolSession>> {
        let row = self
            .sessions
            .get_session(AgentSessionId::new_from_uuid(lease.session_id))
            .await?;
        let owner = row.owner_user()?.clone();
        let bot = self.sessions.session_bot(row.bot_id).await?;
        let reviews = Arc::new(VoiceReviewChannel {
            session_id: row
                .acp_session_id
                .unwrap_or_else(|| SessionId::new(lease.session_id.to_string())),
            updates,
            pending: Mutex::new(HashMap::new()),
            lifetime,
        });
        let tools = self
            .tools
            .prepare(VoiceToolSessionOptions {
                session_id: lease.session_id,
                owner,
                identity: Some(AgentIdentity {
                    name: bot.name,
                    handle: bot.handle,
                }),
                instructions: row.instructions,
                mcp_tools: self.mcp.connect_dyn(dialable_servers(mcp_servers)).await,
                user_input: Some(reviews.clone()),
                reviewer: reviews.clone(),
            })
            .await;
        Ok(Arc::new(ServiceVoiceTools {
            tools,
            reviews,
            usage: Mutex::new(HashMap::new()),
        }))
    }
}

struct ServiceVoiceTools {
    tools: VoiceTools,
    reviews: Arc<VoiceReviewChannel>,
    usage: Mutex<HashMap<String, (u64, u64)>>,
}

#[async_trait::async_trait]
impl WorkerToolSession for ServiceVoiceTools {
    fn configuration(&self) -> Value {
        json!({"instructions": self.tools.instructions, "tools": self.tools.definitions})
    }

    async fn call(
        &self,
        call_id: String,
        name: String,
        args: Value,
        cancel: CancellationToken,
        review_cancel: CancellationToken,
    ) -> anyhow::Result<Value> {
        Ok(serde_json::to_value(
            self.tools
                .call(&call_id, &name, &args, cancel, review_cancel)
                .await,
        )?)
    }

    fn handle_response(&self, frame: &RawJsonRpcMessage) -> bool {
        self.reviews.handle_response(frame)
    }

    async fn record_usage(&self, model: String, input_tokens: u64, output_tokens: u64) {
        let (input, output) = {
            let mut usage = self.usage.lock().expect("voice usage map poisoned");
            let previous = usage.entry(model.clone()).or_default();
            let delta = (
                input_tokens.saturating_sub(previous.0),
                output_tokens.saturating_sub(previous.1),
            );
            previous.0 = previous.0.max(input_tokens);
            previous.1 = previous.1.max(output_tokens);
            delta
        };
        if input != 0 || output != 0 {
            self.tools.record_usage(model, input, output);
        }
    }
}

/// Questions travel through the session actor, so its existing permission
/// controls authenticate the answer. A media packet or spoken answer cannot
/// complete this channel.
struct VoiceReviewChannel {
    session_id: SessionId,
    updates: UnboundedSender<ToServerMessage>,
    pending: Mutex<HashMap<String, oneshot::Sender<Value>>>,
    lifetime: CancellationToken,
}

struct PendingReview<'a> {
    id: &'a str,
    pending: &'a Mutex<HashMap<String, oneshot::Sender<Value>>>,
}

impl Drop for PendingReview<'_> {
    fn drop(&mut self) {
        self.pending
            .lock()
            .expect("voice review map poisoned")
            .remove(self.id);
    }
}

impl VoiceReviewChannel {
    async fn request(&self, request: CreateElicitationRequest) -> anyhow::Result<Value> {
        let id = format!("voice-review-{}", macro_uuid::generate_uuid_v7());
        let (send, receive) = oneshot::channel();
        self.pending
            .lock()
            .expect("voice review map poisoned")
            .insert(id.clone(), send);
        let _pending = PendingReview {
            id: &id,
            pending: &self.pending,
        };
        let frame = serde_json::from_value(json!({
            "jsonrpc": "2.0", "id": id, "method": "elicitation/create", "params": request,
        }))?;
        if self
            .updates
            .send(ToServerMessage::Acp(AcpMessage(frame)))
            .is_err()
        {
            self.pending
                .lock()
                .expect("voice review map poisoned")
                .remove(&id);
            anyhow::bail!("the voice runtime is disconnected");
        }
        let outcome = tokio::select! {
            _ = self.lifetime.cancelled() => Err(anyhow::anyhow!("the voice runtime ended")),
            result = receive => result.context("the voice review was cancelled"),
        };
        self.pending
            .lock()
            .expect("voice review map poisoned")
            .remove(&id);
        let response = outcome?;
        if response.get("error").is_some() {
            anyhow::bail!("the session could not present this question");
        }
        response
            .get("result")
            .cloned()
            .context("the session returned no answer")
    }

    fn handle_response(&self, frame: &RawJsonRpcMessage) -> bool {
        let Ok(value) = serde_json::to_value(frame) else {
            return false;
        };
        // Never let a notification/request masquerade as an answer.
        if value.get("method").is_some() {
            return false;
        }
        let Some(id) = value.get("id").and_then(Value::as_str) else {
            return false;
        };
        let Some(send) = self
            .pending
            .lock()
            .expect("voice review map poisoned")
            .remove(id)
        else {
            return false;
        };
        let _ = send.send(value);
        true
    }
}

#[async_trait::async_trait]
impl UserToolReviewer for VoiceReviewChannel {
    async fn review(&self, request: ReviewRequest) -> Result<ReviewOutcome, ReviewError> {
        let scope = ElicitationSessionScope::new(self.session_id.clone())
            .tool_call_id(ToolCallId::new(request.tool_call_id));
        let mut meta = serde_json::Map::new();
        meta.insert(
            "macro".to_owned(),
            json!({"userTool": {"name": request.tool_name, "draft": request.draft}}),
        );
        let response = self
            .request(
                CreateElicitationRequest::new(
                    ElicitationFormMode::new(
                        scope,
                        agent_inmem::domain::agent::review_form_schema(&request.form),
                    ),
                    request.message,
                )
                .meta(meta),
            )
            .await
            .map_err(|error| ReviewError::Unavailable(error.to_string()))?;
        match response.get("action").and_then(Value::as_str) {
            Some("accept") => Ok(ReviewOutcome::Accepted(
                response
                    .get("content")
                    .and_then(Value::as_object)
                    .cloned()
                    .unwrap_or_default()
                    .into_iter()
                    .collect(),
            )),
            Some("decline") => Ok(ReviewOutcome::Declined),
            Some("cancel") => Ok(ReviewOutcome::Cancelled),
            _ => Err(ReviewError::Failed(
                "the session returned an invalid review answer".to_owned(),
            )),
        }
    }
}

#[async_trait::async_trait]
impl UserInputRequester for VoiceReviewChannel {
    async fn ask(&self, request: UserInputRequest) -> Result<UserInputOutcome, UserInputError> {
        let mut field = StringPropertySchema::new().title("Answer");
        if !request.options.is_empty() {
            field = field.enum_values(request.options.clone());
        }
        let response = self
            .request(CreateElicitationRequest::new(
                ElicitationFormMode::new(
                    ElicitationSessionScope::new(self.session_id.clone()),
                    ElicitationSchema::new().property("answer", field, true),
                ),
                request.question,
            ))
            .await
            .map_err(|error| UserInputError::RequestFailed(error.to_string()))?;
        match response.get("action").and_then(Value::as_str) {
            Some("accept") => {
                let answer = response
                    .get("content")
                    .and_then(|content| content.get("answer"))
                    .and_then(Value::as_str)
                    .ok_or(UserInputError::MissingAnswer)?;
                if !request.options.is_empty()
                    && !request.options.iter().any(|option| option == answer)
                {
                    return Err(UserInputError::InvalidAnswer(
                        "the answer was not one of the offered options".to_owned(),
                    ));
                }
                Ok(UserInputOutcome::Answered(answer.to_owned()))
            }
            Some("decline") => Ok(UserInputOutcome::Declined),
            Some("cancel") => Ok(UserInputOutcome::Cancelled),
            _ => Err(UserInputError::RequestFailed(
                "the session returned an invalid answer".to_owned(),
            )),
        }
    }
}

#[cfg(test)]
mod test;
