//! Compose persistent reviews with existing tool actions and the session queue.
use agent_code_mode::domain::{CodeModeError, reviews::*};
use agent_runtime_protocol::domain::review::ReviewUpdatedNotification;
use agent_session::domain::{
    model::AgentSessionId,
    ports::{AgentSessionNotificationRecipient, AgentSessionRepo},
    service::AgentSessionService,
};
use ai_toolset::RequestContext;
use async_trait::async_trait;
use import::domain::models::{NotionImportReport, NotionWriteChoices, RunStatus};
use import::domain::service::WorkspaceImporter;
use macro_user_id::user_id::MacroUserIdStr;
use serde::{Serialize, de::DeserializeOwned};
use std::sync::Arc;

/// The source of an import review's one draft, fixed at presentation.
fn import_source(
    record: &ReviewRecord,
) -> Result<import::domain::models::ImportSource, CodeModeError> {
    match &record.items {
        ReviewItems::Import(items) => {
            let [item] = &**items;
            Ok(item.draft.source.into())
        }
        _ => Err(CodeModeError::Invalid(
            "This is not an import review.".into(),
        )),
    }
}

pub struct Actions<S, L, H> {
    pub sessions: S,
    /// Where each save is announced to the session's viewers.
    pub log: L,
    pub harness: Arc<H>,
    pub context: ai_tools::ToolServiceContext,
    pub tools: Arc<ai_tools::AiToolSet>,
}
#[async_trait]
impl<S, L, H> ReviewActions for Actions<S, L, H>
where
    S: AgentSessionRepo,
    L: AgentSessionService + Send + Sync + 'static,
    H: AgentSessionNotificationRecipient,
{
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
            archived: row.is_archived(),
            prompter: self
                .sessions
                .turn_prompter(session)
                .await
                .map_err(|error| CodeModeError::Storage(rootcause::report!(error).into()))?,
        })
    }
    async fn approvable(
        &self,
        account_holder: &MacroUserIdStr<'static>,
        record: &ReviewRecord,
    ) -> Result<bool, CodeModeError> {
        if record.kind() != ReviewKind::Import {
            return Ok(true);
        }
        let report = self
            .import_report(account_holder, import_source(record)?)
            .await?;
        Ok(report.review_id == Some(record.id.0) && report.status == Some(RunStatus::Ready))
    }
    async fn send_email(
        &self,
        account_holder: &MacroUserIdStr<'static>,
        draft: &EmailDraft,
    ) -> Result<EmailResult, CodeModeError> {
        self.user_action(account_holder, "SendEmail", draft).await
    }
    async fn create_calendar_event(
        &self,
        account_holder: &MacroUserIdStr<'static>,
        draft: &CalendarDraft,
    ) -> Result<CalendarResult, CodeModeError> {
        self.user_action(account_holder, "CreateCalendarEvent", draft)
            .await
    }
    async fn start_import(
        &self,
        account_holder: &MacroUserIdStr<'static>,
        record: &ReviewRecord,
        draft: &ImportDraft,
    ) -> Result<ImportResult, CodeModeError> {
        let source = import::domain::models::ImportSource::from(draft.source);
        if source != import_source(record)? {
            return Err(CodeModeError::Invalid(
                "The import source cannot change after presentation.".into(),
            ));
        }
        self.import_service()?
            .start_workspace_write(
                account_holder,
                source,
                record.id.0,
                NotionWriteChoices {
                    excluded: draft.excluded.clone(),
                    shared: draft.shared.clone(),
                    personal: draft.personal.clone(),
                },
            )
            .await
            .map_err(|error| CodeModeError::Invalid(error.to_string()))
    }
    async fn present(
        &self,
        owner: &MacroUserIdStr<'static>,
        record: &ReviewRecord,
    ) -> Result<(), CodeModeError> {
        if record.kind() == ReviewKind::Import {
            // The plan is tied to the review before the card appears, so the
            // card never shows a plan it cannot approve.
            self.import_service()?
                .attach_workspace_review(owner, import_source(record)?, record.id.0, record.session_id)
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
                title: agent_session::domain::model::PRESENT_REVIEW_TITLE.into(),
                raw_input: serde_json::json!({"reviewId": record.id, "kind": record.kind(), "title": record.title}),
                raw_output: serde_json::json!({"reviewId": record.id, "message": "Presented to the user"}),
            },
        ).await.map_err(|_| CodeModeError::Invalid(format!("Review {} was saved, but presentation is pending. Read this review to retry presentation without creating another draft.", record.id.0)))
    }
    async fn announce_update(&self, record: &ReviewRecord) -> Result<(), CodeModeError> {
        let update = ReviewUpdatedNotification {
            review_id: record.id.0,
            revision: record.revision,
        };
        self.log
            .record_unprojected_frame(record.session_id, update.to_server_message())
            .await
            .map_err(|error| CodeModeError::Storage(rootcause::report!(error).into()))
    }
    async fn present_view(
        &self,
        owner: &MacroUserIdStr<'static>,
        session: agent_session::domain::model::AgentSessionId,
        view: &PresentedView,
    ) -> Result<(), CodeModeError> {
        self.harness
            .present_tool(
                session,
                owner.clone(),
                agent_session::domain::model::SessionToolPresentation {
                    tool_call_id: format!("view_{}", view.id),
                    title: agent_session::domain::model::PRESENT_VIEW_TITLE.into(),
                    raw_input: serde_json::json!({"view": view.view}),
                    // Readers render the decoded view from the result, as
                    // they do a DisplayResults result.
                    raw_output: serde_json::json!({"view": view.view}),
                },
            )
            .await
            .map_err(|_| {
                CodeModeError::Invalid(
                    "The view was not presented: the session could not take it. Present it again."
                        .into(),
                )
            })
    }
}

impl<S, L, H> Actions<S, L, H> {
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
        source: import::domain::models::ImportSource,
    ) -> Result<NotionImportReport, CodeModeError> {
        self.import_service()?
            .workspace_import_report(owner, source)
            .await
            .map_err(|error| {
                tracing::warn!(error = ?error, "could not read the notion import report");
                CodeModeError::Invalid("The import's report could not be read.".into())
            })
    }

    /// Run a user tool with a reviewed draft and decode its confirmed response.
    async fn user_action<Draft: Serialize, Response: DeserializeOwned>(
        &self,
        account_holder: &MacroUserIdStr<'static>,
        name: &str,
        draft: &Draft,
    ) -> Result<Response, CodeModeError> {
        let arguments = serde_json::to_value(draft)
            .map_err(|_| CodeModeError::Invalid("Could not submit the reviewed action.".into()))?;
        let mut context = self.context.clone();
        context.usage_context =
            ai_usage::UsageContext::new(ai_usage::AiFeature::AgentSession, account_holder.clone());
        let result = self
            .tools
            .try_user_tool_call(
                context,
                RequestContext::new(account_holder.clone()),
                name,
                &arguments,
            )
            .await
            .map_err(|_| CodeModeError::Invalid("Could not submit the reviewed action.".into()))?
            .map_err(|_| {
                CodeModeError::Invalid(
                    "The reviewed action did not return a confirmed outcome.".into(),
                )
            })?;
        match result {
            ai_toolset::tool_object::UserToolResponse::UserAction(value) => {
                serde_json::from_value(value).map_err(|_| {
                    tracing::warn!(
                        tool = name,
                        "reviewed action returned an unexpected response"
                    );
                    CodeModeError::Invalid(
                        "The reviewed action did not return a confirmed outcome.".into(),
                    )
                })
            }
            _ => Err(CodeModeError::Invalid(
                "The action was not completed.".into(),
            )),
        }
    }
}
