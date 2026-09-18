use super::LexicalClient;
use crate::types::{CognitionResponseData, CognitionV2ResponseData};
use messages::domain::models::MessageParent;

use crate::types::MarkdownParseResult;
use agent_fold::domain::model::MessageId;
use anyhow::{Context, Result};
use serde::de::DeserializeOwned;

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct LexicalResponseItem {
    node_id: String,
    content: String,
    raw_content: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct LexicalResponse {
    data: Vec<LexicalResponseItem>,
}

#[derive(Debug, serde::Serialize)]
struct MarkdownSnapshotRequest<'a> {
    markdown: &'a str,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct MarkdownResponse {
    data: String,
}

#[derive(Debug, serde::Serialize)]
struct MentionsRequest<'a> {
    markdown: &'a str,
}

#[derive(Debug, serde::Serialize)]
struct HtmlRequest<'a> {
    markdown: &'a str,
}

/// An email body rendered from markdown: the two parts a MIME message carries.
#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
pub struct RenderedBody {
    /// The HTML body, exported the way the draft composer exports it.
    pub html: String,
    /// The plain-text alternative.
    pub text: String,
}

#[derive(Debug, serde::Serialize)]
struct ExtractReplyRequest<'a> {
    markdown: &'a str,
}

/// The leading `ReplyTargetNode` extracted from markdown by the lexical
/// service `/extract-reply` endpoint, when the markdown is an explicit reply.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedExplicitReply {
    /// Entity containing the targeted message.
    pub parent: MessageParent,
    /// Targeted message.
    pub target_message_id: String,
    /// Thread containing the targeted message.
    pub target_thread_id: String,
    /// Static one-line preview rendered by the reply target.
    pub display_text: String,
    /// Sender of the targeted message — who the author replied to.
    pub sender_id: String,
}

/// Wire shape of an extracted reply target. Reply targets serialized before
/// message parents existed name only a `channelId`; both shapes decode.
#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtractedExplicitReplyWire {
    #[serde(default)]
    parent: Option<MessageParent>,
    #[serde(default)]
    channel_id: Option<String>,
    target_message_id: String,
    target_thread_id: String,
    display_text: String,
    sender_id: String,
}

impl<'de> serde::Deserialize<'de> for ExtractedExplicitReply {
    fn deserialize<D: serde::Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        let wire = ExtractedExplicitReplyWire::deserialize(deserializer)?;
        let parent = match (wire.parent, wire.channel_id) {
            (Some(parent), _) => parent,
            (None, Some(channel_id)) => MessageParent::parse("channel", &channel_id)
                .map_err(|_| serde::de::Error::custom("reply target channelId is not a uuid"))?,
            (None, None) => return Err(serde::de::Error::missing_field("parent")),
        };
        Ok(Self {
            parent,
            target_message_id: wire.target_message_id,
            target_thread_id: wire.target_thread_id,
            display_text: wire.display_text,
            sender_id: wire.sender_id,
        })
    }
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExtractReplyResponse {
    reply: Option<ExtractedExplicitReply>,
}

/// An entity mention extracted from markdown by the lexical service
/// `/mentions` endpoint, in the shape channel messages track them.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ExtractedMention {
    /// Mentioned entity type (e.g. `document`, `channel`, `user`).
    pub entity_type: String,
    /// Mentioned entity id.
    pub entity_id: String,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct MentionsResponse {
    mentions: Vec<ExtractedMention>,
}

/// The Magic Chip embedded in an agent-session announcement, in the shape the
/// lexical service `/agent-announcement` endpoint validates.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAnnouncementChip {
    /// Agent session the chip anchors.
    pub agent_session_id: String,
    /// Dedicated channel of the agent session, for chips old enough to
    /// predate sessions standing alone. New chips carry only the session.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    /// Folded user message that prompts the anchored agent response.
    pub prompted_message: MessageId,
    /// Persisted chip status (e.g. `booting`).
    pub status: String,
}

/// The message targeted by an agent-session announcement, in the shape the
/// lexical service's `ReplyTargetNode` validates.
#[derive(Debug, Clone, PartialEq, Eq, serde::Serialize, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentAnnouncementReplyTarget {
    /// Entity containing the targeted message.
    pub parent: MessageParent,
    /// Channel containing the targeted message, for channel parents. Sent
    /// beside `parent` for the reply-target shape that predates parents.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub channel_id: Option<String>,
    /// Targeted message.
    pub target_message_id: String,
    /// Thread containing the targeted message.
    pub target_thread_id: String,
    /// Static one-line preview rendered by the reply target.
    pub display_text: String,
    /// Sender of the targeted message.
    pub sender_id: String,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentAnnouncementRequest<'a> {
    reply_target: &'a AgentAnnouncementReplyTarget,
    chip: &'a AgentAnnouncementChip,
}

#[derive(Debug, Clone, serde::Serialize, serde::Deserialize)]
struct AgentAnnouncementResponse {
    markdown: String,
}

/// A channel message included as context for an agent prompt.
#[derive(Debug, Clone, Copy, PartialEq, Eq, serde::Serialize)]
pub struct AgentContextMessage<'a> {
    /// Display name of the message sender.
    pub sender: &'a str,
    /// Markdown content of the message.
    pub content: &'a str,
}

#[derive(Debug, serde::Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentContextRequest<'a> {
    prompt_markdown: &'a str,
    #[serde(skip_serializing_if = "Option::is_none")]
    parent: Option<&'a MessageParent>,
    #[serde(skip_serializing_if = "Option::is_none")]
    messages: Option<&'a [AgentContextMessage<'a>]>,
}

#[derive(Debug, Clone, serde::Deserialize)]
struct AgentContextResponse {
    markdown: String,
}

/// Rendering target supported by the lexical service `/markdown` endpoint.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum MarkdownTarget {
    /// Internal XML-tagged markdown (lossless round-trip format).
    Internal,
    /// GitHub-flavored markdown for external consumption.
    External,
    /// Compact embedding-friendly text: internal markdown with mentions
    /// reduced to display names plus the ids they reference. Used for task
    /// duplicate detection.
    Embedding,
}

impl MarkdownTarget {
    fn as_str(self) -> &'static str {
        match self {
            MarkdownTarget::Internal => "internal",
            MarkdownTarget::External => "external",
            MarkdownTarget::Embedding => "embedding",
        }
    }
}

/// Markdown rendered in the compact embedding format ([`MarkdownTarget::Embedding`]):
/// internal markdown with mentions reduced to display names plus their ids. This
/// is the only format the task-dedup embedder should ever see, so it is a newtype
/// rather than a bare `String` — the type is the guarantee.
///
/// There is deliberately no `From<String>`. Obtain one only from
/// [`LexicalClient::get_embedding_markdown`] (the authoritative backend render)
/// or [`EmbeddingMarkdown::from_client_trusted`] (when the frontend already
/// rendered it with lexical-core's `markdownToEmbeddingText`).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct EmbeddingMarkdown(String);

impl EmbeddingMarkdown {
    /// Wraps markdown the client rendered in embedding format itself (lexical-core
    /// `markdownToEmbeddingText`, the same output as the service's
    /// `target=embedding`). Named to make the trust boundary explicit wherever a
    /// caller vouches for client-supplied text instead of rendering it here.
    pub fn from_client_trusted(markdown: String) -> Self {
        Self(markdown)
    }

    /// An empty body, for tasks embedded by title alone (e.g. when the embedding
    /// render is unavailable and we degrade to title-only rather than embed
    /// wrong-format text).
    pub fn empty() -> Self {
        Self(String::new())
    }

    /// The underlying embedding-format text.
    pub fn as_str(&self) -> &str {
        &self.0
    }

    /// Consumes the wrapper, returning the owned text.
    pub fn into_string(self) -> String {
        self.0
    }
}

impl AsRef<str> for EmbeddingMarkdown {
    fn as_ref(&self) -> &str {
        &self.0
    }
}

impl From<LexicalResponseItem> for MarkdownParseResult {
    fn from(result: LexicalResponseItem) -> MarkdownParseResult {
        MarkdownParseResult {
            node_id: result.node_id,
            content: result.content,
            raw_content: result.raw_content,
        }
    }
}

async fn check_response(response: reqwest::Response) -> Result<reqwest::Response> {
    if response.status() == reqwest::StatusCode::OK {
        return Ok(response);
    }
    let status = response.status();
    let body = response.text().await?;
    tracing::error!(body=%body, status=%status, "unexpected response from lexical service");
    anyhow::bail!(body);
}

impl LexicalClient {
    #[tracing::instrument(skip(self), err)]
    pub async fn parse_markdown(&self, document_id: &str) -> Result<Vec<MarkdownParseResult>> {
        let url = format!("{}/search/{}", self.url, document_id);
        let response = check_response(self.client.get(&url).send().await?).await?;
        let data: LexicalResponse = response.json().await?;
        Ok(data.data.into_iter().map(Into::into).collect())
    }

    /// Fetches the full document rendered as a single markdown string in the
    /// requested target format.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_markdown(&self, document_id: &str, target: MarkdownTarget) -> Result<String> {
        let url = format!(
            "{}/markdown/{}?target={}",
            self.url,
            document_id,
            target.as_str()
        );
        let response: MarkdownResponse = self.get_json(&url).await?;
        Ok(response.data)
    }

    /// Fetches the document body rendered as [embedding-format markdown](EmbeddingMarkdown),
    /// typed so callers can only consume it as an [`EmbeddingMarkdown`]. Prefer
    /// this over [`get_markdown`](Self::get_markdown) with
    /// [`MarkdownTarget::Embedding`] anywhere the result feeds task-dedup.
    #[tracing::instrument(skip(self), err)]
    pub async fn get_embedding_markdown(&self, document_id: &str) -> Result<EmbeddingMarkdown> {
        let markdown = self
            .get_markdown(document_id, MarkdownTarget::Embedding)
            .await?;
        Ok(EmbeddingMarkdown(markdown))
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn parse_markdown_for_ai(&self, document_id: &str) -> Result<CognitionResponseData> {
        let url = format!("{}/cognition/{}", self.url, document_id);
        self.get_json(&url).await
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn parse_markdown_for_ai_from_url(
        &self,
        presigned_url: &str,
    ) -> Result<CognitionResponseData> {
        let url = format!("{}/cognition/presigned", self.url);
        let response = check_response(
            self.client
                .get(&url)
                .query(&[("url", presigned_url)])
                .send()
                .await?,
        )
        .await?;
        response.json().await.context("unexpected response")
    }

    #[tracing::instrument(skip(self), err)]
    pub async fn parse_cognition_v2(&self, document_id: &str) -> Result<CognitionV2ResponseData> {
        let url = format!("{}/cognitionv2/{}", self.url, document_id);
        self.get_json(&url).await
    }

    #[tracing::instrument(skip(self, markdown), err)]
    pub async fn markdown_to_loro_snapshot(&self, markdown: &str) -> Result<Vec<u8>> {
        let url = format!("{}/snapshot/markdown", self.url);
        let response = check_response(
            self.client
                .post(&url)
                .json(&MarkdownSnapshotRequest { markdown })
                .send()
                .await?,
        )
        .await?;

        let bytes = response.bytes().await?;
        Ok(bytes.to_vec())
    }

    /// Renders `markdown` to an email-ready HTML body via the lexical
    /// service, so a caller with no browser composer — the `SendEmail` tool,
    /// whose body the model writes as markdown — produces the same HTML the
    /// composer would have exported.
    #[tracing::instrument(skip(self, markdown), err)]
    pub async fn markdown_to_html(&self, markdown: &str) -> Result<RenderedBody> {
        let url = format!("{}/html", self.url);
        let response = check_response(
            self.client
                .post(&url)
                .json(&HtmlRequest { markdown })
                .send()
                .await?,
        )
        .await?;
        response.json().await.context("unexpected response")
    }

    /// Parses `markdown` via the lexical service and returns the entity
    /// mentions it contains.
    #[tracing::instrument(skip(self, markdown), err)]
    pub async fn extract_mentions(&self, markdown: &str) -> Result<Vec<ExtractedMention>> {
        let url = format!("{}/mentions", self.url);
        let response = check_response(
            self.client
                .post(&url)
                .json(&MentionsRequest { markdown })
                .send()
                .await?,
        )
        .await?;
        let data: MentionsResponse = response.json().await.context("unexpected response")?;
        Ok(data.mentions)
    }

    /// Composes the channel message announcing an agent session — a structured
    /// reply target above the session's Magic Chip — via the lexical service,
    /// so the markdown is built from real Lexical nodes.
    #[tracing::instrument(skip(self, reply_target, chip), err)]
    pub async fn compose_agent_announcement(
        &self,
        reply_target: &AgentAnnouncementReplyTarget,
        chip: &AgentAnnouncementChip,
    ) -> Result<String> {
        let url = format!("{}/agent-announcement", self.url);
        let response = check_response(
            self.client
                .post(&url)
                .json(&AgentAnnouncementRequest { reply_target, chip })
                .send()
                .await?,
        )
        .await?;
        let data: AgentAnnouncementResponse =
            response.json().await.context("unexpected response")?;
        Ok(data.markdown)
    }

    /// Sanitizes an agent prompt and optionally composes it with prior-message
    /// context via the lexical service, so internal nodes and escaping are
    /// handled by Lexical rather than assembled manually by the caller.
    #[tracing::instrument(skip(self, prompt_markdown, messages), err)]
    pub async fn compose_agent_context(
        &self,
        prompt_markdown: &str,
        parent: Option<&MessageParent>,
        messages: Option<&[AgentContextMessage<'_>]>,
    ) -> Result<String> {
        let url = format!("{}/agent-context", self.url);
        let response = check_response(
            self.client
                .post(&url)
                .json(&AgentContextRequest {
                    prompt_markdown,
                    parent,
                    messages,
                })
                .send()
                .await?,
        )
        .await?;
        let data: AgentContextResponse = response.json().await.context("unexpected response")?;
        Ok(data.markdown)
    }

    /// Parses `markdown` via the lexical service and returns the leading
    /// `ReplyTargetNode` when it is followed by the author's non-empty reply.
    /// Standard Markdown blockquotes carry no reply semantics.
    #[tracing::instrument(skip(self, markdown), err)]
    pub async fn extract_explicit_reply(
        &self,
        markdown: &str,
    ) -> Result<Option<ExtractedExplicitReply>> {
        let url = format!("{}/extract-reply", self.url);
        let response = check_response(
            self.client
                .post(&url)
                .json(&ExtractReplyRequest { markdown })
                .send()
                .await?,
        )
        .await?;
        let data: ExtractReplyResponse = response.json().await.context("unexpected response")?;
        Ok(data.reply)
    }

    async fn get_json<T: DeserializeOwned>(&self, url: &str) -> Result<T> {
        let response = check_response(self.client.get(url).send().await?).await?;
        response.json().await.context("unexpected response")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_lexical_response_to_markdown_results() {
        let json_data = r#"
        {
            "data": [
                {
                    "nodeId": "test-node-1",
                    "content": "Hello world",
                    "rawContent": "{\"type\":\"paragraph\",\"children\":[{\"text\":\"Hello world\"}]}"
                },
                {
                    "nodeId": "test-node-2",
                    "content": "Test content",
                    "rawContent": "{\"type\":\"paragraph\",\"children\":[{\"text\":\"Test content\"}]}"
                }
            ]
        }
        "#;

        let lexical_response: LexicalResponse = serde_json::from_str(json_data).unwrap();
        let results: Vec<MarkdownParseResult> = lexical_response
            .data
            .into_iter()
            .map(|item| item.into())
            .collect();

        assert_eq!(results.len(), 2);
        assert_eq!(results[0].node_id, "test-node-1");
        assert_eq!(results[0].content, "Hello world");
        assert_eq!(
            results[0].raw_content,
            "{\"type\":\"paragraph\",\"children\":[{\"text\":\"Hello world\"}]}"
        );
        assert_eq!(results[1].node_id, "test-node-2");
        assert_eq!(results[1].content, "Test content");
    }

    #[test]
    fn test_cognition_v2_deserialization() {
        use crate::types::{CognitionV2ResponseData, NewMdNode};

        let json_data = r##"
        {
            "data": [
                {
                    "type": "generic",
                    "nodeId": "abc123",
                    "content": "# Hello",
                    "tag": "heading"
                },
                {
                    "type": "staticImage",
                    "url": "https://example.com/image.png"
                },
                {
                    "type": "dssImage",
                    "id": "dss-image-456"
                },
                {
                    "type": "generic",
                    "nodeId": "def789",
                    "content": "Some paragraph text",
                    "tag": "paragraph"
                }
            ]
        }
        "##;

        let response: CognitionV2ResponseData = serde_json::from_str(json_data).unwrap();
        assert_eq!(response.data.len(), 4);

        match &response.data[0] {
            NewMdNode::Generic(node) => {
                assert_eq!(node.node_id, "abc123");
                assert_eq!(node.content, "# Hello");
                assert_eq!(node.tag, "heading");
            }
            _ => panic!("expected Generic node"),
        }

        match &response.data[1] {
            NewMdNode::StaticImage { url } => {
                assert_eq!(url, "https://example.com/image.png");
            }
            _ => panic!("expected StaticImage node"),
        }

        match &response.data[2] {
            NewMdNode::DssImage { id } => {
                assert_eq!(id, "dss-image-456");
            }
            _ => panic!("expected dssImage node"),
        }
    }

    #[test]
    fn extract_reply_response_deserializes_a_target() {
        let json = r#"{
            "reply": {
                "parent": {"type": "document", "id": "doc-1"},
                "targetMessageId": "message-1",
                "targetThreadId": "thread-1",
                "displayText": "please fix this",
                "senderId": "bot|00000000-0000-0000-0000-00000000b07a"
            }
        }"#;

        let response: ExtractReplyResponse = serde_json::from_str(json).unwrap();
        let reply = response.reply.expect("reply");
        assert_eq!(
            reply.parent,
            MessageParent::parse("document", "doc-1").unwrap()
        );
        assert_eq!(reply.target_message_id, "message-1");
        assert_eq!(reply.sender_id, "bot|00000000-0000-0000-0000-00000000b07a");
    }

    #[test]
    fn extract_reply_response_reads_a_channel_only_target_as_a_channel_parent() {
        let json = r#"{
            "reply": {
                "channelId": "00000000-0000-0000-0000-000000000001",
                "targetMessageId": "message-1",
                "targetThreadId": "thread-1",
                "displayText": "please fix this",
                "senderId": "macro|user@example.com"
            }
        }"#;

        let response: ExtractReplyResponse = serde_json::from_str(json).unwrap();
        let reply = response.reply.expect("reply");
        assert_eq!(
            reply.parent,
            MessageParent::parse("channel", "00000000-0000-0000-0000-000000000001").unwrap()
        );
    }

    #[test]
    fn announcement_reply_target_names_the_channel_beside_its_parent() {
        let target = AgentAnnouncementReplyTarget {
            parent: MessageParent::parse("channel", "00000000-0000-0000-0000-000000000001")
                .unwrap(),
            channel_id: Some("00000000-0000-0000-0000-000000000001".to_owned()),
            target_message_id: "message-1".to_owned(),
            target_thread_id: "thread-1".to_owned(),
            display_text: "please fix this".to_owned(),
            sender_id: "macro|user@example.com".to_owned(),
        };
        let value = serde_json::to_value(&target).unwrap();
        assert_eq!(value["parent"]["type"], "channel");
        assert_eq!(value["channelId"], "00000000-0000-0000-0000-000000000001");

        let document = AgentAnnouncementReplyTarget {
            parent: MessageParent::parse("document", "doc-1").unwrap(),
            channel_id: None,
            ..target
        };
        let value = serde_json::to_value(&document).unwrap();
        assert!(value.get("channelId").is_none());
        assert_eq!(value["parent"]["id"], "doc-1");
    }

    #[test]
    fn extract_reply_response_deserializes_null() {
        let response: ExtractReplyResponse = serde_json::from_str(r#"{ "reply": null }"#).unwrap();
        assert!(response.reply.is_none());
    }
}
