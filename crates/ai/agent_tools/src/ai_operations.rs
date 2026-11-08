//! Admission for independently initiated AI work, including direct tool calls.

use ai_billing::domain::admission::{AiAdmissionError, AiAdmissionService};
use ai_usage::UsageContext;
use std::{future::Future, sync::Arc};

#[cfg(test)]
mod test;

/// A refused operation is distinct from a provider failure.
#[derive(Debug, thiserror::Error)]
pub enum AiOperationError {
    /// No provider work was started.
    #[error("{0}")]
    Admission(#[from] AiAdmissionError),
    /// An admitted operation failed during execution.
    #[error(transparent)]
    Execution(#[from] anyhow::Error),
}

/// Runs independent AI operations only after admission for their trusted caller.
#[derive(Clone)]
pub struct AiOperations {
    admission: Arc<dyn AiAdmissionService>,
}

impl AiOperations {
    /// Use the host's configured admission service.
    pub fn new(admission: Arc<dyn AiAdmissionService>) -> Self {
        Self { admission }
    }

    /// Admit before constructing or polling provider work. `usage` must carry
    /// the authenticated caller, not a shared context's placeholder identity.
    pub async fn run<T, F: Future<Output = anyhow::Result<T>>>(
        &self,
        usage: &UsageContext,
        execute: impl FnOnce() -> F,
    ) -> Result<T, AiOperationError> {
        self.admission.admit(&usage.user, usage.feature).await?;
        Ok(execute().await?)
    }
}
