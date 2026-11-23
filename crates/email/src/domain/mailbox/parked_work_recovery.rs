//! Bounded recovery of locally parked mailbox work after a mailbox reactivation.
use super::MailboxError;
use std::future::Future;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ParkedWorkRecoveryPage {
    pub links_scanned: u32,
    pub rows_unparked: u32,
    pub failed_probes: u32,
    pub complete: bool,
}

pub trait ParkedWorkRecoveryRepository: Send + Sync + 'static {
    /// A short transaction owns the singleton cursor lock for this page.
    /// Inactive links consume one indexed probe, independent of their backlog.
    fn recover_page(
        &self,
        limit: u32,
    ) -> impl Future<Output = Result<Option<ParkedWorkRecoveryPage>, MailboxError>> + Send;
}

pub struct ParkedWorkRecoveryService<R>(pub R);

impl<R: ParkedWorkRecoveryRepository> ParkedWorkRecoveryService<R> {
    #[tracing::instrument(skip_all, name = "email.mailbox.unpark_page", fields(
        mailbox.links_scanned = tracing::field::Empty,
        mailbox.rows_unparked = tracing::field::Empty,
        mailbox.cycle_complete = tracing::field::Empty,
        mailbox.no_progress = tracing::field::Empty,
        mailbox.failed_probes = tracing::field::Empty,
        mailbox.consecutive_skips = tracing::field::Empty,
    ), err)]
    pub async fn tick(
        &self,
        limit: u32,
        consecutive_skips: u32,
    ) -> Result<Option<ParkedWorkRecoveryPage>, MailboxError> {
        let result = self.0.recover_page(limit.clamp(1, 64)).await;
        let failed_probes = result
            .as_ref()
            .ok()
            .and_then(|page| *page)
            .map_or(0, |page| page.failed_probes);
        let span = tracing::Span::current();
        span.record("mailbox.no_progress", result.is_err() || failed_probes > 0);
        span.record(
            "mailbox.consecutive_skips",
            consecutive_skips.saturating_add(failed_probes),
        );
        let page = result?;
        if let Some(page) = page {
            let span = tracing::Span::current();
            span.record("mailbox.links_scanned", page.links_scanned);
            span.record("mailbox.rows_unparked", page.rows_unparked);
            span.record("mailbox.cycle_complete", page.complete);
            span.record("mailbox.failed_probes", page.failed_probes);
        }
        Ok(page)
    }
}
