//! The `contacts-list-reads` rollout of the list-aware directory reads.
//!
//! Each viewer's reads come from either the legacy graph (`contacts_connections`)
//! or the list-aware tables, chosen by the per-viewer PostHog flag. A failed or
//! missing read of the flag means the legacy reads. Writes are not affected:
//! both stores keep being written while the flag ramps.

use crate::domain::models::{
    messages::ContactsNodes,
    page::{ContactCursor, ContactIdPage, ContactPageSize},
    query::ContactLookup,
};
use crate::domain::ports::{ContactListReader, ContactsPageService, ContactsService};
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::collections::HashMap;
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;
use tokio::time::Instant;

#[cfg(test)]
mod test;

/// The per-viewer PostHog flag that selects the list-aware directory reads.
pub const CONTACT_LIST_READS_FLAG: &str = "contacts-list-reads";

/// How long one viewer's answer is used, so a viewer's reads load the flag
/// about once every five minutes per process rather than once per request.
const DECISION_LIFETIME: Duration = Duration::from_secs(300);

/// Which store a viewer's directory reads come from.
#[derive(Clone, Copy, Debug, PartialEq, Eq, strum::AsRefStr)]
#[strum(serialize_all = "snake_case")]
pub enum DirectorySource {
    /// The legacy undirected graph.
    Legacy,
    /// The directed, list-aware tables.
    Lists,
}

/// The per-viewer flag, with each viewer's answer remembered for
/// [`DECISION_LIFETIME`]. A failed read is remembered as legacy too, so an
/// unavailable flag provider costs one timeout per viewer per lifetime.
pub struct ContactListReads<F> {
    flags: F,
    decisions: Mutex<Decisions>,
}

#[derive(Default)]
struct Decisions {
    by_viewer: HashMap<String, (Instant, DirectorySource)>,
    /// When lapsed answers are next dropped; `None` until the first answer.
    prune_at: Option<Instant>,
}

impl<F> ContactListReads<F> {
    /// Read the flag through `flags`; nothing is remembered yet.
    pub fn new(flags: F) -> Self {
        Self {
            flags,
            decisions: Mutex::new(Decisions::default()),
        }
    }

    fn decisions(&self) -> MutexGuard<'_, Decisions> {
        self.decisions
            .lock()
            .unwrap_or_else(PoisonError::into_inner)
    }

    fn remembered(&self, viewer: &str) -> Option<DirectorySource> {
        self.decisions()
            .by_viewer
            .get(viewer)
            .filter(|(at, _)| at.elapsed() < DECISION_LIFETIME)
            .map(|(_, source)| *source)
    }

    fn remember(&self, viewer: &str, source: DirectorySource) {
        let now = Instant::now();
        let mut decisions = self.decisions();
        // Dropping lapsed answers once per lifetime keeps the map to recent
        // viewers without a scan on every read.
        if decisions.prune_at.is_none_or(|prune_at| prune_at <= now) {
            decisions
                .by_viewer
                .retain(|_, (at, _)| now.duration_since(*at) < DECISION_LIFETIME);
            decisions.prune_at = Some(now + DECISION_LIFETIME);
        }
        decisions
            .by_viewer
            .insert(viewer.to_owned(), (now, source));
    }
}

impl<F: FeatureFlags> ContactListReads<F> {
    /// The store this viewer's reads come from now.
    pub async fn source_for(&self, viewer: &MacroUserIdStr<'_>) -> DirectorySource {
        if let Some(source) = self.remembered(viewer.as_ref()) {
            return source;
        }
        let source = read(&self.flags, viewer).await;
        self.remember(viewer.as_ref(), source);
        source
    }
}

/// One read of the viewer's flag; a failed read means the legacy reads.
#[tracing::instrument(
    name = "contacts.list_reads_flag.read",
    skip_all,
    fields(feature_flag.key = CONTACT_LIST_READS_FLAG, feature_flag.enabled = tracing::field::Empty)
)]
async fn read<F: FeatureFlags>(flags: &F, viewer: &MacroUserIdStr<'_>) -> DirectorySource {
    let enabled = match flags.load(viewer).await {
        Ok(snapshot) => snapshot.is_enabled(CONTACT_LIST_READS_FLAG),
        Err(error) => {
            tracing::warn!(
                ?error,
                "could not read the contacts list reads flag; using the legacy reads"
            );
            false
        }
    };
    tracing::Span::current().record("feature_flag.enabled", enabled);
    if enabled {
        DirectorySource::Lists
    } else {
        DirectorySource::Legacy
    }
}

/// Directory id reads that follow each viewer's flag: the legacy service's, or
/// the list-aware reader's. It serves the bounded page and lookup reads
/// ([`ContactsPageService`]) and the full listing ([`ContactsService`]).
pub struct FlaggedContactReads<Legacy, Lists, F> {
    legacy: Arc<Legacy>,
    lists: Arc<Lists>,
    reads: ContactListReads<F>,
}

impl<Legacy, Lists, F> FlaggedContactReads<Legacy, Lists, F> {
    /// Route each viewer's reads between `legacy` and `lists` by `reads`.
    pub fn new(legacy: Arc<Legacy>, lists: Arc<Lists>, reads: ContactListReads<F>) -> Self {
        Self {
            legacy,
            lists,
            reads,
        }
    }
}

impl<Legacy, Lists, F> FlaggedContactReads<Legacy, Lists, F>
where
    F: FeatureFlags + 'static,
{
    async fn source_for(&self, viewer: &MacroUserIdStr<'_>) -> DirectorySource {
        let source = self.reads.source_for(viewer).await;
        tracing::Span::current().record("source", source.as_ref());
        source
    }
}

impl<Legacy, Lists, F> ContactsPageService for FlaggedContactReads<Legacy, Lists, F>
where
    Legacy: ContactsPageService,
    Lists: ContactListReader,
    F: FeatureFlags + 'static,
{
    #[tracing::instrument(
        name = "contacts.reads.lookup",
        skip_all,
        fields(count = lookup.ids().len() as i64, source = tracing::field::Empty),
        err
    )]
    async fn lookup_contact_ids(
        &self,
        viewer: MacroUserIdStr<'_>,
        lookup: &ContactLookup,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        match self.source_for(&viewer).await {
            DirectorySource::Legacy => self.legacy.lookup_contact_ids(viewer, lookup).await,
            DirectorySource::Lists => self.lists.lookup_listed_contacts(viewer, lookup).await,
        }
    }

    #[tracing::instrument(
        name = "contacts.reads.page",
        skip_all,
        fields(limit = i64::from(limit.get()), has_cursor = after.is_some(), source = tracing::field::Empty),
        err
    )]
    async fn contact_id_page(
        &self,
        viewer: MacroUserIdStr<'_>,
        after: Option<&ContactCursor>,
        limit: ContactPageSize,
    ) -> Result<ContactIdPage, Report> {
        match self.source_for(&viewer).await {
            DirectorySource::Legacy => self.legacy.contact_id_page(viewer, after, limit).await,
            DirectorySource::Lists => self.lists.list_directory_page(viewer, after, limit).await,
        }
    }
}

impl<Legacy, Lists, F> ContactsService for FlaggedContactReads<Legacy, Lists, F>
where
    Legacy: ContactsService,
    Lists: ContactListReader,
    F: FeatureFlags + 'static,
{
    /// The viewer's whole directory, the viewer included. The list-aware path
    /// reads it in pages of the largest size, like the legacy read it returns
    /// every contact.
    #[tracing::instrument(
        name = "contacts.reads.all",
        skip_all,
        fields(source = tracing::field::Empty, pages = tracing::field::Empty, count = tracing::field::Empty),
        err
    )]
    async fn query_contacts(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        let contacts = match self.source_for(&user_id).await {
            DirectorySource::Legacy => self.legacy.query_contacts(user_id).await?,
            DirectorySource::Lists => {
                let mut contacts = Vec::new();
                let mut cursor = None;
                let mut pages = 0_i64;
                loop {
                    let page = self
                        .lists
                        .list_directory_page(user_id.clone(), cursor.as_ref(), ContactPageSize::MAX)
                        .await?;
                    pages += 1;
                    contacts.extend(page.contacts.into_iter().map(|entry| entry.user_id));
                    match page.next_cursor {
                        Some(next) if cursor.as_ref() == Some(&next) => {
                            return Err(rootcause::report!("contact listing did not advance"));
                        }
                        Some(next) => cursor = Some(next),
                        None => break,
                    }
                }
                tracing::Span::current().record("pages", pages);
                contacts
            }
        };
        tracing::Span::current().record("count", contacts.len() as i64);
        Ok(contacts)
    }

    /// Writes are not part of the read rollout.
    async fn add_contact_nodes(&self, nodes: ContactsNodes) -> Result<(), Report> {
        self.legacy.add_contact_nodes(nodes).await
    }

    /// Writes are not part of the read rollout.
    async fn invite_contact(
        &self,
        inviter: MacroUserIdStr<'static>,
        invitee: MacroUserIdStr<'static>,
    ) -> Result<(), Report> {
        self.legacy.invite_contact(inviter, invitee).await
    }
}
