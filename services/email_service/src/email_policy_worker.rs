//! Bounded live-record reconciliation, independent of mailbox import workers.
use crm::domain::email_policy_work::EmailPolicyWorkService;

/// Process at most one reverse-reference page per poll; idle polls create no span.
pub async fn run<C: EmailPolicyWorkService>(
    service: C,
    cancellation: tokio_util::sync::CancellationToken,
) {
    loop {
        if cancellation.is_cancelled() {
            return;
        }
        if let Err(error) = service.reconcile_source_page().await {
            tracing::error!(error = ?error, "failed to reconcile CRM email policy source");
        }
        tokio::select! {
            _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {}
            _ = cancellation.cancelled() => return,
        }
    }
}

/// Preview work has its own loop so a bounded count never delays live-source
/// reconciliation. Cancellation leaves the durable lease for a later retry.
pub async fn run_previews<C: crm::domain::email_policy_preview::EmailPreviewWorkService>(
    service: C,
    cancellation: tokio_util::sync::CancellationToken,
) {
    loop {
        tokio::select! {
            _ = cancellation.cancelled() => return,
            result = service.process_email_preview() => {
                if let Err(error) = result {
                    tracing::error!(error = ?error, "failed to count CRM email contribution preview");
                }
            }
        }
        tokio::select! {
            _ = cancellation.cancelled() => return,
            _ = tokio::time::sleep(std::time::Duration::from_secs(5)) => {}
        }
    }
}
