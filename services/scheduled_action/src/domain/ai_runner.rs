//! One owner-billed admission per scheduled job, before any chat or agent work.

use std::sync::Arc;

use ai_billing::domain::AiAdmissionService;
use ai_usage::AiFeature;
use anyhow::Result;

use super::{event_trigger::EventReference, models::ScheduledAction, ports::ScheduledAgentRunner};

#[cfg(test)]
pub(crate) mod test;

/// Decorates the shared preparation boundary used by cron, manual and event runs.
/// The executor must prepare the chat before running the agent. Admission is not
/// repeated within the admitted job's agent loop.
pub struct AdmittedScheduledAgentRunner<R> {
    inner: R,
    admission: Arc<dyn AiAdmissionService>,
}

impl<R> AdmittedScheduledAgentRunner<R> {
    pub fn new(inner: R, admission: Arc<dyn AiAdmissionService>) -> Self {
        Self { inner, admission }
    }
}

impl<R: ScheduledAgentRunner> ScheduledAgentRunner for AdmittedScheduledAgentRunner<R> {
    async fn create_chat(&self, action: &ScheduledAction) -> Result<String> {
        self.admission
            .admit(action.owner_user()?, AiFeature::Automation)
            .await?;
        self.inner.create_chat(action).await
    }

    async fn run(
        &self,
        action: &ScheduledAction,
        chat_id: &str,
        event: Option<&EventReference>,
    ) -> Result<()> {
        self.inner.run(action, chat_id, event).await
    }
}
