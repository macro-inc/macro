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
    raw: Option<std::sync::Arc<dyn crate::RawDocumentSource>>,
}
impl LexicalClient {
    /// Construct an explicit all-HTTP client, including for isolated tests.
    pub fn new(internal_auth_key: String, url: String) -> Self {
        Self {
            http: HttpLexicalClient::new(internal_auth_key, url),
            modes: RouteModes::default(),
            raw: None,
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
    /// Supply an already configured live document source at the composition root.
    pub fn with_document_source(
        mut self,
        source: std::sync::Arc<dyn crate::RawDocumentSource>,
    ) -> Self {
        self.raw = Some(source);
        self
    }
    /// Configure local document exports once at startup using MacroConfig and typed URLs.
    /// HTTP-only clients do not load or require the sync credential.
    pub async fn with_sync_from_env(self) -> Result<Self> {
        if self.modes.mode(crate::RouteGroup::Markdown) == crate::RouteMode::Http {
            return Ok(self);
        }
        let config: crate::raw_document::RawDocumentConfig = macro_config::ConfigLoader::load()?;
        let config = if matches!(config.environment, macro_env::Environment::Local) {
            config
        } else {
            let aws = Box::pin(macro_aws_config::get_macro_aws_config()).await;
            let secrets = secretsmanager_client::SecretsManager::new(
                aws_sdk_secretsmanager::Client::new(&aws),
            );
            let environment = config.environment;
            Box::pin(config.resolve_remote_secrets(environment, &secrets)).await?
        };
        let source = sync_service_client::SyncServiceClient::new(
            config.sync_service_auth_key.as_ref().to_owned(),
            macro_service_urls::SyncServiceUrl::new()?.to_string(),
        );
        Ok(self.with_document_source(std::sync::Arc::new(source)))
    }
    async fn export<T: Send + 'static>(
        &self,
        document_id: &str,
        operation: impl FnOnce(&lexical_model::EditorState) -> Result<T> + Send + 'static,
    ) -> Result<T> {
        let source = self.raw.as_ref().ok_or(crate::MissingDocumentSource)?;
        let raw = source.get_raw(document_id).await?;
        crate::in_process::run(move |context| {
            let state = macro_document_model::export::parse_export_state(
                &serde_json::from_str(&raw)?,
                context,
            )?;
            operation(&state)
        })
        .await
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
            self.export(document_id, |state| {
                Ok(macro_document_model::export::to_search_text(state)?
                    .into_iter()
                    .map(|node| MarkdownParseResult {
                        node_id: node.node_id,
                        content: node.content,
                        raw_content: node.raw_content,
                    })
                    .collect())
            }),
        )
        .await
    }
    /// Fetches the full document rendered as a single markdown string in the
    /// requested target format.
    pub async fn get_markdown(&self, document_id: &str, target: MarkdownTarget) -> Result<String> {
        self.dispatch(
            Route::Markdown,
            Some(document_id),
            0,
            self.http.get_markdown(document_id, target),
            self.export(document_id, move |state| {
                let target = match target {
                    MarkdownTarget::Internal => {
                        macro_document_model::export::MarkdownTarget::Internal
                    }
                    MarkdownTarget::External => {
                        macro_document_model::export::MarkdownTarget::External
                    }
                    MarkdownTarget::Embedding => {
                        macro_document_model::export::MarkdownTarget::Embedding
                    }
                };
                Ok(macro_document_model::export::to_markdown_text(
                    state, target, None,
                )?)
            }),
        )
        .await
    }
    /// Fetches the document body rendered as [embedding-format markdown](EmbeddingMarkdown),
    /// typed so callers can only consume it as an [`EmbeddingMarkdown`]. Prefer
    /// this over [`get_markdown`](Self::get_markdown) with
    /// [`MarkdownTarget::Embedding`] anywhere the result feeds task-dedup.
    pub async fn get_embedding_markdown(&self, document_id: &str) -> Result<EmbeddingMarkdown> {
        self.dispatch(
            Route::Markdown,
            Some(document_id),
            0,
            self.http.get_embedding_markdown(document_id),
            self.export(document_id, |state| {
                Ok(EmbeddingMarkdown::from_client_trusted(
                    macro_document_model::export::to_markdown_text(
                        state,
                        macro_document_model::export::MarkdownTarget::Embedding,
                        None,
                    )?,
                ))
            }),
        )
        .await
    }
    /// Resolve a comment mark against the live document: `None` when the
    /// document no longer carries it. Performs no access check of its own, so
    /// callers must already hold access to the document.
    pub async fn resolve_comment_mark(
        &self,
        document_id: &str,
        mark_id: &str,
    ) -> Result<Option<CommentMarkContext>> {
        let mark = mark_id.to_owned();
        self.dispatch(
            Route::CommentMark,
            Some(document_id),
            0,
            self.http.resolve_comment_mark(document_id, mark_id),
            self.export(document_id, move |state| {
                crate::in_process::wire(macro_document_model::export::to_comment_mark_context(
                    state, &mark,
                )?)
            }),
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
            self.export(document_id, |state| {
                Ok(CognitionV2ResponseData {
                    data: crate::in_process::wire(macro_document_model::export::to_cognition_v2(
                        state,
                    )?)?,
                })
            }),
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
            crate::in_process::markdown_snapshot(markdown),
        )
        .await
    }
    /// Renders `markdown` to an email-ready HTML body through the configured
    /// backend, so a caller with no browser composer — the `SendEmail` tool,
    /// whose body the model writes as markdown — produces the same HTML the
    /// composer would have exported.
    pub async fn markdown_to_html(&self, markdown: &str) -> Result<RenderedBody> {
        self.dispatch(
            Route::Html,
            None,
            serde_json::to_vec(&HtmlRequest { markdown })?.len(),
            self.http.markdown_to_html(markdown),
            crate::in_process::html(markdown),
        )
        .await
    }
    /// Parses `markdown` through the configured backend and returns the entity
    /// mentions it contains.
    pub async fn extract_mentions(&self, markdown: &str) -> Result<Vec<ExtractedMention>> {
        self.dispatch(
            Route::Mentions,
            None,
            serde_json::to_vec(&MentionsRequest { markdown })?.len(),
            self.http.extract_mentions(markdown),
            crate::in_process::mentions(markdown),
        )
        .await
    }
    /// Compose dimension-preserving channel markup from a real Lexical image node.
    pub async fn compose_image_markdown(&self, image: &ImageMarkdownRequest<'_>) -> Result<String> {
        self.dispatch(
            Route::ImageMarkdown,
            None,
            serde_json::to_vec(&image)?.len(),
            self.http.compose_image_markdown(image),
            crate::in_process::image(image),
        )
        .await
    }
    /// Composes the channel message announcing an agent session — a structured
    /// reply target above the session's Magic Chip — through the configured backend,
    /// so the markdown is built from real Lexical nodes.
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
            crate::in_process::announcement(AgentAnnouncementRequest { reply_target, chip }),
        )
        .await
    }
    /// Compose an account setup reply through the lexical service's real nodes.
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
            crate::in_process::announcement(AgentConnectionPromptRequest {
                connection_prompt: prompt,
            }),
        )
        .await
    }
    /// Compose a chat agent's thread message - its session link over the
    /// spinner or its prose - through the lexical service's real nodes.
    pub async fn compose_agent_chat_reply(&self, reply: &AgentChatReply) -> Result<String> {
        self.dispatch(
            Route::AgentChatReply,
            None,
            serde_json::to_vec(&AgentChatReplyRequest { chat_reply: reply })?.len(),
            self.http.compose_agent_chat_reply(reply),
            crate::in_process::announcement(AgentChatReplyRequest { chat_reply: reply }),
        )
        .await
    }
    /// Sanitizes an agent prompt and optionally composes it with why the
    /// agent was called through the configured backend, so internal nodes and
    /// escaping are handled by Lexical rather than by the caller.
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
            crate::in_process::agent_context(&AgentContextRequest {
                prompt_markdown,
                instructions,
                people,
                current_time,
                trigger,
            }),
        )
        .await
    }
    /// Parses `markdown` through the configured backend and returns the leading
    /// `ReplyTargetNode` when it is followed by the author's non-empty reply.
    /// Standard Markdown blockquotes carry no reply semantics.
    pub async fn extract_explicit_reply(
        &self,
        markdown: &str,
    ) -> Result<Option<ExtractedExplicitReply>> {
        self.dispatch(
            Route::ExtractReply,
            None,
            serde_json::to_vec(&ExtractReplyRequest { markdown })?.len(),
            self.http.extract_explicit_reply(markdown),
            crate::in_process::extract_reply(markdown),
        )
        .await
    }
    /// Convert a Notion page to a new document's Loro snapshot.
    pub async fn notion_to_loro_snapshot(
        &self,
        request: &NotionSnapshotRequest<'_>,
    ) -> Result<NotionSnapshot> {
        self.dispatch(
            Route::SnapshotNotion,
            None,
            serde_json::to_vec(&request)?.len(),
            self.http.notion_to_loro_snapshot(request),
            crate::in_process::notion_snapshot(request),
        )
        .await
    }
}
