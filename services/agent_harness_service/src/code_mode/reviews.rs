//! Compose persistent reviews with existing tool actions and the session queue.
use agent_code_mode::domain::{CodeModeError, reviews::*};
use agent_session::domain::{
    model::AgentSessionId,
    ports::{AgentSessionNotificationRecipient, AgentSessionRepo},
};
use ai_toolset::RequestContext;
use async_trait::async_trait;
use import::domain::models::{NotionImportReport, NotionWriteChoices, RunStatus};
use import::domain::service::NotionWorkspaceImporter;
use macro_user_id::user_id::MacroUserIdStr;
use serde::Deserialize;
use serde_json::Value;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// The one draft an import review carries: which source's staged plan it
/// presents, the plan rows the user took out of it, and the rows whose
/// sharing they changed: `shared` to share with their team, `personal` to
/// keep to themselves.
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct ImportDraft {
    source: ImportReviewSource,
    #[serde(default)]
    excluded: Vec<macro_uuid::Uuid>,
    #[serde(default)]
    shared: Vec<macro_uuid::Uuid>,
    #[serde(default)]
    personal: Vec<macro_uuid::Uuid>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "snake_case")]
enum ImportReviewSource {
    Notion,
}

pub struct Actions<S, H> {
    pub sessions: S,
    pub harness: Arc<H>,
    pub context: ai_tools::ToolServiceContext,
    pub tools: Arc<ai_tools::AiToolSet>,
}
#[async_trait]
impl<S: AgentSessionRepo, H: AgentSessionNotificationRecipient> ReviewActions for Actions<S, H> {
    async fn session(&self, session: AgentSessionId) -> Result<ReviewSession, CodeModeError> {
        let row = self
            .sessions
            .get(session)
            .await
            .map_err(|_| CodeModeError::NotFound)?;
        Ok(ReviewSession {
            owner: row
                .owner_user()
                .cloned()
                .map_err(|_| CodeModeError::Forbidden)?,
            archived: row.is_archived,
            prompter: self
                .sessions
                .turn_prompter(session)
                .await
                .map_err(|error| CodeModeError::Storage(rootcause::report!(error).into()))?,
        })
    }
    fn validate(&self, kind: ReviewKind, draft: &Value) -> Result<(), CodeModeError> {
        validate_draft(&self.tools, kind, draft)
    }
    async fn approvable(
        &self,
        owner: &MacroUserIdStr<'static>,
        record: &ReviewRecord,
    ) -> Result<bool, CodeModeError> {
        if record.kind != ReviewKind::Import {
            return Ok(true);
        }
        let report = self.import_report(owner).await?;
        Ok(report.review_id == Some(record.id.0) && report.status == Some(RunStatus::Ready))
    }
    async fn execute(
        &self,
        owner: &MacroUserIdStr<'static>,
        record: &ReviewRecord,
        draft: Value,
    ) -> Result<Value, CodeModeError> {
        let name = match record.kind {
            ReviewKind::Email => "SendEmail",
            ReviewKind::Calendar => "CreateCalendarEvent",
            ReviewKind::Import => return self.start_import(owner, record, draft).await,
        };
        let mut context = self.context.clone();
        context.usage_context =
            ai_usage::UsageContext::new(ai_usage::AiFeature::AgentSession, owner.clone());
        let result = self
            .tools
            .try_user_tool_call(context, RequestContext::new(owner.clone()), name, &draft)
            .await
            .map_err(|_| CodeModeError::Invalid("Could not submit the reviewed action.".into()))?
            .map_err(|_| {
                CodeModeError::Invalid(
                    "The reviewed action did not return a confirmed outcome.".into(),
                )
            })?;
        match result {
            ai_toolset::tool_object::UserToolResponse::UserAction(value) => Ok(value),
            _ => Err(CodeModeError::Invalid(
                "The action was not completed.".into(),
            )),
        }
    }
    async fn present(
        &self,
        owner: &MacroUserIdStr<'static>,
        record: &ReviewRecord,
    ) -> Result<(), CodeModeError> {
        if record.kind == ReviewKind::Import {
            // The plan is tied to the review before the card appears, so the
            // card never shows a plan it cannot approve.
            self.import_service()?
                .attach_notion_review(owner, record.id.0, Some(record.session_id))
                .await
                .map_err(|error| {
                    tracing::warn!(error = ?error, review = %record.id.0, "could not tie the import plan to its review");
                    CodeModeError::Invalid(format!(
                        "Review {} was saved, but its import plan could not be attached. Read this review to retry.",
                        record.id.0
                    ))
                })?;
        }
        self.harness.present_tool(
            record.session_id,
            owner.clone(),
            agent_session::domain::model::SessionToolPresentation {
                tool_call_id: format!("review_{}", record.id.0),
                title: "mcp__macro_internal__PresentReview".into(),
                raw_input: serde_json::json!({"reviewId": record.id, "kind": record.kind, "title": record.title}),
                raw_output: serde_json::json!({"reviewId": record.id, "message": "Presented to the user"}),
            },
        ).await.map_err(|_| CodeModeError::Invalid(format!("Review {} was saved, but presentation is pending. Read this review to retry presentation without creating another draft.", record.id.0)))
    }
}

impl<S, H> Actions<S, H> {
    fn import_service(&self) -> Result<&ai_tools::ToolImportService, CodeModeError> {
        self.context
            .import_tool_context
            .service
            .as_deref()
            .ok_or_else(|| CodeModeError::Invalid("Imports are not available here.".into()))
    }

    async fn import_report(
        &self,
        owner: &MacroUserIdStr<'static>,
    ) -> Result<NotionImportReport, CodeModeError> {
        self.import_service()?
            .notion_import_report(owner)
            .await
            .map_err(|error| {
                tracing::warn!(error = ?error, "could not read the notion import report");
                CodeModeError::Invalid("The import's report could not be read.".into())
            })
    }

    /// Start writing the approved plan; the write runs in the background,
    /// reports progress through the import state, and tells the session
    /// once it ends.
    async fn start_import(
        &self,
        owner: &MacroUserIdStr<'static>,
        record: &ReviewRecord,
        draft: Value,
    ) -> Result<Value, CodeModeError> {
        let draft: ImportDraft = serde_json::from_value(draft)
            .map_err(|_| CodeModeError::Invalid("Import draft is malformed.".into()))?;
        let ImportReviewSource::Notion = draft.source;
        let report = self
            .import_service()?
            .start_notion_write(
                owner,
                record.id.0,
                NotionWriteChoices {
                    excluded: draft.excluded,
                    shared: draft.shared,
                    personal: draft.personal,
                },
            )
            .await
            .map_err(|error| CodeModeError::Invalid(error.to_string()))?;
        serde_json::to_value(report).map_err(|_| {
            CodeModeError::Invalid("The import started, but its report could not be read.".into())
        })
    }
}

fn validate_draft(
    tools: &ai_tools::AiToolSet,
    kind: ReviewKind,
    draft: &Value,
) -> Result<(), CodeModeError> {
    let invalid =
        || CodeModeError::Invalid("Draft does not match the review component's schema.".into());
    match kind {
        ReviewKind::Email => {
            if !tools.is_valid_tool("SendEmail", draft) {
                return Err(invalid());
            }
        }
        ReviewKind::Calendar => {
            if !tools.is_valid_tool("CreateCalendarEvent", draft) {
                return Err(invalid());
            }
        }
        ReviewKind::Import => {
            if serde_json::from_value::<ImportDraft>(draft.clone()).is_err() {
                return Err(invalid());
            }
        }
    }
    Ok(())
}
