//! Authored channel references use the same entity mapping and deduplication as source.
use crate::{DocumentContext, Result, nodes::*};
use lexical_model::*;
use serde::{Deserialize, Serialize};
use serde_json::Value;
/// Entity kinds accepted in authored channel references.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize, Deserialize, strum::EnumString)]
#[serde(rename_all = "snake_case")]
#[strum(serialize_all = "snake_case")]
pub enum MessageReferenceKind {
    /// User principal.
    User,
    /// Bot principal.
    Bot,
    /// Stored document.
    Document,
    /// Form.
    Form,
    /// Database.
    Database,
    /// Channel.
    Channel,
    /// Email thread.
    Thread,
    /// Call.
    Call,
    /// Calendar event.
    CalendarEvent,
    /// Chat.
    Chat,
    /// Agent session.
    AgentSession,
    /// Project.
    Project,
    /// Static image.
    #[serde(rename = "static/image")]
    #[strum(serialize = "static/image")]
    StaticImage,
    /// Static video.
    #[serde(rename = "static/video")]
    #[strum(serialize = "static/video")]
    StaticVideo,
    /// Authored audience group.
    Group,
    /// Automation or routine.
    Automation,
    /// CRM company.
    CrmCompany,
    /// CRM contact.
    CrmContact,
    /// External chat.
    ExternalChat,
}
/// A reference preserved for server-side audience resolution and sharing.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MessageReference {
    /// Reference wire type.
    pub entity_type: MessageReferenceKind,
    /// Entity identifier verbatim.
    pub entity_id: String,
}
/// Normalize accepted reference aliases and reject kinds that channels do not share.
pub fn message_reference(kind: &str, id: &str) -> Option<MessageReference> {
    let kind = match kind {
        "email" | "email_thread" => "thread",
        "routine" => "automation",
        "user" if id.starts_with("bot|") => "bot",
        kind => kind,
    };
    Some(MessageReference {
        entity_type: kind.parse().ok()?,
        entity_id: id.into(),
    })
}

fn document_kind(block: &str) -> &str {
    match block {
        "channel" | "project" | "chat" | "call" | "automation" | "form" | "database"
        | "external_chat" => block,
        "routine" => "automation",
        "email" => "thread",
        "calendar" => "calendar_event",
        "company" => "crm_company",
        "contact" => "crm_contact",
        "initiative" => "initiative",
        "pipeline" => "crm_pipeline",
        _ => "document",
    }
}
fn view_forms(widgets: &Value, ids: &mut Vec<String>) -> Result<()> {
    let widgets = widgets
        .as_array()
        .ok_or_else(|| crate::Error::InvalidArgument("view widgets must be an array".into()))?;
    for widget in widgets {
        match widget.get("type").and_then(Value::as_str) {
            Some("cards") => {
                let items = widget
                    .get("items")
                    .and_then(Value::as_array)
                    .ok_or_else(|| {
                        crate::Error::InvalidArgument("view card items must be an array".into())
                    })?;
                {
                    for item in items {
                        if item.get("type").and_then(Value::as_str) == Some("form")
                            && let Some(id) = item.get("id").and_then(Value::as_str)
                        {
                            ids.push(id.into());
                        }
                    }
                }
            }
            Some("container") => {
                view_forms(widget.get("children").unwrap_or(&Value::Null), ids)?;
            }
            _ => {}
        }
    }
    Ok(())
}
/// Extract shareable references in document order, including forms presented in activity cards.
pub fn extract_channel_mentions(view: StateRef<'_>) -> Result<Vec<MessageReference>> {
    let mut result = Vec::new();
    let mut push = |kind: &str, id: &str| {
        if let Some(reference) =
            message_reference(kind, id).filter(|reference| !reference.entity_id.is_empty())
            && !result.contains(&reference)
        {
            result.push(reference);
        }
    };
    for record in lexical_rich_nodes::utils::dfs(view, None, None) {
        let key = record.node;
        if let Some(node) = view.get::<DocumentMentionNode>(key) {
            push(
                document_kind(node.block_name.as_deref().unwrap_or("")),
                node.document_id.as_deref().unwrap_or(""),
            );
        } else if let Some(node) = view.get::<DocumentCardNode>(key) {
            if matches!(node.block_name.as_deref(), Some("form" | "database")) {
                push(
                    document_kind(node.block_name.as_deref().unwrap_or("")),
                    node.document_id.as_deref().unwrap_or(""),
                );
            }
        } else if let Some(node) = view.get::<AgentActivityNode>(key) {
            if let Some(rows) = node.0.get("rows").and_then(Value::as_array) {
                for row in rows {
                    if let Some(card) = row.get("card").filter(|card| is_agent_activity_card(card))
                    {
                        let widgets = card
                            .get("view")
                            .and_then(|view| view.get("widgets"))
                            .unwrap_or(&Value::Null);
                        let mut ids = Vec::new();
                        view_forms(widgets, &mut ids)?;
                        for id in ids {
                            push("form", &id);
                        }
                    }
                }
            }
        } else if let Some(node) = view.get::<AgentSessionMentionNode>(key) {
            push("agent_session", node.id.as_deref().unwrap_or(""));
        } else if let Some(node) = view.get::<GroupMentionNode>(key) {
            push("group", node.group_alias.as_deref().unwrap_or(""));
        } else if let Some(node) = view.get::<UserMentionNode>(key) {
            let id = node.user_id.as_deref().unwrap_or("");
            push(
                if id.starts_with("bot|") {
                    "bot"
                } else {
                    "user"
                },
                id,
            );
        }
    }
    Ok(result)
}
/// Parse authored markdown before extracting references, respecting inert code and paste content.
pub fn extract_channel_mentions_from_markdown(
    markdown: &str,
    context: &DocumentContext,
) -> Result<Vec<MessageReference>> {
    let editor = crate::markdown::editor_from_markdown(markdown, context)?;
    extract_channel_mentions(editor.state().view())
}
/// Extract a leading explicit reply only when later root content carries authored text.
pub fn extract_explicit_reply(
    markdown: &str,
    context: &DocumentContext,
) -> Result<Option<ReplyTargetNode>> {
    let editor = crate::markdown::editor_from_markdown(markdown, context)?;
    let view = editor.state().view();
    let Some(first) = view.first_child(NodeKey::ROOT) else {
        return Ok(None);
    };
    let Some(reply) = view.get::<ReplyTargetNode>(first) else {
        return Ok(None);
    };
    let authored = view.next_siblings(first).any(|node| {
        !view.is::<ReplyTargetNode>(node) && !js_trim(&view.text_content(node)).is_empty()
    });
    Ok(authored.then(|| reply.clone()))
}
