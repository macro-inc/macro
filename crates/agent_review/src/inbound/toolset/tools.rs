//! Small workflow tools; all policy is implemented by the review domain service.

use agent_session::domain::model::AgentSessionId;
use ai_toolset::{
    AsyncTool, RequestContext, ServiceContext, ToolAnnotated, ToolAnnotations, ToolCallError,
    ToolResult,
};
use async_trait::async_trait;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use uuid::Uuid;

use crate::domain::{model::*, service::Reviews};

/// Context established by the Internal MCP credential, never by tool arguments.
#[derive(Clone)]
pub struct ReviewToolContext {
    /// Shared review service.
    pub service: Arc<dyn Reviews>,
    /// Calling session.
    pub session: AgentSessionId,
}

fn access(context: &ReviewToolContext, request: RequestContext) -> ReviewAccess {
    ReviewAccess::Agent {
        session: context.session,
        owner: request.user_id,
    }
}

fn failure(error: ReviewError) -> ToolCallError {
    ToolCallError {
        description: error.to_string(),
        internal_error: rootcause::report!(error).into(),
    }
}

/// Publish or refresh the calling session's review.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "diff",
    description = "Publish your workspace changes as a Macro code review, or refresh the current review after editing. The session determines the workspace and identity. Returns a stable Macro review link and revision. When explaining changes, cite this link or use diff_link for a specific code range. The base stays pinned across commits unless explicitly changed. Providers without workspace access use the linked PR."
)]
pub struct Diff {
    /// Optional base/tip; omit to update the current comparison.
    #[serde(default)]
    pub comparison: Comparison,
    /// Title, summary, reading tour, and inline explanations.
    #[serde(default)]
    pub presentation: Presentation,
}

impl ToolAnnotated for Diff {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Publish code review").with_idempotent();
}
#[async_trait]
impl AsyncTool<ReviewToolContext> for Diff {
    type Output = ReviewLink;
    async fn call(
        &self,
        context: ServiceContext<ReviewToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service
            .capture(
                access(&context, request),
                self.comparison.clone(),
                self.presentation.clone(),
            )
            .await
            .map_err(failure)
    }
}

/// Create a validated, durable link to code.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "diff_link",
    description = "Get a canonical Macro link to a file/line range in the calling session's review. Cite returned URLs when discussing code; do not guess links or use sandbox paths. Lines are one-based. The returned link remains pinned to the requested revision."
)]
pub struct DiffLink {
    /// Revision returned by diff.
    pub revision: u32,
    /// File, side, first line, and optional inclusive last line.
    pub location: Location,
}
impl ToolAnnotated for DiffLink {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Link to reviewed code");
}
#[async_trait]
impl AsyncTool<ReviewToolContext> for DiffLink {
    type Output = ReviewLink;
    async fn call(
        &self,
        context: ServiceContext<ReviewToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service
            .link(
                access(&context, request),
                self.revision,
                self.location.clone(),
            )
            .await
            .map_err(failure)
    }
}

/// Update the reading tour and inline explanations.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "diff_annotate",
    description = "Explain a published review with a reading tour and keyed inline annotations. Use chapters to order code by intent. Use fileGroups with paths/directories/globs and hidden=true for supporting changes such as generated files or tests; readers can reveal every file. Freely design graph components and relationships to explain the change: choose titles, concise descriptions, optional kind labels, component files (paths/directories/globs), validated code locations, and labeled edges. Give a node a parent ID to reveal it inside that component as the reader zooms in. Start with a few broad components, then useful implementation details; up to 64 nodes, 128 edges, and four hierarchy levels. Relationships appear at their nearest shared scope. Every node links to real code; the graph opens the tour and code retains a corner map of the visited component's siblings. Change counts aggregate captured files including descendants, deduplicated. Optionally choose graph direction leftToRight or topToBottom; omitted adapts to the pane. Provided collections replace the previous collection; omitted fields stay unchanged. A stale revision is rejected so explanations cannot silently land on different code."
)]
pub struct DiffAnnotate {
    /// Expected latest code revision.
    pub revision: u32,
    /// Updated title, summary, tour, or explanations.
    pub presentation: Presentation,
}
impl ToolAnnotated for DiffAnnotate {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Explain reviewed changes").with_idempotent();
}
#[async_trait]
impl AsyncTool<ReviewToolContext> for DiffAnnotate {
    type Output = ReviewLink;
    async fn call(
        &self,
        context: ServiceContext<ReviewToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service
            .annotate(
                access(&context, request),
                self.revision,
                self.presentation.clone(),
            )
            .await
            .map_err(failure)
    }
}

/// Respond beside the code, in the original human thread.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "diff_reply",
    description = "Reply to a human review thread in this session. Explain what you checked or changed and cite diff_link URLs when useful. This does not resolve the human's thread. Reuse the same message_id when retrying an uncertain response."
)]
pub struct DiffReply {
    /// Thread ID supplied in review feedback.
    pub thread_id: Uuid,
    /// Unique UUID for this reply; reuse for network retries.
    pub message_id: Uuid,
    /// Markdown reply text.
    pub body: String,
}
impl ToolAnnotated for DiffReply {
    const ANNOTATIONS: ToolAnnotations =
        ToolAnnotations::destructive("Reply to review feedback").with_idempotent();
}
#[async_trait]
impl AsyncTool<ReviewToolContext> for DiffReply {
    type Output = ReviewLink;
    async fn call(
        &self,
        context: ServiceContext<ReviewToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        context
            .service
            .reply(
                access(&context, request),
                self.thread_id,
                self.message_id,
                self.body.clone(),
            )
            .await
            .map_err(failure)
    }
}

/// Recover review discussion without copying the entire diff into context.
#[derive(Debug, Deserialize, JsonSchema)]
#[serde(deny_unknown_fields)]
#[schemars(
    title = "diff_feedback",
    description = "Read review threads and preserved code context for this session. Normal feedback is delivered automatically to the session queue. Use this to recover context or inspect unresolved discussion. Returns a bounded page of messages and preserved code context. Pass next_after as after to continue. Long excerpts and messages are explicitly marked truncated; use their review link to read the complete discussion."
)]
pub struct DiffFeedback {
    /// Include resolved threads; defaults to false.
    #[serde(default)]
    pub include_resolved: bool,
    /// Optional exact repository-relative path filter.
    pub path: Option<String>,
    /// Last message ID from the preceding page; omit to start.
    pub after: Option<Uuid>,
}

/// Bounded feedback context, intentionally excluding file bodies and history.
#[derive(Debug, Serialize, JsonSchema)]
#[serde(rename_all = "camelCase")]
pub struct FeedbackOutput {
    /// Threads containing this page's messages; a thread may span pages.
    pub threads: Vec<Thread>,
    /// Preserved code excerpts for the page, bounded to 4 KiB each.
    pub anchors: Vec<Anchor>,
    /// Matches beyond this page.
    pub remaining: usize,
    /// Pass as `after` to continue, absent on the last page.
    pub next_after: Option<Uuid>,
    /// Message IDs whose bodies were shortened to 8 KiB for context.
    pub truncated_messages: Vec<Uuid>,
    /// Canonical review link for reading full messages and code.
    pub url: Option<String>,
}

fn truncate(text: &mut String, limit: usize) -> bool {
    if text.len() <= limit {
        return false;
    }
    let mut end = limit;
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    text.truncate(end);
    text.push_str("\n[truncated — open the review for full text]");
    true
}

impl ToolAnnotated for DiffFeedback {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::read_only("Read review feedback");
}
#[async_trait]
impl AsyncTool<ReviewToolContext> for DiffFeedback {
    type Output = FeedbackOutput;
    async fn call(
        &self,
        context: ServiceContext<ReviewToolContext>,
        request: RequestContext,
    ) -> ToolResult<Self::Output> {
        let review = context
            .service
            .view(access(&context, request.clone()), None)
            .await
            .map_err(failure)?;
        let mut output = FeedbackOutput {
            threads: vec![],
            anchors: vec![],
            remaining: 0,
            next_after: None,
            truncated_messages: vec![],
            url: None,
        };
        let Some(review) = review else {
            return Ok(output);
        };
        let matches: Vec<_> = review
            .threads
            .iter()
            .filter(|t| self.include_resolved || !t.resolved)
            .filter(|t| {
                self.path.as_ref().is_none_or(|p| {
                    review
                        .anchors
                        .iter()
                        .any(|a| a.id == t.anchor && &a.current.path == p)
                })
            })
            .flat_map(|thread| thread.messages.iter().map(move |message| (thread, message)))
            .collect();
        let start = match self.after {
            Some(id) => {
                matches
                    .iter()
                    .position(|(_, m)| m.id == id)
                    .ok_or_else(|| {
                        failure(ReviewError::Invalid(
                            "Feedback cursor no longer matches this filter".into(),
                        ))
                    })?
                    + 1
            }
            None => 0,
        };
        let mut bytes = 0;
        let mut returned = 0;
        for (thread, message) in matches.iter().skip(start) {
            let Some(anchor) = review.anchors.iter().find(|a| a.id == thread.anchor) else {
                continue;
            };
            let mut anchor = anchor.clone();
            let mut excerpt = anchor.excerpt.join("\n");
            truncate(&mut excerpt, 4096);
            anchor.excerpt = excerpt.lines().map(str::to_owned).collect();
            let mut message = (*message).clone();
            let truncated = truncate(&mut message.body, 8192);
            let size = serde_json::to_vec(&(&anchor, &message))
                .map_err(|e| failure(ReviewError::Invalid(e.to_string())))?
                .len();
            if returned > 0 && (bytes + size > 65_536 || returned == 50) {
                break;
            }
            bytes += size;
            returned += 1;
            output.next_after = Some(message.id);
            if truncated {
                output.truncated_messages.push(message.id);
            }
            if let Some(existing) = output.threads.iter_mut().find(|t| t.id == thread.id) {
                existing.messages.push(message);
            } else {
                output.threads.push(Thread {
                    id: thread.id,
                    anchor: thread.anchor,
                    resolved: thread.resolved,
                    messages: vec![message],
                });
                output.anchors.push(anchor);
            }
        }
        output.remaining = matches.len().saturating_sub(start + returned);
        if output.remaining == 0 {
            output.next_after = None;
        }
        if let Some(anchor) = output.anchors.first() {
            output.url = Some(
                context
                    .service
                    .link(
                        access(&context, request),
                        anchor.revision,
                        anchor.original.clone(),
                    )
                    .await
                    .map_err(failure)?
                    .url,
            );
        }
        Ok(output)
    }
}
