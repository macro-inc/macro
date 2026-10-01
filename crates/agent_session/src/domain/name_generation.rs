//! Optional naming is independently admitted, never a prerequisite for runtime execution.

use std::sync::Arc;

use ai_billing::{AiAdmissionService, AiFeature};

use super::{model::AgentSession, ports::AgentSessionNameGenerator};

#[cfg(test)]
mod test;

/// Admits Macro-funded naming while leaving the existing session name on refusal.
#[derive(Clone)]
pub struct AdmittedAgentSessionNameGenerator<N> {
    generator: N,
    admission: Arc<dyn AiAdmissionService>,
}

impl<N> AdmittedAgentSessionNameGenerator<N> {
    /// Wrap a name generator with the host's configured admission service.
    pub fn new(generator: N, admission: Arc<dyn AiAdmissionService>) -> Self {
        Self {
            generator,
            admission,
        }
    }
}

impl<N: AgentSessionNameGenerator> AgentSessionNameGenerator
    for AdmittedAgentSessionNameGenerator<N>
{
    async fn generate_name(
        &self,
        session: &AgentSession,
        initial_prompt: &str,
    ) -> Result<Option<String>, rootcause::Report> {
        // Naming must not invent a billing identity for a non-user owner.
        let Ok(owner) = session.owner_user() else {
            return Ok(None);
        };
        if let Err(error) = self.admission.admit(owner, AiFeature::ChatRename).await {
            tracing::debug!(code = error.code(), "skipping optional session naming");
            return Ok(None);
        }
        self.generator.generate_name(session, initial_prompt).await
    }
}
