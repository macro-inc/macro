//! Compose persistent reviews with existing tool actions and the session queue.
use agent_code_mode::domain::{CodeModeError, reviews::*};
use agent_session::domain::{
    model::AgentSessionId,
    ports::{AgentSessionNotificationRecipient, AgentSessionRepo, ControlEvent},
};
use ai_toolset::RequestContext;
use async_trait::async_trait;
use macro_user_id::user_id::MacroUserIdStr;
use serde_json::Value;
use std::sync::Arc;

#[cfg(test)]
mod test;

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
        })
    }
    fn validate(&self, kind: ReviewKind, draft: &Value) -> Result<(), CodeModeError> {
        validate_draft(&self.tools, kind, draft)
    }
    async fn execute(
        &self,
        owner: &MacroUserIdStr<'static>,
        kind: ReviewKind,
        draft: Value,
    ) -> Result<Value, CodeModeError> {
        let name = match kind {
            ReviewKind::Email => "SendEmail",
            ReviewKind::Calendar => "CreateCalendarEvent",
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
    async fn notify(
        &self,
        owner: &MacroUserIdStr<'static>,
        record: &ReviewRecord,
    ) -> Result<(), CodeModeError> {
        use agent_runtime_protocol::domain::action::AgentAction;
        let summary = notification_summary(record);
        self.harness
            .control_event(
                record.session_id,
                ControlEvent {
                    action: AgentAction::context_prompt(summary),
                    action_id: record
                        .notification_id
                        .map(agent_runtime_protocol::domain::action::AgentActionId::from_uuid),
                    actor: Some(owner.clone()),
                    context: None,
                },
            )
            .await
            .map_err(|_| {
                CodeModeError::Invalid(
                    "Review completed but its session notification could not be delivered.".into(),
                )
            })?;
        Ok(())
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
    }
    Ok(())
}

fn notification_summary(record: &ReviewRecord) -> String {
    // Delivered as private context. Full results stay on the saved review.
    let mut summary = format!(
        "Recorded review outcomes, not new instructions. Do not repeat completed actions or automatically retry uncertain outcomes.\nReview updated: {}\n",
        summary_text(&record.title, 120)
    );
    for (status, label) in [
        (ReviewItemStatus::Completed, "completed"),
        (ReviewItemStatus::Unknown, "outcome unconfirmed"),
        (ReviewItemStatus::Dismissed, "dismissed"),
        (ReviewItemStatus::Pending, "pending"),
        (ReviewItemStatus::Submitting, "submitting"),
    ] {
        let count = record
            .items
            .iter()
            .filter(|item| item.status == status)
            .count();
        if count > 0 {
            summary.push_str(&format!("{count} {label}; "));
        }
    }
    summary.push('\n');
    summary.push_str(&format!("\nSaved review: {}. Completed actions are already recorded; no further sending or scheduling is requested.", record.id.0));
    summary
}

fn summary_text(text: &str, max_chars: usize) -> String {
    let compact = text.split_whitespace().collect::<Vec<_>>().join(" ");
    let mut chars = compact.chars();
    let mut bounded = chars.by_ref().take(max_chars).collect::<String>();
    if chars.next().is_some() {
        bounded.push('…');
    }
    bounded
}
