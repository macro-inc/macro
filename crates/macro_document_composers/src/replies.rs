//! Agent chat chrome and announcements are composed from the real portable nodes.
use crate::{DocumentContext, Result, nodes::*};
use lexical_model::*;
use serde::{Deserialize, Serialize};
use serde_json::{Map, Value};
/// Text displayed by a pending reply placeholder.
pub const PENDING_REPLY_TEXT: &str = "Thinking…";
/// Link label shared by a chat agent's response states.
pub const AGENT_SESSION_LINK_LABEL: &str = "Agent session";
/// One authored reply passage or activity segment.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum AgentReplySegment {
    /// Prose is retained as authored Markdown.
    Prose {
        /// Authored Markdown.
        markdown: String,
    },
    /// Snapshot of work between prose passages.
    Activity {
        /// Turn index.
        turn: u64,
        /// Segment index.
        segment: u64,
        /// Row objects retain their future card fields.
        rows: Vec<Value>,
        /// Whether the segment can still gain work.
        sealed: bool,
    },
}
/// Body below the optional agent-session link.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum AgentChatReplyBody {
    /// Pending work placeholder.
    Pending,
    /// One prose passage.
    Markdown {
        /// Authored Markdown.
        markdown: String,
    },
    /// Interleaved prose and activity snapshots.
    Segments {
        /// Ordered reply passages.
        segments: Vec<AgentReplySegment>,
        /// Whether work is still running.
        #[serde(default)]
        pending: bool,
        /// Optional closing line.
        footer: Option<String>,
    },
}
/// One chat reply, with its optional session link.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentChatReply {
    /// Agent session identifier.
    pub session_id: String,
    /// Message body.
    pub body: AgentChatReplyBody,
    /// Whether to include the session link; absent means true.
    pub link: Option<bool>,
}
fn serialize(
    context: &DocumentContext,
    build: impl FnOnce(&mut Transaction<'_>) -> crate::ModelResult<()>,
) -> Result<String> {
    let mut editor = context.builder().build()?;
    editor.update(build)?;
    let transformers = crate::transformers::transformers("all", &context.markdown_options())?;
    crate::markdown::convert_to_markdown_string(
        editor.state(),
        &transformers,
        None,
        &lexical_markdown::MarkdownOptions {
            list_indent: 2,
            ..Default::default()
        },
    )
}
fn chrome(reply: &AgentChatReply, pending: bool, context: &DocumentContext) -> Result<String> {
    serialize(context, |tx| {
        if reply.link != Some(false) {
            let p = tx.create(Paragraph {})?;
            let mention = tx.create(AgentSessionMentionNode {
                id: Maybe::Value(reply.session_id.clone()),
                label: Maybe::Value(AGENT_SESSION_LINK_LABEL.into()),
                mention_uuid: Maybe::Missing,
                expanded: false,
            })?;
            tx.append(p, &[mention.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
        }
        if pending {
            let p = tx.create(Paragraph {})?;
            let await_node = tx.create(AwaitNode {
                await_id: Maybe::Value(crate::nanoid(tx, 21)?),
                text: Maybe::Value(PENDING_REPLY_TEXT.into()),
                inline: true,
            })?;
            tx.append(p, &[await_node.key()])?;
            tx.append(NodeKey::ROOT, &[p.key()])?;
        }
        Ok(())
    })
}
fn segment_markdown(
    session: &str,
    segment: &AgentReplySegment,
    context: &DocumentContext,
) -> Result<String> {
    match segment {
        AgentReplySegment::Prose { markdown } => Ok(markdown.clone()),
        AgentReplySegment::Activity {
            turn,
            segment,
            rows,
            sealed,
        } => serialize(context, |tx| {
            let mut data = Map::new();
            data.insert("agentSessionId".into(), session.into());
            data.insert("turn".into(), (*turn).into());
            data.insert("segment".into(), (*segment).into());
            let rows = rows
                .iter()
                .map(|row| {
                    let mut data = Map::new();
                    for key in ["id", "label", "status"] {
                        if let Some(value) = row.get(key) {
                            data.insert(key.into(), value.clone());
                        }
                    }
                    for key in ["detail", "card"] {
                        if let Some(value) = row.get(key).filter(|value| js_truthy(value)) {
                            data.insert(key.into(), value.clone());
                        }
                    }
                    Value::Object(data)
                })
                .collect();
            data.insert("rows".into(), Value::Array(rows));
            data.insert("sealed".into(), (*sealed).into());
            let activity = tx.create(AgentActivityNode(data))?;
            tx.append(NodeKey::ROOT, &[activity.key()])?;
            Ok(())
        }),
    }
}
/// Compose node-authored reply chrome while leaving prose unchanged.
pub fn compose_agent_chat_reply(
    reply: &AgentChatReply,
    context: &DocumentContext,
) -> Result<String> {
    match &reply.body {
        AgentChatReplyBody::Pending => chrome(reply, true, context),
        AgentChatReplyBody::Markdown { markdown } => {
            let head = chrome(reply, false, context)?;
            Ok([head, markdown.clone()]
                .into_iter()
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join("\n\n"))
        }
        AgentChatReplyBody::Segments {
            segments,
            pending,
            footer,
        } => {
            let mut parts = vec![chrome(reply, false, context)?];
            let working = matches!(
                segments.last(),
                Some(AgentReplySegment::Activity { sealed: false, .. })
            );
            let tail = if *pending && !working {
                let mut tail = reply.clone();
                tail.link = Some(false);
                Some(chrome(&tail, true, context)?)
            } else {
                None
            };
            for segment in segments {
                parts.push(segment_markdown(&reply.session_id, segment, context)?);
            }
            if let Some(footer) = footer.as_deref().filter(|text| !text.is_empty()) {
                parts.push(format!("_{footer}_"));
            }
            if let Some(tail) = tail {
                parts.push(tail);
            }
            Ok(parts
                .into_iter()
                .filter(|part| !js_trim(part).is_empty())
                .collect::<Vec<_>>()
                .join("\n\n"))
        }
    }
}
/// A session announcement links the triggering message and its live chip.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentSessionAnnouncement {
    /// Optional explicit reply target.
    pub reply_target: Option<ReplyTargetNode>,
    /// Live-session chip payload.
    pub chip: MagicChipNode,
}
/// Compose an announcement with a normalized single-line reply preview.
pub fn compose_agent_session_announcement(
    announcement: &AgentSessionAnnouncement,
    context: &DocumentContext,
) -> Result<String> {
    serialize(context, |tx| {
        if let Some(reply) = &announcement.reply_target {
            let mut reply = reply.clone();
            reply.display_text = strip_leading_reply_target_markdown(&reply.display_text)
                .split(is_js_whitespace)
                .filter(|part| !part.is_empty())
                .collect::<Vec<_>>()
                .join(" ");
            if !reply.display_text.is_empty() {
                let reply = tx.create(reply)?;
                tx.append(NodeKey::ROOT, &[reply.key()])?;
            }
        }
        let chip = tx.create(announcement.chip.clone())?;
        tx.append(NodeKey::ROOT, &[chip.key()])?;
        Ok(())
    })
}
/// Explanation of account setup required by one agent.
#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentConnectionPrompt {
    /// Agent tag displayed as inline code.
    pub agent_tag: String,
    /// Explanation text.
    pub message: String,
    /// Connection affordance.
    pub chip: ConnectAppNode,
}
/// Compose a connection reply from text and a real connection chip.
pub fn compose_agent_connection_prompt(
    prompt: &AgentConnectionPrompt,
    context: &DocumentContext,
) -> Result<String> {
    serialize(context, |tx| {
        let paragraph = tx.create(Paragraph {})?;
        let tag = tx.create_text(&prompt.agent_tag)?;
        tx.text(tag)?.set_format(TextFormat::CODE)?;
        let message = tx.create_text(&format!(" {} ", prompt.message))?;
        let chip = tx.create(prompt.chip.clone())?;
        tx.append(paragraph, &[tag.key(), message.key(), chip.key()])?;
        tx.append(NodeKey::ROOT, &[paragraph.key()])?;
        Ok(())
    })
}
