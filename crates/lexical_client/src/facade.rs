//! The public typed API, with one switching boundary for every operation.
use crate::notion::*;
use crate::parse_markdown::*;
use crate::types::*;
use crate::{
    HttpLexicalClient, RouteModes,
    routing::{Route, unavailable},
};
use anyhow::Result;
use serde::Serialize;
use std::future::Future;
use trigger_context::TriggerContext;

/// Selects HTTP, in-process or comparison-only execution per route group.
#[derive(Clone)]
pub struct LexicalClient {
    http: HttpLexicalClient,
    modes: RouteModes,
}
impl LexicalClient {
    /// Construct an explicit all-HTTP client, including for isolated tests.
    pub fn new(internal_auth_key: String, url: String) -> Self {
        Self {
            http: HttpLexicalClient::new(internal_auth_key, url),
            modes: RouteModes::default(),
        }
    }
    /// Load required route configuration once at a production composition root.
    pub fn from_env(internal_auth_key: String, url: String) -> Result<Self> {
        let config: crate::LexicalClientConfig = macro_config::ConfigLoader::load()?;
        Ok(Self::new(internal_auth_key, url).with_route_modes(config.lexical_route_modes))
    }
    /// Apply validated startup configuration without reading the environment.
    pub fn with_route_modes(mut self, modes: RouteModes) -> Self {
        self.modes = modes;
        self
    }
    async fn dispatch<T: Serialize>(
        &self,
        route: Route,
        document_id: Option<&str>,
        bytes_in: usize,
        http: impl Future<Output = Result<T>>,
        in_process: impl Future<Output = Result<T>>,
    ) -> Result<T> {
        crate::routing::dispatch(
            self.modes.mode(route.group()),
            route,
            document_id,
            bytes_in,
            http,
            in_process,
        )
        .await
    }
    /// Dispatch `parse_markdown` through its configured route group.
    pub async fn parse_markdown(&self, document_id: &str) -> Result<Vec<MarkdownParseResult>> {
        self.dispatch(
            Route::Search,
            Some(document_id),
            0,
            self.http.parse_markdown(document_id),
            unavailable("search"),
        )
        .await
    }
    /// Dispatch `get_markdown` through its configured route group.
    pub async fn get_markdown(&self, document_id: &str, target: MarkdownTarget) -> Result<String> {
        self.dispatch(
            Route::Markdown,
            Some(document_id),
            0,
            self.http.get_markdown(document_id, target),
            unavailable("markdown"),
        )
        .await
    }
    /// Dispatch `get_embedding_markdown` through its configured route group.
    pub async fn get_embedding_markdown(&self, document_id: &str) -> Result<EmbeddingMarkdown> {
        self.dispatch(
            Route::Markdown,
            Some(document_id),
            0,
            self.http.get_embedding_markdown(document_id),
            unavailable("markdown"),
        )
        .await
    }
    /// Dispatch `resolve_comment_mark` through its configured route group.
    pub async fn resolve_comment_mark(
        &self,
        document_id: &str,
        mark_id: &str,
    ) -> Result<Option<CommentMarkContext>> {
        self.dispatch(
            Route::CommentMark,
            Some(document_id),
            0,
            self.http.resolve_comment_mark(document_id, mark_id),
            unavailable("comment_mark"),
        )
        .await
    }
    /// Dispatch `parse_markdown_for_ai` through its configured route group.
    pub async fn parse_markdown_for_ai(&self, document_id: &str) -> Result<CognitionResponseData> {
        self.dispatch(
            Route::Cognition,
            Some(document_id),
            0,
            self.http.parse_markdown_for_ai(document_id),
            unavailable("cognition"),
        )
        .await
    }
    /// Dispatch `parse_markdown_for_ai_from_url` through its configured route group.
    pub async fn parse_markdown_for_ai_from_url(
        &self,
        presigned_url: &str,
    ) -> Result<CognitionResponseData> {
        self.dispatch(
            Route::CognitionPresigned,
            None,
            0,
            self.http.parse_markdown_for_ai_from_url(presigned_url),
            unavailable("cognition_presigned"),
        )
        .await
    }
    /// Dispatch `parse_cognition_v2` through its configured route group.
    pub async fn parse_cognition_v2(&self, document_id: &str) -> Result<CognitionV2ResponseData> {
        self.dispatch(
            Route::Cognitionv2,
            Some(document_id),
            0,
            self.http.parse_cognition_v2(document_id),
            unavailable("cognitionv2"),
        )
        .await
    }
    /// Dispatch `markdown_to_loro_snapshot` through its configured route group.
    pub async fn markdown_to_loro_snapshot(&self, markdown: &str) -> Result<Vec<u8>> {
        self.dispatch(
            Route::SnapshotMarkdown,
            None,
            serde_json::to_vec(&MarkdownSnapshotRequest { markdown })?.len(),
            self.http.markdown_to_loro_snapshot(markdown),
            unavailable("snapshot_markdown"),
        )
        .await
    }
    /// Dispatch `markdown_to_html` through its configured route group.
    pub async fn markdown_to_html(&self, markdown: &str) -> Result<RenderedBody> {
        self.dispatch(
            Route::Html,
            None,
            serde_json::to_vec(&HtmlRequest { markdown })?.len(),
            self.http.markdown_to_html(markdown),
            unavailable("html"),
        )
        .await
    }
    /// Dispatch `extract_mentions` through its configured route group.
    pub async fn extract_mentions(&self, markdown: &str) -> Result<Vec<ExtractedMention>> {
        self.dispatch(
            Route::Mentions,
            None,
            serde_json::to_vec(&MentionsRequest { markdown })?.len(),
            self.http.extract_mentions(markdown),
            unavailable("mentions"),
        )
        .await
    }
    /// Dispatch `compose_image_markdown` through its configured route group.
    pub async fn compose_image_markdown(&self, image: &ImageMarkdownRequest<'_>) -> Result<String> {
        self.dispatch(
            Route::ImageMarkdown,
            None,
            serde_json::to_vec(&image)?.len(),
            self.http.compose_image_markdown(image),
            unavailable("image_markdown"),
        )
        .await
    }
    /// Dispatch `compose_agent_announcement` through its configured route group.
    pub async fn compose_agent_announcement(
        &self,
        reply_target: Option<&AgentAnnouncementReplyTarget>,
        chip: &AgentAnnouncementChip,
    ) -> Result<String> {
        self.dispatch(
            Route::AgentAnnouncement,
            None,
            serde_json::to_vec(&AgentAnnouncementRequest { reply_target, chip })?.len(),
            self.http.compose_agent_announcement(reply_target, chip),
            unavailable("agent_announcement"),
        )
        .await
    }
    /// Dispatch `compose_agent_connection_prompt` through its configured route group.
    pub async fn compose_agent_connection_prompt(
        &self,
        prompt: &AgentConnectionPrompt,
    ) -> Result<String> {
        self.dispatch(
            Route::AgentConnectionPrompt,
            None,
            serde_json::to_vec(&AgentConnectionPromptRequest {
                connection_prompt: prompt,
            })?
            .len(),
            self.http.compose_agent_connection_prompt(prompt),
            unavailable("agent_connection_prompt"),
        )
        .await
    }
    /// Dispatch `compose_agent_chat_reply` through its configured route group.
    pub async fn compose_agent_chat_reply(&self, reply: &AgentChatReply) -> Result<String> {
        self.dispatch(
            Route::AgentChatReply,
            None,
            serde_json::to_vec(&AgentChatReplyRequest { chat_reply: reply })?.len(),
            self.http.compose_agent_chat_reply(reply),
            unavailable("agent_chat_reply"),
        )
        .await
    }
    /// Dispatch `compose_agent_context` through its configured route group.
    pub async fn compose_agent_context(
        &self,
        prompt_markdown: &str,
        instructions: Option<&str>,
        people: Option<&AgentContextPeople<'_>>,
        current_time: Option<&AgentContextCurrentTime<'_>>,
        trigger: Option<&TriggerContext>,
    ) -> Result<String> {
        self.dispatch(
            Route::AgentContext,
            None,
            serde_json::to_vec(&AgentContextRequest {
                prompt_markdown,
                instructions,
                people,
                current_time,
                trigger,
            })?
            .len(),
            self.http.compose_agent_context(
                prompt_markdown,
                instructions,
                people,
                current_time,
                trigger,
            ),
            unavailable("agent_context"),
        )
        .await
    }
    /// Dispatch `extract_explicit_reply` through its configured route group.
    pub async fn extract_explicit_reply(
        &self,
        markdown: &str,
    ) -> Result<Option<ExtractedExplicitReply>> {
        self.dispatch(
            Route::ExtractReply,
            None,
            serde_json::to_vec(&ExtractReplyRequest { markdown })?.len(),
            self.http.extract_explicit_reply(markdown),
            unavailable("extract_reply"),
        )
        .await
    }
    /// Dispatch `notion_to_loro_snapshot` through its configured route group.
    pub async fn notion_to_loro_snapshot(
        &self,
        request: &NotionSnapshotRequest<'_>,
    ) -> Result<NotionSnapshot> {
        self.dispatch(
            Route::SnapshotNotion,
            None,
            serde_json::to_vec(&request)?.len(),
            self.http.notion_to_loro_snapshot(request),
            unavailable("snapshot_notion"),
        )
        .await
    }
}
