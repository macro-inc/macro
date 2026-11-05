//! A view is a review with nothing saved: presented the same way, to the same
//! session, but with no record, no decision and nothing to read back. The
//! presented `PresentView` call is the view's only record.
use super::{ReviewService, invalid};
use crate::domain::{CodeModeError, ExecutionId};
use agent_session::domain::model::AgentSessionId;
use dynamic_ui::View;
use entity_access::domain::models::{EditAccessLevel, EntityAccessReceipt};
use macro_user_id::user_id::MacroUserIdStr;
use macro_uuid::Uuid;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use utoipa::ToSchema;

/// Largest view presented, serialized. A view is the model's own arguments,
/// stored with the session and with any message it is posted in; one this
/// large is a runaway.
const MAX_VIEW_BYTES: usize = 32 * 1024;

/// A view to present.
#[derive(Debug, Clone, Deserialize, Serialize, ToSchema)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PresentView {
    /// A dynamic-UI view, in the format of the PresentView schema in
    /// ExecuteCode's description.
    #[schema(value_type = Object)]
    pub view: Value,
    /// The code execution presenting it, when one does.
    #[serde(default)]
    pub execution_id: Option<ExecutionId>,
}

/// A checked view as it is presented.
#[derive(Debug, Clone, PartialEq)]
pub struct PresentedView {
    /// Identifies the presented call, so a retried frame is not drawn twice.
    pub id: Uuid,
    /// The view, decoded.
    pub view: View,
}

impl ReviewService {
    /// Present a view through the session's edit capability, as code does.
    pub async fn present_view(
        &self,
        access: &EntityAccessReceipt<EditAccessLevel>,
        actor: &MacroUserIdStr<'static>,
        input: PresentView,
    ) -> Result<(), CodeModeError> {
        let session = self.authorize(access, actor).await?;
        self.present_view_owned(session, input).await
    }

    /// The span records how big the view was and whether it decoded, never
    /// what it holds.
    #[tracing::instrument(
        name = "view.present",
        skip_all,
        fields(
            session_id = %session,
            from_code = input.execution_id.is_some(),
            view_bytes = tracing::field::Empty,
            decoded = tracing::field::Empty,
        ),
        err
    )]
    async fn present_view_owned(
        &self,
        session: AgentSessionId,
        input: PresentView,
    ) -> Result<(), CodeModeError> {
        if let Some(execution) = input.execution_id {
            self.executions.get(session, execution).await?;
        }
        let size = serde_json::to_vec(&input.view)
            .map_err(|_| invalid())?
            .len();
        tracing::Span::current().record("view_bytes", size);
        if size > MAX_VIEW_BYTES {
            return Err(CodeModeError::Invalid(format!(
                "The view was not presented: it is {size} bytes, over the {MAX_VIEW_BYTES}-byte limit. Present fewer widgets."
            )));
        }
        let view = dynamic_ui::decode_view(&input.view);
        tracing::Span::current().record("decoded", view.is_ok());
        let view = view.map_err(|problem| {
            CodeModeError::Invalid(format!(
                "The view was not presented: it does not match the PresentView schema. {problem}. Fix it and present the whole view again."
            ))
        })?;
        // As for a review, presentation writes the session transcript, whose
        // capability belongs to the session owner.
        let owner = self.owner(session).await?;
        self.actions
            .present_view(
                &owner,
                session,
                &PresentedView {
                    id: macro_uuid::generate_uuid_v7(),
                    view,
                },
            )
            .await
    }
}
