//! Nonblocking tool presentations share the session actor's fenced log writer.
use super::*;
use crate::domain::model::SessionToolPresentation;
use agent_client_protocol::schema::v1::{
    SessionNotification, SessionUpdate, ToolCall, ToolCallStatus, ToolCallUpdate,
    ToolCallUpdateFields,
};

impl<R, Folds, Rt, Namer> AgentSessionServiceImpl<R, Folds, Rt, Namer>
where
    R: AgentSessionRepo + AgentSessionLogRepo + SessionOwnership + Clone,
    Folds: FoldedMessageRepo + Clone + Send + Sync + 'static,
    Rt: AgentSessionRealtime + Clone + Send + Sync + 'static,
    Namer: AgentSessionNameGenerator + Clone,
{
    pub(super) async fn present_to_actor(
        &self,
        id: AgentSessionId,
        actor: MacroUserIdStr<'static>,
        presentation: SessionToolPresentation,
    ) -> Result<()> {
        let session = self.repo.get(id).await?;
        if !session.owner_id.is_user(&actor) {
            return Err(AgentSessionError::Forbidden);
        }
        if session.is_archived {
            return Err(AgentSessionError::Archived(id));
        }
        if presentation.tool_call_id.is_empty()
            || presentation.tool_call_id.len() > 256
            || presentation.title.is_empty()
            || presentation.title.len() > 256
            || serde_json::to_vec(&presentation)
                .map_err(anyhow::Error::from)?
                .len()
                > 256 * 1024
        {
            return Err(AgentSessionError::Unknown(anyhow::anyhow!(
                "invalid tool presentation"
            )));
        }
        let commands = self
            .active
            .get(&id)
            .and_then(|entry| entry.commands.clone())
            .ok_or(AgentSessionError::Disconnected(id))?;
        let (completed, result) = oneshot::channel();
        commands
            .send(SessionMessage::PresentTool {
                presentation,
                completed,
            })
            .await
            .map_err(|_| AgentSessionError::Disconnected(id))?;
        drop(commands);
        tokio::time::timeout(HANDSHAKE_TIMEOUT, result)
            .await
            .map_err(|_| AgentSessionError::DeliveryTimedOut(id))?
            .map_err(|_| AgentSessionError::Disconnected(id))?
    }
}

impl<R, Rt> LiveSessionLogWriter<R, Rt>
where
    R: AgentSessionRepo + AgentSessionLogRepo + Clone,
    Rt: AgentSessionRealtime + Send + Sync + 'static,
{
    pub(super) async fn persist_presentation(
        &mut self,
        id: AgentSessionId,
        acp_id: SessionId,
        presentation: SessionToolPresentation,
    ) -> Result<()> {
        // Include buffered frames in the durable dedup check; a failed flush must
        // never produce an acknowledgment or cause a second writer to take over.
        self.flush().await?;
        let entries = AgentSessionLogRepo::list_by_session(&self.repo, id).await?;
        let (started, completed) = presentation_progress(entries, &presentation)?;
        if !started {
            self.append(presentation_frame(
                id,
                acp_id.clone(),
                SessionUpdate::ToolCall(
                    ToolCall::new(presentation.tool_call_id.clone(), presentation.title)
                        .status(ToolCallStatus::InProgress)
                        .raw_input(presentation.raw_input),
                ),
            )?)
            .await?;
        }
        if !completed {
            self.append(presentation_frame(
                id,
                acp_id,
                SessionUpdate::ToolCallUpdate(ToolCallUpdate::new(
                    presentation.tool_call_id,
                    ToolCallUpdateFields::new()
                        .status(ToolCallStatus::Completed)
                        .raw_output(presentation.raw_output),
                )),
            )?)
            .await?;
        }
        self.flush().await
    }
}

pub(super) fn presentation_frame(
    id: AgentSessionId,
    acp_id: SessionId,
    update: SessionUpdate,
) -> Result<AgentSessionLog> {
    let raw = serde_json::from_value(serde_json::json!({
        "jsonrpc": "2.0", "method": "session/update",
        "params": SessionNotification::new(acp_id, update),
    }))
    .map_err(anyhow::Error::from)?;
    Ok(AgentSessionLog {
        logged_at: None,
        agent_session_id: id,
        user_id: None,
        content: Message::ToServer(ToServerMessage::Acp(AcpMessage(raw))),
    })
}

/// Match both durable frames; an interrupted pair is still pending.
pub(super) fn presentation_progress(
    entries: Vec<StoredAgentSessionLog>,
    presentation: &SessionToolPresentation,
) -> Result<(bool, bool)> {
    let mut started = false;
    let mut completed = false;
    for entry in entries {
        let Message::ToServer(ToServerMessage::Acp(AcpMessage(RawJsonRpcMessage::Notification(
            notification,
        )))) = entry.entry.content
        else {
            continue;
        };
        if notification.method.as_ref() != "session/update" {
            continue;
        }
        let Some(params) = notification.params else {
            continue;
        };
        let Ok(notification) = serde_json::from_value::<SessionNotification>(params.into_value())
        else {
            continue;
        };
        match notification.update {
            SessionUpdate::ToolCall(call)
                if call.tool_call_id.0.as_ref() == presentation.tool_call_id =>
            {
                if call.title != presentation.title
                    || call.raw_input.as_ref() != Some(&presentation.raw_input)
                {
                    return Err(AgentSessionError::Unknown(anyhow::anyhow!(
                        "tool presentation identity already used"
                    )));
                }
                started = true;
            }
            SessionUpdate::ToolCallUpdate(update)
                if update.tool_call_id.0.as_ref() == presentation.tool_call_id =>
            {
                if update.fields.status == Some(ToolCallStatus::Completed) {
                    if update.fields.raw_output.as_ref() != Some(&presentation.raw_output) {
                        return Err(AgentSessionError::Unknown(anyhow::anyhow!(
                            "tool presentation identity already used"
                        )));
                    }
                    completed = true;
                }
            }
            _ => {}
        }
    }
    Ok((started, completed))
}
