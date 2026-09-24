//! Admission for optional automatic session naming.

use super::model::AgentSession;
use super::ports::AgentSessionNameGenerator;
use ai_billing::domain::AiAdmissionService;
use ai_usage::domain::AiFeature;
use std::sync::Arc;

#[cfg(test)]
mod test;

/// Checks the session owner's allowance before invoking a model-backed namer.
/// Quota denial or unavailable billing skips this optional work rather than
/// failing the session or replacing its default name.
#[derive(Clone)]
pub struct AdmissionCheckingAgentSessionNameGenerator<N> {
    inner: N,
    admission: Arc<dyn AiAdmissionService>,
}

impl<N> AdmissionCheckingAgentSessionNameGenerator<N> {
    /// Wrap a name generator with the shared admission service.
    pub fn new(inner: N, admission: Arc<dyn AiAdmissionService>) -> Self {
        Self { inner, admission }
    }
}

impl<N: AgentSessionNameGenerator> AgentSessionNameGenerator
    for AdmissionCheckingAgentSessionNameGenerator<N>
{
    async fn generate_name(
        &self,
        session: &AgentSession,
        initial_prompt: &str,
    ) -> Result<Option<String>, rootcause::Report> {
        let owner = session
            .owner_user()
            .map_err(|error| rootcause::report!(error))?;
        if let Err(error) = self.admission.admit(owner, AiFeature::ChatRename).await {
            tracing::warn!(error = ?error, session_id = %session.id, "skipping automatic session naming: admission refused");
            return Ok(None);
        }
        self.inner.generate_name(session, initial_prompt).await
    }
}
