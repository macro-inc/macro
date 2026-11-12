//! Re-importing Outlook folders whose delta round started at an older folder
//! reader revision (`FolderChangeReader::READER_REVISION`). Such a round may
//! have missed mail, and its saved deltaLink is already past it, so only a
//! fresh round lists it. Restarting a folder stream is the Outlook resync's
//! reset limited to those folders; ingest upserts, so mail already imported
//! is read again without effects. Run by the `reimport_outlook_folders`
//! binary; `docs/runbooks/outlook-folder-reimport.md` is the procedure.

use super::{MailboxError, MailboxKey, progress::log_import_started};
use futures::StreamExt as _;
use std::future::Future;
use std::time::{Duration, Instant};
use tracing::{Instrument as _, Span};
use uuid::Uuid;

#[cfg(test)]
mod test;

/// The folders one phase restarts. Inbox and Sent go first so the views
/// people read most fill in before the rest of the mailbox.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum ReimportPhase {
    InboxAndSent,
    OtherFolders,
}

/// Where a link stands at the current reader revision.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LinkReimport {
    NotOutlook,
    /// Sync is off or the link needs reauthorization, so nothing would import.
    Inactive,
    /// An import is running. A rerun takes the link once it finishes.
    Importing,
    /// Every folder stream's round started at the current revision.
    Current,
    /// Folder streams whose round started at an older revision, by phase.
    Due {
        mailbox: MailboxKey,
        inbox_and_sent: i64,
        other_folders: i64,
        /// Items Graph counts across the link's folders, when discovery has
        /// recorded them.
        provider_items: Option<i64>,
    },
}

/// How a restarted phase's import run stands.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PhaseProgress {
    /// The import run the restart opened is complete.
    Settled,
    Running,
    /// The link was disconnected, paused, reconnected or needs
    /// reauthorization, so this run will not finish.
    Interrupted,
}

/// How one restarted phase ended.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
enum PhaseEnd {
    /// Its state changed between the check and the restart.
    Changed,
    Settled,
    Interrupted,
}

/// What happened to one link.
#[derive(Debug, Clone, Copy, PartialEq, Eq, strum::IntoStaticStr)]
#[strum(serialize_all = "snake_case")]
pub enum LinkOutcome {
    NotOutlook,
    Inactive,
    Importing,
    Current,
    /// Its state changed between the check and the restart.
    Changed,
    /// Dry run: it is due and was left alone.
    Planned,
    Reimported,
    Interrupted,
}

/// Whether a run writes anything.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ReimportMode {
    Apply,
    /// Report what each link would do; no writes.
    Verify,
}

pub trait FolderReimportRepository: Send + Sync + 'static {
    /// Every Outlook link, oldest connection first.
    fn outlook_links(&self) -> impl Future<Output = Result<Vec<Uuid>, MailboxError>> + Send;
    fn link_reimport(
        &self,
        link_id: Uuid,
        revision: i16,
    ) -> impl Future<Output = Result<LinkReimport, MailboxError>> + Send;
    /// Starts a fresh round for the phase's folder streams whose round started
    /// before `revision`, queues the messages those folders already hold for a
    /// recheck, and opens a new import run, in one transaction under the
    /// link's lock. The mailbox-wide attachment recheck is armed only on the
    /// link's `last_phase`. `None` when the link is no longer this active
    /// generation, an import is running, or it has no folder catalog;
    /// otherwise how many streams restarted (a run opens only when some did).
    fn restart_folders(
        &self,
        mailbox: MailboxKey,
        phase: ReimportPhase,
        revision: i16,
        last_phase: bool,
    ) -> impl Future<Output = Result<Option<u64>, MailboxError>> + Send;
    fn phase_progress(
        &self,
        mailbox: MailboxKey,
    ) -> impl Future<Output = Result<PhaseProgress, MailboxError>> + Send;
}

/// Progress is logged every tenth check: every five minutes at the default
/// thirty-second interval.
const CHECKS_PER_PROGRESS_LOG: u32 = 10;

pub struct FolderReimportService<R> {
    repo: R,
    revision: i16,
    check_every: Duration,
}

impl<R: FolderReimportRepository> FolderReimportService<R> {
    pub fn new(repo: R, revision: i16) -> Self {
        Self {
            repo,
            revision,
            check_every: Duration::from_secs(30),
        }
    }

    /// The links to visit: `requested` in the order given, else every Outlook
    /// link, oldest connection first.
    pub async fn links(&self, requested: Option<Vec<Uuid>>) -> Result<Vec<Uuid>, MailboxError> {
        match requested {
            Some(links) => Ok(links),
            None => self.repo.outlook_links().await,
        }
    }

    /// Visits `links` in order, at most `concurrency` at a time; each finishes
    /// both phases before its slot takes the next link.
    pub async fn run(
        &self,
        links: Vec<Uuid>,
        concurrency: usize,
        mode: ReimportMode,
    ) -> Vec<(Uuid, Result<LinkOutcome, MailboxError>)> {
        futures::stream::iter(links)
            .map(|link_id| async move { (link_id, self.link(link_id, mode).await) })
            .buffer_unordered(concurrency.max(1))
            .collect()
            .await
    }

    async fn link(&self, link_id: Uuid, mode: ReimportMode) -> Result<LinkOutcome, MailboxError> {
        let span = tracing::info_span!(
            "outlook.reimport.link",
            mailbox.link_id = %link_id,
            outlook.reader_revision = self.revision,
            outlook.inbox_and_sent_streams = tracing::field::Empty,
            outlook.other_folder_streams = tracing::field::Empty,
            outlook.provider_item_count = tracing::field::Empty,
            outlook.reimport_outcome = tracing::field::Empty,
            otel.status_description = tracing::field::Empty,
        );
        let result = self.reimport(link_id, mode).instrument(span.clone()).await;
        match &result {
            Ok(outcome) => {
                let outcome: &'static str = outcome.into();
                span.record("outlook.reimport_outcome", outcome);
                tracing::info!(parent: &span, %link_id, outcome, "outlook folder reimport link done");
            }
            Err(error) => {
                span.record("outlook.reimport_outcome", "failed");
                span.record("otel.status_description", tracing::field::display(error));
                tracing::warn!(parent: &span, %link_id, error = %error, "outlook folder reimport link failed");
            }
        }
        result
    }

    async fn reimport(
        &self,
        link_id: Uuid,
        mode: ReimportMode,
    ) -> Result<LinkOutcome, MailboxError> {
        let (mailbox, inbox_and_sent, other_folders) =
            match self.repo.link_reimport(link_id, self.revision).await? {
                LinkReimport::NotOutlook => return Ok(LinkOutcome::NotOutlook),
                LinkReimport::Inactive => return Ok(LinkOutcome::Inactive),
                LinkReimport::Importing => return Ok(LinkOutcome::Importing),
                LinkReimport::Current => return Ok(LinkOutcome::Current),
                LinkReimport::Due {
                    mailbox,
                    inbox_and_sent,
                    other_folders,
                    provider_items,
                } => {
                    let span = Span::current();
                    span.record("outlook.inbox_and_sent_streams", inbox_and_sent);
                    span.record("outlook.other_folder_streams", other_folders);
                    span.record("outlook.provider_item_count", provider_items);
                    (mailbox, inbox_and_sent, other_folders)
                }
            };
        if mode == ReimportMode::Verify {
            return Ok(LinkOutcome::Planned);
        }
        for (phase, due, last_phase) in [
            (
                ReimportPhase::InboxAndSent,
                inbox_and_sent,
                other_folders == 0,
            ),
            (ReimportPhase::OtherFolders, other_folders, true),
        ] {
            if due == 0 {
                continue;
            }
            let phase_span = tracing::info_span!(
                "outlook.reimport.phase",
                mailbox.link_id = %link_id,
                outlook.reimport_phase = <&'static str>::from(phase),
                outlook.streams_restarted = tracing::field::Empty,
                outlook.phase_outcome = tracing::field::Empty,
            );
            let end = self
                .phase(mailbox, phase, last_phase)
                .instrument(phase_span.clone())
                .await?;
            phase_span.record("outlook.phase_outcome", <&'static str>::from(end));
            match end {
                PhaseEnd::Changed => return Ok(LinkOutcome::Changed),
                PhaseEnd::Interrupted => return Ok(LinkOutcome::Interrupted),
                PhaseEnd::Settled => {}
            }
        }
        Ok(LinkOutcome::Reimported)
    }

    /// Restarts one phase and waits for the import run it opened.
    async fn phase(
        &self,
        mailbox: MailboxKey,
        phase: ReimportPhase,
        last_phase: bool,
    ) -> Result<PhaseEnd, MailboxError> {
        let Some(restarted) = self
            .repo
            .restart_folders(mailbox, phase, self.revision, last_phase)
            .await?
        else {
            return Ok(PhaseEnd::Changed);
        };
        Span::current().record(
            "outlook.streams_restarted",
            i64::try_from(restarted).unwrap_or(i64::MAX),
        );
        if restarted == 0 {
            return Ok(PhaseEnd::Settled);
        }
        log_import_started(mailbox.link_id, mailbox.sync_generation);
        let phase_name: &'static str = phase.into();
        tracing::info!(
            link_id = %mailbox.link_id,
            phase = phase_name,
            streams = restarted,
            "outlook folder reimport phase started"
        );

        // The sync workers report a finished import run only by stamping its
        // completion on the folder catalog stream, and nothing reaches this
        // process when they do, so the stamp is read on an interval.
        // A phase can wait for hours, or for good while imports are paused or
        // a folder keeps failing, so the wait reports itself every few minutes.
        let started = Instant::now();
        let mut checks = tokio::time::interval(self.check_every);
        let mut checked: u32 = 0;
        loop {
            checks.tick().await;
            checked = checked.saturating_add(1);
            let end = match self.repo.phase_progress(mailbox).await? {
                PhaseProgress::Running => {
                    if checked % CHECKS_PER_PROGRESS_LOG == 0 {
                        tracing::info!(
                            link_id = %mailbox.link_id,
                            phase = phase_name,
                            seconds = started.elapsed().as_secs(),
                            "outlook folder reimport phase still importing"
                        );
                    }
                    continue;
                }
                PhaseProgress::Settled => PhaseEnd::Settled,
                PhaseProgress::Interrupted => PhaseEnd::Interrupted,
            };
            let end_name: &'static str = end.into();
            tracing::info!(
                link_id = %mailbox.link_id,
                phase = phase_name,
                end = end_name,
                seconds = started.elapsed().as_secs(),
                "outlook folder reimport phase ended"
            );
            return Ok(end);
        }
    }
}
