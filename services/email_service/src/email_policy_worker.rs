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
