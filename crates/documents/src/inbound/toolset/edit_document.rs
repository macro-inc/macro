//! EditDocument tool — permission/token boundary for the domain AI-editing use case.

use crate::domain::ai_editing::{AiEditError, AiEditRequest};
use crate::domain::markdown_edits::{
    MarkdownBlockChange, MarkdownEdit, MarkdownEditConflictReason, MarkdownEditError,
    MarkdownEditOutcomeKind, MarkdownEditRequest, apply_markdown_edits,
};
use crate::domain::permission_token::encode_permission_token;
use crate::domain::ports::{
    DocumentService,
    create::DocumentCreationService,
    editing::{EditMode, EditingWorkerService},
};
use ai_toolset::{AsyncTool, RequestContext, ServiceContext, ToolCallError, ToolResult};
use ai_toolset::{ToolAnnotated, ToolAnnotations};
use async_trait::async_trait;
use entity_access::domain::{
    models::{EditAccessLevel, EntityType},
    ports::EntityAccessService,
};
use model::document::{DocumentBasic, FileType};
use models_permissions::share_permission::access_level::AccessLevel;
use schemars::JsonSchema;
use serde::{Deserialize, Serialize};

use super::DocumentToolContext;

#[cfg(test)]
pub(super) mod test;

#[derive(Debug, Deserialize, JsonSchema)]
#[schemars(
    title = "EditDocument",
    description = "Edit a Macro markdown document in place. Two ways: `edits` applies exact changes you already know, with no second model, much faster; `instructions` asks an AI editor to work the change out, which takes several seconds to a minute. Prefer `edits` whenever you can say the exact text: copy `old` from the block content ReadContent returned (each block's internal markdown, with its nodeId as the block id), and give `new`. A block ReadContent lists without a nodeId (a top-level image, say) can only be reached by matching text around it; when an exact `old` comes back as no_match, the refusal lists the blocks as the editor reads them. Use `instructions` for open-ended rewrites, restructuring you can't spell out, or formatting you don't know the markup for. Use EditSpreadsheet for native Macro spreadsheets. Markdown documents only: these are authored in Macro's collaborative editor, and are the only documents whose content this tool can rewrite. Edit uploaded Word (.docx) files with ReadWordDocument and EditWordDocument instead. Other uploaded files -- PDFs, images, source files such as .py or .ts -- are readable but not editable, and are rejected. If the response contains a `clarification` field, invoke again with the requested info appended to `instructions`. To insert @-mention chips with `instructions`, include each referenced item's ids and details: userId/email for people; documentId/documentName/blockName (and blockParams when needed) for documents, channels, chats, projects, tasks, emails, calendar events, skills, calls, and routines; session id (and optional expanded card) for agent sessions; ISO datetime plus displayFormat for time chips; profileId/slug/url for booking links. To insert document-card(s), include each document's documentId and documentName; to embed a database, its databaseId, name, and tableId/viewId. To insert a live database answer or chart, quote the `<m-db-query>` block from SaveDatabaseQuery verbatim in `instructions`. With `edits`, write chips and cards as the same `<m-...>` tags ReadContent shows."
)]
pub struct EditDocument {
    #[schemars(
        description = "The ID of the markdown document to edit. If you are not certain the document is markdown, call ReadMetadata first and check that `fileType` is `md` -- passing an uploaded file here fails."
    )]
    pub document_id: String,
    #[serde(default)]
    #[schemars(
        description = "Natural language instructions for the AI editor. Leave empty when you pass `edits`. For @-mention chips, include each item's ids and details: userId/email for people; documentId/documentName/blockName for documents and similar items; session id for agent sessions; ISO datetime and displayFormat for time chips; profileId/slug/url for booking links. For document-card(s), include documentId and documentName per document. You may need to look these up."
    )]
    pub instructions: String,
    #[serde(default)]
    #[schemars(
        description = "Exact edits, applied in order as one batch with no second model; all apply or none do. Each edit is one of: `{old, new, block_id?, replace_all?}` replaces exact internal markdown (`old` must occur exactly once in the document, or in `block_id`, unless `replace_all`; copy it from ReadContent's block content, including any `**`, `<m-...>` tags and list markers; `old` may span adjacent blocks, joined by one blank line); `{insert_after: ID|'start'|'end', markdown}` or `{insert_before: ...}` inserts new blocks; `{delete: ID}` deletes a block; `{move: ID, after: ID}` or `{move: ID, before: ID}` moves one. IDs are ReadContent nodeIds. Edited blocks keep their ids and comments. A refusal says what to fix (no_match and ambiguous_match list the blocks); nothing is written then. Leave `instructions` empty when you pass edits."
    )]
    pub edits: Vec<MarkdownEdit>,
    #[serde(default)]
    #[schemars(
        description = "With `edits`: check the batch and return the changes it would make, without writing anything."
    )]
    pub dry_run: bool,
    #[serde(default)]
    #[schemars(
        description = "With `edits`: allow deleting blocks that hold comments or content markdown cannot show, or most of the document. Set only when the user asked for that deletion."
    )]
    pub allow_deleting_content: bool,
    #[serde(default)]
    #[schemars(
        description = "Set true for one quick, contained edit -- rewrite this paragraph, translate the selected list, fix a heading, bold a phrase. A single model applies it directly in a few seconds. Leave false (the default) for anything with several parts or that restructures the document; the default pipeline plans, dispatches, and reviews its own work, which takes longer but is what multi-step edits need."
    )]
    pub fast: bool,
}

/// The editing worker opens a sync-service session and blocks on the initial
/// Loro snapshot. Only markdown documents ever get a Loro doc, so anything else
/// waits out the worker's handshake timeout and surfaces as an opaque gateway
/// error. Reject those up front instead.
///
/// This gates on the file type rather than the document's current content
/// location on purpose. Markdown uploaded to S3 is initialized into sync-service
/// when its upload finalizes, so its location is legitimately `object_storage`
/// for the width of that window while the Loro doc is still being created. The
/// sync session tolerates that -- the server broadcasts the snapshot to sockets
/// already waiting once `/initialize` lands. Gating on location would reject an
/// edit that window is designed to serve; the file type does not move.
fn ensure_markdown(document: &DocumentBasic) -> Result<(), ToolCallError> {
    if document.try_file_type() == Some(FileType::Md) {
        return Ok(());
    }

    let file_type = document.file_type.as_deref().unwrap_or("unknown");
    if document.try_file_type() == Some(FileType::Docx) {
        return Err(ToolCallError {
            description: "this is an uploaded Word (.docx) document, which EditDocument cannot change. Use ReadWordDocument to read it with paragraph ids, then EditWordDocument to edit it.".to_owned(),
            internal_error: anyhow::anyhow!("document file type docx is not markdown"),
        });
    }
    Err(ToolCallError {
        description: format!(
            "this document cannot be edited: it is a `{file_type}` file, not a Macro markdown document. AI editing only works on markdown documents authored in Macro's collaborative editor -- uploaded files (PDFs, DOCX, images, source files, and so on) are readable but not editable. Report this back to the user rather than retrying."
        ),
        internal_error: anyhow::anyhow!("document file type {file_type} is not markdown"),
    })
}

#[derive(Debug, Serialize, JsonSchema)]
pub struct EditDocumentResponse {
    /// A short outcome for the model -- whether the edit was applied or
    /// interrupted -- never the underlying list of edit operations.
    pub summary: String,
    /// If present, invoke this tool again with this information appended to `instructions`.
    pub clarification: Option<String>,
    /// With `edits`: what changed, block by block, with the ids of new blocks.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub changes: Option<Vec<MarkdownBlockChange>>,
}

impl ToolAnnotated for EditDocument {
    const ANNOTATIONS: ToolAnnotations = ToolAnnotations::destructive("Edit document");
}

impl EditDocument {
    /// The direct-edit batch when `edits` is given; an error when the call
    /// gives both `edits` and `instructions`, or neither.
    fn direct_request(&self) -> Result<Option<MarkdownEditRequest>, ToolCallError> {
        let has_instructions = !self.instructions.trim().is_empty();
        match (self.edits.is_empty(), has_instructions) {
            (true, true) if self.dry_run || self.allow_deleting_content => Err(ToolCallError {
                description: "`dry_run` and `allow_deleting_content` apply to `edits` only; the AI editor has neither".to_owned(),
                internal_error: anyhow::anyhow!("EditDocument instructions call with an edits-only flag"),
            }),
            (true, true) => Ok(None),
            (false, false) if self.fast => Err(ToolCallError {
                description: "`fast` applies to `instructions` only; `edits` run no AI editor".to_owned(),
                internal_error: anyhow::anyhow!("EditDocument edits call with fast"),
            }),
            (false, false) => Ok(Some(MarkdownEditRequest {
                edits: self.edits.clone(),
                base_revision: None,
                dry_run: self.dry_run,
                allow_deleting_content: self.allow_deleting_content,
            })),
            (false, true) => Err(ToolCallError {
                description: "pass either `edits` or `instructions`, not both".to_owned(),
                internal_error: anyhow::anyhow!("EditDocument called with edits and instructions"),
            }),
            (true, false) => Err(ToolCallError {
                description:
                    "pass `edits` (exact changes) or `instructions` (a change for the AI editor)"
                        .to_owned(),
                internal_error: anyhow::anyhow!(
                    "EditDocument called with neither edits nor instructions"
                ),
            }),
        }
    }

    async fn apply_edits<DSvc, ESvc, EDSvc>(
        &self,
        ctx: &ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
        document_token: &macro_sync_service_jwt::DocumentPermissionToken,
        request: &MarkdownEditRequest,
        request_context: &RequestContext,
    ) -> ToolResult<EditDocumentResponse>
    where
        DSvc: DocumentService + DocumentCreationService,
        ESvc: EntityAccessService,
        EDSvc: EditingWorkerService,
    {
        let edited = tokio::select! {
            biased;
            _ = request_context.cancel.cancelled() => {
                return Err(ToolCallError {
                    description: "cancelled; the edits may have applied, read the document before retrying".to_string(),
                    internal_error: anyhow::anyhow!("direct edit cancelled by user; it may have applied"),
                });
            }
            r = apply_markdown_edits(ctx.editing.as_ref(), &self.document_id, document_token, request) => r,
        }
        .map_err(|error| ToolCallError {
            description: match &error {
                MarkdownEditError::Refused(refusal) => {
                    let mut text = format!(
                        "edits refused ({}), nothing was written: {}",
                        serde_json::to_value(refusal.code)
                            .ok()
                            .and_then(|code| code.as_str().map(str::to_owned))
                            .unwrap_or_default(),
                        refusal.message
                    );
                    for block in &refusal.blocks {
                        text.push_str(&format!(
                            "\n- block {} ({} occurrence(s)): {}",
                            block.block_id.as_str(), block.occurrences, block.markdown
                        ));
                    }
                    text
                }
                MarkdownEditError::Conflict(conflict) => match conflict.reason {
                    MarkdownEditConflictReason::Changed => format!(
                        "the document changed and an edit no longer applies, nothing was written: {}; read it again",
                        conflict.message
                    ),
                    MarkdownEditConflictReason::Busy => format!(
                        "others kept editing the document, nothing was written: {}",
                        conflict.message
                    ),
                },
                MarkdownEditError::Document(error) => error.to_string(),
                MarkdownEditError::ReadFailed(_) | MarkdownEditError::WriteFailed(_) => {
                    "the edit failed and may have applied; read the document before retrying".to_owned()
                }
            },
            internal_error: error.into(),
        })?;
        let summary = match edited.outcome {
            MarkdownEditOutcomeKind::Committed => {
                format!("Applied {} edit(s) to the document.", request.edits.len())
            }
            MarkdownEditOutcomeKind::Unchanged => {
                "The document already reads that way; nothing was written.".to_owned()
            }
            MarkdownEditOutcomeKind::AlreadyApplied => {
                "These edits were already applied; nothing was written again.".to_owned()
            }
            MarkdownEditOutcomeKind::DryRun => {
                "Dry run: the edits apply as shown in `changes`; nothing was written.".to_owned()
            }
        };
        Ok(EditDocumentResponse {
            summary,
            clarification: None,
            changes: Some(edited.changes),
        })
    }

    fn mode(&self) -> EditMode {
        if self.fast {
            EditMode::Fast
        } else {
            EditMode::Supervised
        }
    }
}

#[async_trait]
impl<DSvc, ESvc, EDSvc> AsyncTool<DocumentToolContext<DSvc, ESvc, EDSvc>> for EditDocument
where
    DSvc: DocumentService + DocumentCreationService,
    ESvc: EntityAccessService,
    EDSvc: EditingWorkerService,
{
    type Output = EditDocumentResponse;

    #[tracing::instrument(skip_all, fields(document_id = %self.document_id), err)]
    async fn call(
        &self,
        ctx: ServiceContext<DocumentToolContext<DSvc, ESvc, EDSvc>>,
        request_context: RequestContext,
    ) -> ToolResult<Self::Output> {
        let receipt = ctx
            .entity_access_service
            .generate_entity_access_receipt::<EditAccessLevel>(
                &request_context.user_id,
                None,
                &self.document_id,
                EntityType::Document,
            )
            .await
            .map_err(|e| ToolCallError {
                description: "you do not have edit access to this document".to_string(),
                internal_error: e.into(),
            })?;

        let document = ctx
            .service
            .internal_get_basic_document(&self.document_id)
            .await
            .map_err(|e| ToolCallError {
                description: "unable to look up this document".to_string(),
                internal_error: e.into(),
            })?;

        ensure_markdown(&document)?;
        let direct = self.direct_request()?;

        let document_token = encode_permission_token(
            Some(request_context.user_id.to_string()),
            self.document_id.clone(),
            AccessLevel::Edit,
            &ctx.document_permission_jwt_secret,
            Some(ctx.actor.into_storage_id().to_string()),
        )
        .map_err(|e| ToolCallError {
            description: "failed to mint document token".to_string(),
            internal_error: e.into(),
        })?;

        if let Some(request) = direct {
            return self
                .apply_edits(&ctx, &document_token, &request, &request_context)
                .await;
        }

        // The edit is presented as the bot this tool acts as: readers watching
        // the document see its name on the cursor, the same name the activity
        // feed attributes the edit to.
        let editor = ctx.actor_editor_name();

        // Honor user cancellation: if the request is cancelled mid-edit, drop the
        // in-flight worker call (closing the HTTP connection so the worker aborts
        // its own LLM work) and surface a `cancelled` tool error -- matching how
        // the chat stream renders cancellation for tool calls that never returned.
        let editing = ctx.ai_editing();
        let edit = AiEditRequest {
            document_token: &document_token,
            instructions: &self.instructions,
            mode: self.mode(),
            editor,
        };
        let result = tokio::select! {
            biased;
            _ = request_context.cancel.cancelled() => {
                return Err(ToolCallError {
                    description: "cancelled".to_string(),
                    internal_error: anyhow::anyhow!("edit cancelled by user. document might be left in a partially edited state."),
                });
            }
            r = editing.edit(receipt, &request_context.user_id, edit) => r,
        }
        .map_err(|error| {
            let description = match &error {
                AiEditError::Admission(error) => format!("{}: {error}", error.code()),
                AiEditError::Worker(error) => error.to_string(),
            };
            ToolCallError {
                description,
                internal_error: error.into(),
            }
        })?;

        let summary = if result.clarification.is_some() {
            "Paused for clarification; no edits applied.".to_string()
        } else {
            format!("Applied {} edit(s) to the document.", result.edits_applied)
        };

        Ok(EditDocumentResponse {
            summary,
            clarification: result.clarification,
            changes: None,
        })
    }
}
