//! Workflow tools over the Forms domain; interactive sharing uses native user-tool review.
use crate::domain::authoring::{AuthoringError, ports::FormsAuthoringService};
use ai_toolset::{AsyncToolCollection, ToolCallError};
use bot_id::BotId;
use databases::domain::models::Viewer;
use macro_user_id::user_id::MacroUserIdStr;
use std::sync::Arc;

mod create_form;
mod edit_form;
mod list_forms;
mod read_form;
mod set_form_access;
#[cfg(test)]
mod test;

pub use create_form::CreateForm;
pub use edit_form::EditForm;
pub use list_forms::ListForms;
pub use read_form::ReadForm;
pub use set_form_access::SetFormAccess;

/// An authorized workflow service plus agent attribution, shared by every tool host.
pub struct FormsToolContext<Service> {
    /// Forms owns authorization, validation and all mutation orchestration.
    pub service: Arc<Service>,
    /// The agent acting for the requesting user; never an authorization substitute.
    pub actor: BotId,
}
impl<Service> Clone for FormsToolContext<Service> {
    fn clone(&self) -> Self {
        Self {
            service: self.service.clone(),
            actor: self.actor,
        }
    }
}
impl<Service> FormsToolContext<Service> {
    fn viewer(&self, user_id: MacroUserIdStr<'static>) -> Viewer {
        Viewer {
            user_id,
            acting_bot: Some(self.actor),
        }
    }
}
fn tool_error(error: AuthoringError) -> ToolCallError {
    ToolCallError {
        description: error.to_string(),
        internal_error: anyhow::Error::new(error),
    }
}
/// Draft workflows shared by main and delegated agents. Sharing is a separate review.
pub fn authoring_toolset<Service: FormsAuthoringService>()
-> AsyncToolCollection<FormsToolContext<Service>> {
    AsyncToolCollection::new()
        .add_tool::<CreateForm, FormsToolContext<Service>>()
        .add_tool::<ReadForm, FormsToolContext<Service>>()
        .add_tool::<EditForm, FormsToolContext<Service>>()
        .add_tool::<ListForms, FormsToolContext<Service>>()
}
/// Chat and agent-session sharing waits for the actual native review card.
pub fn forms_toolset<Service: FormsAuthoringService>()
-> AsyncToolCollection<FormsToolContext<Service>> {
    authoring_toolset().add_user_tool::<SetFormAccess, FormsToolContext<Service>>()
}
/// Headless hosts apply their own confirmation policy and execute a real access workflow.
pub fn direct_toolset<Service: FormsAuthoringService>()
-> AsyncToolCollection<FormsToolContext<Service>> {
    authoring_toolset().add_tool::<SetFormAccess, FormsToolContext<Service>>()
}
