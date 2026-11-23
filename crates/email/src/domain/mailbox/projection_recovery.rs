//! Bounded recovery of locally parked projections after a mailbox reactivation.
use super::MailboxError;
use std::future::Future;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProjectionRecoveryPage {
    pub links_scanned: u32,
    pub rows_unparked: u32,
    pub failed_probes: u32,
    pub complete: bool,
}

pub trait ProjectionRecoveryRepository: Send + Sync + 'static {
    /// A short transaction owns the singleton cursor lock for this page.
    /// Inactive links consume one indexed probe, independent of their backlog.
    fn recover_page(
        &self,
        limit: u32,
    ) -> impl Future<Output = Result<Option<ProjectionRecoveryPage>, MailboxError>> + Send;
}

pub struct ProjectionRecoveryService<R>(pub R);

impl<R: ProjectionRecoveryRepository> ProjectionRecoveryService<R> {
    #[tracing::instrument(skip_all, name = "email.projection.unpark_page", fields(
        projection.links_scanned = tracing::field::Empty,
        projection.rows_unparked = tracing::field::Empty,
        projection.cycle_complete = tracing::field::Empty,
        projection.no_progress = tracing::field::Empty,
        projection.failed_probes = tracing::field::Empty,
        projection.consecutive_skips = tracing::field::Empty,
    ), err)]
    pub async fn tick(
        &self,
        limit: u32,
        consecutive_skips: u32,
    ) -> Result<Option<ProjectionRecoveryPage>, MailboxError> {
        let result = self.0.recover_page(limit.clamp(1, 64)).await;
        let failed_probes = result
            .as_ref()
            .ok()
            .and_then(|page| *page)
            .map_or(0, |page| page.failed_probes);
        let span = tracing::Span::current();
        span.record(
            "projection.no_progress",
            result.is_err() || failed_probes > 0,
        );
        span.record(
            "projection.consecutive_skips",
            consecutive_skips.saturating_add(failed_probes),
        );
        let page = result?;
        if let Some(page) = page {
            let span = tracing::Span::current();
            span.record("projection.links_scanned", page.links_scanned);
            span.record("projection.rows_unparked", page.rows_unparked);
            span.record("projection.cycle_complete", page.complete);
            span.record("projection.failed_probes", page.failed_probes);
        }
        Ok(page)
    }
}
