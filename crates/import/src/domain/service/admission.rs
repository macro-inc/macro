//! Admission at the boundary between deterministic imports and AI execution.

use super::{ImportError, ImportServiceImpl, MacroUserIdStr, Result};
use ai_billing::domain::AiAdmissionError;

impl<R, S, C> ImportServiceImpl<R, S, C> {
    /// Try deterministic work first, when available. One admission covers the
    /// entire AI future, including provider fallbacks; a refusal never polls it.
    pub(super) async fn direct_or_ai<D, A>(
        &self,
        user: &MacroUserIdStr<'static>,
        direct: Option<D>,
        ai: A,
    ) -> Result<()>
    where
        D: Future<Output = anyhow::Result<()>>,
        A: Future<Output = anyhow::Result<()>>,
    {
        if let Some(direct) = direct {
            match direct.await {
                Ok(()) => return Ok(()),
                Err(error) => {
                    tracing::info!(error = ?error, "direct import operation failed; trying AI");
                }
            }
        }
        self.admission
            .admit(user, ai_usage::AiFeature::Import)
            .await?;
        ai.await.map_err(ImportError::from)
    }
}

/// Durable failures include a stable public admission code, never the internal
/// billing diagnostic. Existing non-admission failures retain their detail.
pub(super) fn failure_reason(error: &ImportError) -> String {
    match error {
        ImportError::Admission(AiAdmissionError::Denied(reason)) => {
            format!("{}: {}", reason.code(), reason.message())
        }
        ImportError::Admission(error @ AiAdmissionError::Unavailable(_)) => {
            format!("ai_billing_unavailable: {error}")
        }
        error => error.to_string(),
    }
}
