//! Admission at the turn-engine boundary, independent of harness dispatch.

use std::sync::Arc;

use agent::{AgentError, StreamPart};
use ai_billing::domain::AiAdmissionService;
use ai_usage::AiFeature;
use model_owner::Owner;
use tokio::sync::mpsc;
use tracing::Instrument as _;

use super::engine::{TurnEngine, TurnRequest};

#[cfg(test)]
pub(crate) mod test;

/// Checks the session owner's allowance before starting a billable turn.
/// An admitted turn runs to completion without further checks, including its
/// tool approvals. Model discovery does not require allowance.
/// Admission failures are terminal [`AgentError::Other`] items retaining a
/// downcastable [`ai_billing::domain::AiAdmissionError`], not a rendered string.
pub struct AdmissionCheckingTurnEngine {
    inner: Arc<dyn TurnEngine>,
    admission: Arc<dyn AiAdmissionService>,
}

impl AdmissionCheckingTurnEngine {
    /// Wrap an engine with the shared billing-domain admission port.
    pub fn new(inner: Arc<dyn TurnEngine>, admission: Arc<dyn AiAdmissionService>) -> Self {
        Self { inner, admission }
    }
}

impl TurnEngine for AdmissionCheckingTurnEngine {
    fn supported_models(&self) -> &[&str] {
        self.inner.supported_models()
    }

    fn run_turn(&self, request: TurnRequest) -> mpsc::Receiver<Result<StreamPart, AgentError>> {
        let (parts, receiver) = mpsc::channel(1);
        let inner = Arc::clone(&self.inner);
        let admission = Arc::clone(&self.admission);
        tokio::spawn(
            async move {
                let Owner::User(owner) = &request.owner else {
                    let _ = parts
                        .send(Err(AgentError::Other(anyhow::anyhow!(
                            "in-process turns run as the session owner, who must be a user; \
                         this session is owned by a {}",
                            request.owner.owner_type()
                        ))))
                        .await;
                    return;
                };
                let result = tokio::select! {
                    biased;
                    _ = request.cancel.cancelled() => return,
                    _ = parts.closed() => return,
                    result = admission.admit(owner, AiFeature::AgentSession) => result,
                };
                if let Err(error) = result {
                    // Keep the concrete type inside the engine port's existing
                    // error carrier so ACP can expose a stable public code.
                    let _ = parts.send(Err(AgentError::Other(error.into()))).await;
                    return;
                }
                let cancel = request.cancel.clone();
                let mut stream = inner.run_turn(request);
                loop {
                    let part = tokio::select! {
                        _ = parts.closed() => {
                            cancel.cancel();
                            break;
                        }
                        part = stream.recv() => part,
                    };
                    let Some(part) = part else { break };
                    let terminal = part.is_err();
                    if parts.send(part).await.is_err() {
                        cancel.cancel();
                        break;
                    }
                    if terminal {
                        break;
                    }
                }
            }
            .in_current_span(),
        );
        receiver
    }
}
