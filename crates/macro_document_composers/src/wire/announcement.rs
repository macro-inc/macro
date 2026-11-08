//! Current announcement endpoint shapes and source union normalization.
use super::*;
use macro_document_model::nodes::*;
/// Reply target accepts the deployed channel alias as well as the current parent.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnouncementReplyTarget {
    /// Current parent entity.
    #[serde(default, deserialize_with = "super::non_null_option")]
    pub parent: Option<ReplyTargetParent>,
    /// Historic channel parent.
    #[serde(default, deserialize_with = "super::non_null_option")]
    pub channel_id: Option<String>,
    /// Referenced message.
    pub target_message_id: String,
    /// Referenced discussion.
    pub target_thread_id: String,
    /// Authored preview.
    pub display_text: String,
    /// Referenced sender.
    pub sender_id: String,
}
/// Required live-session chip fields at the endpoint boundary.
#[derive(Clone, Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AnnouncementChip {
    /// Agent session identifier.
    pub agent_session_id: String,
    /// Optional containing channel.
    #[serde(default, deserialize_with = "super::non_null_option")]
    pub channel_id: Option<String>,
    /// Turn and author are required on current requests.
    pub prompted_message: MagicChipMessage,
    /// Current process status.
    pub status: MagicChipStatus,
}
/// Validated source union, in schema order rather than unvalidated-key precedence.
#[derive(Clone, Debug)]
pub enum AgentAnnouncementRequest {
    /// Account connection prompt.
    ConnectionPrompt(crate::AgentConnectionPrompt),
    /// Chat reply.
    ChatReply(crate::AgentChatReply),
    /// Session announcement.
    SessionAnnouncement {
        /// Optional message reference.
        reply_target: Option<AnnouncementReplyTarget>,
        /// Required process chip.
        chip: AnnouncementChip,
    },
}
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Session {
    #[serde(default, deserialize_with = "super::non_null_option")]
    reply_target: Option<AnnouncementReplyTarget>,
    chip: AnnouncementChip,
}
fn invalid() -> Error {
    Error::InvalidArgument("invalid announcement request".into())
}
fn required_string<'a>(input: &'a Value, key: &str) -> Result<&'a str> {
    input.get(key).and_then(Value::as_str).ok_or_else(invalid)
}
fn session(input: &Value) -> Result<AgentAnnouncementRequest> {
    let session: Session = serde_json::from_value(input.clone())?;
    if let Some(target) = &session.reply_target {
        if target.parent.is_none() && target.channel_id.is_none() {
            return Err(invalid());
        }
        if target
            .parent
            .as_ref()
            .is_some_and(|parent| parent.id.is_empty())
        {
            return Err(invalid());
        }
    }
    Ok(AgentAnnouncementRequest::SessionAnnouncement {
        reply_target: session.reply_target,
        chip: session.chip,
    })
}
fn chat(input: &Value) -> Result<AgentAnnouncementRequest> {
    let value = input.get("chatReply").ok_or_else(invalid)?;
    if value.get("link").is_some_and(Value::is_null) {
        return Err(invalid());
    }
    let mut reply: crate::AgentChatReply = serde_json::from_value(value.clone())?;
    if reply.session_id.is_empty() {
        return Err(invalid());
    }
    if let crate::AgentChatReplyBody::Segments { segments, .. } = &mut reply.body {
        for segment in segments {
            if let crate::AgentReplySegment::Activity { rows, .. } = segment {
                for row in rows {
                    required_string(row, "id")?;
                    required_string(row, "label")?;
                    if !row.get("status").is_some_and(is_agent_activity_status)
                        || row
                            .get("detail")
                            .is_some_and(|value| !value.is_null() && !value.is_string())
                    {
                        return Err(invalid());
                    }
                    let card = row
                        .get("card")
                        .filter(|card| {
                            card.get("kind").and_then(Value::as_str) == Some("view")
                                && card
                                    .get("view")
                                    .is_some_and(|view| view.is_object() || view.is_array())
                        })
                        .map(|card| serde_json::json!({"kind":"view","view":card.get("view")}));
                    let row = row.as_object_mut().ok_or_else(invalid)?;
                    row.shift_remove("card");
                    if let Some(card) = card {
                        row.insert("card".into(), card);
                    }
                }
            }
        }
    }
    Ok(AgentAnnouncementRequest::ChatReply(reply))
}
fn connection(input: &Value) -> Result<AgentAnnouncementRequest> {
    let value = input.get("connectionPrompt").ok_or_else(invalid)?;
    if ["agentTag", "message"]
        .iter()
        .any(|key| required_string(value, key).map_or(true, str::is_empty))
    {
        return Err(invalid());
    }
    let chip = value.get("chip").ok_or_else(invalid)?;
    if required_string(chip, "name")?.is_empty() {
        return Err(invalid());
    }
    let slug = required_string(chip, "appSlug")?;
    if slug.is_empty()
        || !slug.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'_' | b'-')
        })
    {
        return Err(invalid());
    }
    Ok(AgentAnnouncementRequest::ConnectionPrompt(
        serde_json::from_value(value.clone())?,
    ))
}
/// Apply source schema order, strip unknown properties and normalize legacy parents.
pub fn agent_announcement_from_json(input: &Value) -> Result<AgentAnnouncementRequest> {
    session(input)
        .or_else(|_| chat(input))
        .or_else(|_| connection(input))
}
/// Render a validated endpoint request using the ordinary typed composers.
pub fn handle_agent_announcement(
    input: &Value,
    context: &DocumentContext,
) -> Result<MarkdownResponse> {
    let markdown = match agent_announcement_from_json(input)? {
        AgentAnnouncementRequest::ConnectionPrompt(prompt) => {
            crate::compose_agent_connection_prompt(&prompt, context)?
        }
        AgentAnnouncementRequest::ChatReply(reply) => {
            crate::compose_agent_chat_reply(&reply, context)?
        }
        AgentAnnouncementRequest::SessionAnnouncement { reply_target, chip } => {
            let reply_target = reply_target.and_then(|target| {
                let parent = target.parent.or_else(|| {
                    target
                        .channel_id
                        .filter(|id| !id.is_empty())
                        .map(|id| ReplyTargetParent {
                            kind: ReplyTargetParentType::Channel,
                            id,
                        })
                });
                parent.map(|parent| ReplyTargetNode {
                    parent,
                    target_message_id: target.target_message_id,
                    target_thread_id: target.target_thread_id,
                    display_text: target.display_text,
                    sender_id: target.sender_id,
                })
            });
            let chip = MagicChipNode {
                agent_session_id: Maybe::Value(chip.agent_session_id),
                channel_id: chip.channel_id.map(Some),
                prompted_message: Some(Some(chip.prompted_message)),
                status: Maybe::Value(chip.status),
            };
            crate::compose_agent_session_announcement(
                &crate::AgentSessionAnnouncement { reply_target, chip },
                context,
            )?
        }
    };
    Ok(MarkdownResponse { markdown })
}
