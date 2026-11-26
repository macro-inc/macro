//! Fills the list-aware directory from what Macro already knows, and audits
//! the legacy graph it replaces.
//!
//! - Inbox lists: each legacy edge direction whose owner has an inbox that
//!   knows the contact becomes a row for that inbox. The reverse direction of
//!   an import is not copied.
//! - Interacted: every two Macro members of a shared channel (not a DM, not a
//!   signup support channel) whose memberships overlapped, the people the
//!   April 2026 snapshot (`contacts_backfill_outbox`) lists together, and the
//!   two people of every DM with a message from one of them.
//! - Teammates are computed at read time, so nothing is written for them.
//! - Orphans: list rows whose owner has no account, and `interacted` rows
//!   naming someone with none, are deleted. Account deletion removes rows only
//!   once `contacts-list-writes` is on, and referral invites wrote `invited`
//!   rows before that.
//!
//! Writes go through [`ContactListRepository`], which is idempotent, so a run
//! can be repeated or resumed from the start. Nothing is notified: clients
//! read these lists only after the read cutover, and pick them up by scan.

pub mod audit;
pub mod channels;

#[cfg(test)]
mod test;

use crate::domain::models::backfill::{InboxOwner, OrphanKind};
use crate::domain::models::list::InboxSource;
use crate::domain::ports::{ContactListRepository, LegacyDirectorySource, OrphanedListRows};
use crate::domain::service::remove_deleted_accounts;
use audit::{InteractedProjection, LegacyAudit};
use channels::{ChannelDirectory, ChannelLoader, InteractionWrite};
use chrono::{DateTime, Utc};
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use serde::Serialize;
use std::collections::{BTreeMap, BTreeSet, HashMap, HashSet};
use std::time::Duration;
use tracing::Instrument;
use uuid::Uuid;

/// Contacts per inbox write, the producers' chunk.
const CONTACTS_PER_INBOX_WRITE: usize = 500;

/// Writes between pauses.
const WRITES_PER_PAUSE: u64 = 100;

/// Failed ids a report names; the rest are counted.
const FAILURES_NAMED: usize = 100;

/// Rows per orphan delete.
const ORPHAN_ROWS_PER_DELETE: i64 = 5000;

/// Page sizes, pacing and the support roster.
#[derive(Clone, Debug)]
pub struct BackfillSettings {
    /// Channels, snapshot rows, DMs and inbox owners per read.
    pub page_size: i64,
    /// Legacy edges per audit read.
    pub edge_page_size: i64,
    /// One owner's legacy contacts per inbox read.
    pub contact_page_size: i64,
    /// Rest between reads, and after every hundred writes, so a run leaves
    /// the database room for live traffic.
    pub pause: Duration,
    /// Addresses added to every signup support channel, past and present. A
    /// private channel named `Macro Support x …` holding one is a support
    /// channel.
    pub support_roster: HashSet<MacroUserIdStr<'static>>,
}

/// One part of the backfill.
#[derive(Clone, Copy, Debug, Eq, Ord, PartialEq, PartialOrd, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum BackfillPass {
    /// Delete rows left by deleted accounts.
    Orphans,
    /// `interacted` from shared channels and the snapshot.
    Channels,
    /// `interacted` from DMs with a message.
    DirectMessages,
    /// `gmail`, `outlook` and `imap` from legacy edges and inboxes.
    Inbox,
}

/// What to backfill.
#[derive(Clone, Debug)]
pub struct BackfillRequest {
    /// The passes to run.
    pub passes: BTreeSet<BackfillPass>,
    /// Read and count, but write nothing.
    pub dry_run: bool,
    /// Only re-derive from sources stamped at or after this: channel joins
    /// and DM messages. Snapshots taken before it are skipped. The inbox pass
    /// has no time index to narrow by and always reads every legacy edge.
    pub after: Option<DateTime<Utc>>,
}

/// What was loaded from channels.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct LoadedChannels {
    /// Shared channels: not DMs, not support channels.
    pub shared: u64,
    /// Signup support channels, never paired.
    pub support: u64,
    /// DMs.
    pub direct_messages: u64,
    /// DMs with a message from a person (since `after`, in a backfill).
    pub direct_messages_with_message: u64,
    /// Macro participant rows.
    pub participant_rows: u64,
    /// Snapshot rows for shared channels.
    pub snapshot_rows: u64,
}

impl LoadedChannels {
    fn new(channels: &ChannelDirectory) -> Self {
        let (shared, support, direct_messages, direct_messages_with_message) =
            channels.channel_counts();
        let (participant_rows, snapshot_rows) = channels.member_counts();
        Self {
            shared,
            support,
            direct_messages,
            direct_messages_with_message,
            participant_rows,
            snapshot_rows,
        }
    }
}

/// One orphan sweep.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct OrphanSweep {
    /// Owners or contacts read.
    pub scanned: u64,
    /// Those with no account and rows of this kind.
    pub orphans: u64,
    /// Their rows.
    pub rows: u64,
    /// Rows deleted; zero in a dry run or an audit.
    pub deleted_rows: u64,
}

/// The audit, made before anything is written.
#[derive(Clone, Debug, Serialize)]
pub struct AuditReport {
    /// Rows left by deleted accounts, by kind; nothing is deleted.
    pub orphans: BTreeMap<OrphanKind, OrphanSweep>,
    /// What was loaded from channels.
    pub channels: LoadedChannels,
    /// Projected `interacted` rows.
    pub interacted: InteractedProjection,
    /// The legacy graph by class.
    pub legacy: LegacyAudit,
}

/// Writes made by one pass.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct WriteCounts {
    /// Repository calls made, or that would be made in a dry run.
    pub writes: u64,
    /// Rows those calls could add, before conflicts.
    pub attempted_rows: u64,
    /// Rows added; zero in a dry run.
    pub added_rows: u64,
    /// Calls that failed and were skipped.
    pub failed_writes: u64,
    /// The first channels or inboxes whose writes failed, to rerun.
    pub failed: Vec<String>,
}

impl WriteCounts {
    fn fail(&mut self, id: String) {
        self.failed_writes += 1;
        if self.failed.len() < FAILURES_NAMED {
            self.failed.push(id);
        }
    }
}

/// The inbox pass.
#[derive(Clone, Debug, Default, Eq, PartialEq, Serialize)]
pub struct InboxCounts {
    /// Inbox owners read.
    pub owners: u64,
    /// Their inboxes.
    pub inboxes: u64,
    /// Owners whose id is not a Macro user id.
    pub invalid_owners: u64,
    /// Legacy contacts read, both directions.
    pub legacy_contacts: u64,
    /// Writes.
    pub written: WriteCounts,
}

/// The backfill's outcome.
#[derive(Clone, Debug, Serialize)]
pub struct BackfillReport {
    /// Nothing was written.
    pub dry_run: bool,
    /// The `after` bound, if any.
    pub after: Option<DateTime<Utc>>,
    /// The passes run.
    pub passes: BTreeSet<BackfillPass>,
    /// The orphan pass, by kind.
    pub orphans: Option<BTreeMap<OrphanKind, OrphanSweep>>,
    /// What was loaded from channels, when a channel or DM pass ran.
    pub channels: Option<LoadedChannels>,
    /// The channel pass.
    pub interacted_from_channels: Option<WriteCounts>,
    /// The DM pass.
    pub interacted_from_direct_messages: Option<WriteCounts>,
    /// The inbox pass.
    pub inbox: Option<InboxCounts>,
}

/// Runs the backfill and the audit.
pub struct DirectoryBackfill<S, L> {
    /// Reads the legacy directory and its sources.
    pub source: S,
    /// Writes the lists.
    pub lists: L,
    /// Page sizes, pacing and the support roster.
    pub settings: BackfillSettings,
}

impl<S, L> DirectoryBackfill<S, L>
where
    S: LegacyDirectorySource + OrphanedListRows,
    L: ContactListRepository,
{
    async fn pause(&self) {
        if !self.settings.pause.is_zero() {
            tokio::time::sleep(self.settings.pause).await;
        }
    }

    /// Load every channel's Macro members, the snapshot, and which DMs have
    /// a message from a person (sent at or after `since`).
    async fn load_channels(
        &self,
        since: Option<DateTime<Utc>>,
    ) -> Result<ChannelDirectory, Report> {
        let page_size = self.settings.page_size;
        let mut loader = ChannelLoader::default();

        let mut cursor = Uuid::nil();
        loop {
            let channels = self.source.channel_page(cursor, page_size).await?;
            let Some(last) = channels.last() else {
                break;
            };
            cursor = last.id;
            let full = channels.len() as i64 == page_size;

            let ids: Vec<Uuid> = channels.iter().map(|channel| channel.id).collect();
            let members = self.source.channel_members(&ids).await?;
            loader.add_channels(channels, members, &self.settings.support_roster);
            if !full {
                break;
            }
            self.pause().await;
        }

        let mut cursor = 0;
        loop {
            let snapshots = self.source.snapshot_page(cursor, page_size).await?;
            let Some(last) = snapshots.last() else {
                break;
            };
            cursor = last.id;
            let full = snapshots.len() as i64 == page_size;
            loader.add_snapshots(snapshots);
            if !full {
                break;
            }
            self.pause().await;
        }

        let direct_messages = loader.direct_message_ids();
        for page in direct_messages.chunks(page_size.max(1) as usize) {
            let sent = self
                .source
                .direct_messages_with_person_message(page, since)
                .await?;
            loader.mark_person_messages(&sent);
            self.pause().await;
        }

        Ok(loader.finish())
    }

    /// Classify every legacy edge direction and project `interacted` rows.
    /// Reads only.
    pub async fn audit(&self) -> Result<AuditReport, Report> {
        let orphans = self
            .sweep_orphans(true)
            .instrument(tracing::info_span!("contacts.backfill.orphans"))
            .await?;
        let channels = self
            .load_channels(None)
            .instrument(tracing::info_span!("contacts.backfill.load_channels"))
            .await?;
        let interacted = InteractedProjection::new(&channels);

        let mut legacy = LegacyAudit::default();
        let mut cursor = 0;
        loop {
            let span = tracing::info_span!("contacts.backfill.audit_page", after_edge = cursor);
            let edges = self
                .source
                .legacy_edge_page(cursor, self.settings.edge_page_size)
                .instrument(span)
                .await?;
            let Some(last) = edges.last() else {
                break;
            };
            cursor = last.id;
            for edge in &edges {
                legacy.add_edge(edge, &channels);
            }
            if (edges.len() as i64) < self.settings.edge_page_size {
                break;
            }
            self.pause().await;
        }

        Ok(AuditReport {
            orphans,
            channels: LoadedChannels::new(&channels),
            interacted,
            legacy,
        })
    }

    /// Run the requested passes.
    pub async fn backfill(&self, request: &BackfillRequest) -> Result<BackfillReport, Report> {
        let mut report = BackfillReport {
            dry_run: request.dry_run,
            after: request.after,
            passes: request.passes.clone(),
            orphans: None,
            channels: None,
            interacted_from_channels: None,
            interacted_from_direct_messages: None,
            inbox: None,
        };

        if request.passes.contains(&BackfillPass::Orphans) {
            let orphans = self
                .sweep_orphans(request.dry_run)
                .instrument(tracing::info_span!("contacts.backfill.orphans"))
                .await?;
            report.orphans = Some(orphans);
        }

        let wants_channels = request.passes.contains(&BackfillPass::Channels);
        let wants_direct_messages = request.passes.contains(&BackfillPass::DirectMessages);
        if wants_channels || wants_direct_messages {
            let channels = self
                .load_channels(request.after)
                .instrument(tracing::info_span!("contacts.backfill.load_channels"))
                .await?;
            report.channels = Some(LoadedChannels::new(&channels));

            if wants_channels {
                let writes = channels.interaction_writes(request.after).flatten();
                let counts = self
                    .write_interactions(&channels, writes, request.dry_run)
                    .instrument(tracing::info_span!("contacts.backfill.channels"))
                    .await;
                report.interacted_from_channels = Some(counts);
            }

            if wants_direct_messages {
                let writes = channels.direct_message_writes().into_iter();
                let counts = self
                    .write_interactions(&channels, writes, request.dry_run)
                    .instrument(tracing::info_span!("contacts.backfill.direct_messages"))
                    .await;
                report.interacted_from_direct_messages = Some(counts);
            }
        }

        if request.passes.contains(&BackfillPass::Inbox) {
            let counts = self
                .backfill_inbox(request.dry_run)
                .instrument(tracing::info_span!("contacts.backfill.inbox"))
                .await?;
            report.inbox = Some(counts);
        }

        Ok(report)
    }

    /// Page through every list owner, inbox owner and listed contact, and
    /// delete the rows of those with no account, in bounded deletes.
    async fn sweep_orphans(
        &self,
        dry_run: bool,
    ) -> Result<BTreeMap<OrphanKind, OrphanSweep>, Report> {
        let mut sweeps = BTreeMap::new();
        for kind in [
            OrphanKind::ListOwner,
            OrphanKind::InboxOwner,
            OrphanKind::InteractedContact,
        ] {
            let mut sweep = OrphanSweep::default();
            let mut cursor = String::new();
            loop {
                let page = self
                    .source
                    .orphan_page(kind, &cursor, self.settings.page_size)
                    .await?;
                let Some(last) = page.last() else {
                    break;
                };
                cursor = last.id.clone();
                let full = page.len() as i64 == self.settings.page_size;

                for check in page {
                    sweep.scanned += 1;
                    let Some(rows) = check.orphaned_rows.filter(|rows| *rows > 0) else {
                        continue;
                    };
                    sweep.orphans += 1;
                    sweep.rows += rows as u64;
                    if !dry_run {
                        sweep.deleted_rows += self.delete_orphan(kind, &check.id).await?;
                    }
                }

                if !full {
                    break;
                }
                self.pause().await;
            }
            sweeps.insert(kind, sweep);
        }
        Ok(sweeps)
    }

    async fn delete_orphan(&self, kind: OrphanKind, id: &str) -> Result<u64, Report> {
        let mut deleted = 0;
        loop {
            let rows = self
                .source
                .delete_orphan_rows(kind, id, ORPHAN_ROWS_PER_DELETE)
                .await?;
            deleted += rows;
            if rows < ORPHAN_ROWS_PER_DELETE as u64 {
                return Ok(deleted);
            }
            self.pause().await;
        }
    }

    async fn write_interactions(
        &self,
        channels: &ChannelDirectory,
        writes: impl Iterator<Item = InteractionWrite>,
        dry_run: bool,
    ) -> WriteCounts {
        let mut counts = WriteCounts::default();
        for write in writes {
            counts.writes += 1;
            counts.attempted_rows += write.attempted_rows();
            if dry_run {
                continue;
            }

            let (users, peers) = channels.resolve(&write);
            match self.record_interactions(&users, &peers).await {
                Ok(added) => counts.added_rows += added,
                Err(error) => {
                    tracing::error!(error = ?error, channel_id = %write.channel_id, "interaction write failed");
                    counts.fail(write.channel_id.to_string());
                }
            }

            if counts.writes.is_multiple_of(WRITES_PER_PAUSE) {
                tracing::info!(
                    writes = counts.writes,
                    added_rows = counts.added_rows,
                    "interaction writes"
                );
                self.pause().await;
            }
        }
        counts
    }

    /// Write the pairs, then remove any whose account was deleted while the
    /// write ran, as the worker does. Returns the rows kept.
    async fn record_interactions(
        &self,
        users: &[MacroUserIdStr<'static>],
        peers: &[MacroUserIdStr<'static>],
    ) -> Result<u64, Report> {
        let added = self.lists.record_interactions(users, peers).await?;
        let (deleted, _) = remove_deleted_accounts(&self.lists, &added).await?;
        let kept = added
            .iter()
            .filter(|(owner, contact)| !deleted.contains(owner) && !deleted.contains(contact))
            .count();
        Ok(kept as u64)
    }

    /// Page through inbox owners; for each, page through their legacy
    /// contacts and write the ones an inbox knows, up to 500 per inbox write.
    async fn backfill_inbox(&self, dry_run: bool) -> Result<InboxCounts, Report> {
        let mut counts = InboxCounts::default();
        let mut cursor = String::new();
        loop {
            let owners = self
                .source
                .inbox_owner_page(&cursor, self.settings.page_size)
                .await?;
            let Some(last) = owners.last() else {
                break;
            };
            cursor = last.owner.clone();
            let full = owners.len() as i64 == self.settings.page_size;

            for owner in owners {
                counts.owners += 1;
                counts.inboxes += owner.inboxes.len() as u64;
                let Ok(owner_id) = MacroUserIdStr::try_from(owner.owner.clone()) else {
                    counts.invalid_owners += 1;
                    continue;
                };

                let span = tracing::info_span!(
                    "contacts.backfill.inbox_owner",
                    inboxes = owner.inboxes.len() as i64,
                    legacy_contacts = tracing::field::Empty,
                );
                // One owner's failed read skips that owner, not the pass:
                // their inboxes are named for a rerun.
                let read = self
                    .backfill_owner(&owner, &owner_id, dry_run, &mut counts.written)
                    .instrument(span.clone())
                    .await;
                match read {
                    Ok(read) => {
                        span.record("legacy_contacts", read as i64);
                        counts.legacy_contacts += read;
                    }
                    Err(error) => {
                        tracing::error!(error = ?error, "inbox owner read failed");
                        for inbox in &owner.inboxes {
                            counts.written.fail(inbox.link_id.to_string());
                        }
                    }
                }
            }

            if !full {
                break;
            }
            self.pause().await;
        }
        Ok(counts)
    }

    /// Returns the legacy contacts read.
    async fn backfill_owner(
        &self,
        owner: &InboxOwner,
        owner_id: &MacroUserIdStr<'static>,
        dry_run: bool,
        counts: &mut WriteCounts,
    ) -> Result<u64, Report> {
        let link_ids: Vec<Uuid> = owner.inboxes.iter().map(|inbox| inbox.link_id).collect();
        let mut pending: HashMap<Uuid, HashSet<MacroUserIdStr<'static>>> = HashMap::new();
        let mut read = 0;
        let mut cursor = String::new();
        loop {
            let contacts = self
                .source
                .inbox_contact_page(
                    &owner.owner,
                    &link_ids,
                    &cursor,
                    self.settings.contact_page_size,
                )
                .await?;
            let Some(last) = contacts.last() else {
                break;
            };
            cursor = last.peer.clone();
            let full = contacts.len() as i64 == self.settings.contact_page_size;
            read += contacts.len() as u64;

            for contact in contacts {
                if contact.link_ids.is_empty() {
                    continue;
                }
                let Ok(contact_id) = MacroUserIdStr::try_from(contact.peer) else {
                    continue;
                };
                for link_id in contact.link_ids {
                    let inbox_contacts = pending.entry(link_id).or_default();
                    inbox_contacts.insert(contact_id.clone());
                    if inbox_contacts.len() >= CONTACTS_PER_INBOX_WRITE {
                        let batch = std::mem::take(inbox_contacts);
                        self.write_inbox(owner, owner_id, link_id, batch, dry_run, counts)
                            .await;
                    }
                }
            }

            if !full {
                break;
            }
            self.pause().await;
        }

        for (link_id, batch) in pending {
            if !batch.is_empty() {
                self.write_inbox(owner, owner_id, link_id, batch, dry_run, counts)
                    .await;
            }
        }
        Ok(read)
    }

    async fn write_inbox(
        &self,
        owner: &InboxOwner,
        owner_id: &MacroUserIdStr<'static>,
        link_id: Uuid,
        contacts: HashSet<MacroUserIdStr<'static>>,
        dry_run: bool,
        counts: &mut WriteCounts,
    ) {
        let Some(inbox) = owner.inboxes.iter().find(|inbox| inbox.link_id == link_id) else {
            return;
        };
        let contacts: Vec<_> = contacts.into_iter().filter(|c| c != owner_id).collect();
        counts.writes += 1;
        counts.attempted_rows += contacts.len() as u64;
        if dry_run {
            return;
        }

        let source = InboxSource {
            owner: owner_id.clone(),
            link_id,
            provider: inbox.provider,
        };
        match self.lists.record_inbox_contacts(&source, &contacts).await {
            Ok(added) => counts.added_rows += added.len() as u64,
            Err(error) => {
                tracing::error!(error = ?error, %link_id, "inbox write failed");
                counts.fail(link_id.to_string());
            }
        }
        if counts.writes.is_multiple_of(WRITES_PER_PAUSE) {
            self.pause().await;
        }
    }
}
