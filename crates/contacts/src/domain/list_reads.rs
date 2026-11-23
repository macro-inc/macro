//! The `contacts-list-reads` rollout of the list-aware directory reads.
//!
//! Each viewer's reads come from either the legacy graph (`contacts_connections`)
//! or the list-aware tables, chosen by the per-viewer PostHog flag. A failed or
//! missing read of the flag means the legacy reads. Writes are not affected:
//! both stores keep being written while the flag ramps.

use crate::domain::models::{
    messages::ContactsNodes,
    page::{ContactCursor, ContactIdPage, ContactPageSize, MAX_CONTACT_PAGE_SIZE},
    people::{NamedPeopleQuery, PeopleSearchLimit, PeopleSearchQuery, PersonMatch},
    query::ContactLookup,
};
use crate::domain::ports::{
    ContactListReader, ContactsPageService, ContactsService, CorrespondentsService,
    PeopleNamingService, PeopleSearchService,
};
use crate::domain::service::{people_named_with, search_people_with};
use feature_flags::FeatureFlags;
use macro_user_id::user_id::MacroUserIdStr;
use rootcause::Report;
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex, MutexGuard, PoisonError};
use std::time::Duration;
use tokio::sync::OnceCell;
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
/// Concurrent reads for one viewer share a single load.
pub struct ContactListReads<F> {
    /// `None` without a flag provider (a deployment with no PostHog key):
    /// every viewer reads the legacy graph.
    flags: Option<F>,
    decisions: Mutex<Decisions>,
}

#[derive(Default)]
struct Decisions {
    by_viewer: HashMap<String, Arc<Decision>>,
    /// When lapsed answers are next dropped; `None` until the first answer.
    prune_at: Option<Instant>,
}

/// One viewer's answer for one lifetime, filled by the first read that needs
/// it; reads that arrive while it loads wait for the same answer.
struct Decision {
    started: Instant,
    source: OnceCell<DirectorySource>,
}

impl Decision {
    fn is_current(&self, now: Instant) -> bool {
        now.duration_since(self.started) < DECISION_LIFETIME
    }
}

impl<F> ContactListReads<F> {
    /// Read the flag through `flags`; nothing is remembered yet.
    pub fn new(flags: F) -> Self {
        Self::optional(Some(flags))
    }

    /// Read the flag through `flags` when the deployment has a provider;
    /// without one every viewer reads the legacy graph.
    pub fn optional(flags: Option<F>) -> Self {
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

    /// This viewer's current decision, or a new empty one when it has none or
    /// it has lapsed. The lock is never held across a load.
    fn decision(&self, viewer: &str) -> Arc<Decision> {
        let now = Instant::now();
        let mut decisions = self.decisions();
        if let Some(decision) = decisions.by_viewer.get(viewer)
            && decision.is_current(now)
        {
            return decision.clone();
        }
        // Dropping lapsed answers once per lifetime keeps the map to recent
        // viewers without a scan on every read.
        if decisions.prune_at.is_none_or(|prune_at| prune_at <= now) {
            decisions
                .by_viewer
                .retain(|_, decision| decision.is_current(now));
            decisions.prune_at = Some(now + DECISION_LIFETIME);
        }
        let decision = Arc::new(Decision {
            started: now,
            source: OnceCell::new(),
        });
        decisions
            .by_viewer
            .insert(viewer.to_owned(), decision.clone());
        decision
    }
}

impl<F: FeatureFlags> ContactListReads<F> {
    /// The store this viewer's reads come from now.
    pub async fn source_for(&self, viewer: &MacroUserIdStr<'_>) -> DirectorySource {
        let Some(flags) = &self.flags else {
            return DirectorySource::Legacy;
        };
        *self
            .decision(viewer.as_ref())
            .source
            .get_or_init(|| read(flags, viewer))
            .await
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

/// Directory reads that follow each viewer's flag: the legacy service's, or
/// the list-aware reader's. It serves the bounded page and lookup reads
/// ([`ContactsPageService`]), the full listing ([`ContactsService`]), ranked
/// people search ([`PeopleSearchService`]) and email correspondents
/// ([`CorrespondentsService`]).
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

    /// The list-aware path looks the ids up 500 at a time instead of reading
    /// the whole directory.
    #[tracing::instrument(
        name = "contacts.reads.among",
        skip_all,
        fields(requested = ids.len() as i64, source = tracing::field::Empty, count = tracing::field::Empty),
        err
    )]
    async fn query_contacts_among(
        &self,
        user_id: MacroUserIdStr<'_>,
        ids: &[MacroUserIdStr<'static>],
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        let contacts = match self.source_for(&user_id).await {
            DirectorySource::Legacy => self.legacy.query_contacts_among(user_id, ids).await?,
            DirectorySource::Lists => {
                let mut seen = HashSet::new();
                let ids: Vec<_> = ids.iter().filter(|id| seen.insert(*id)).cloned().collect();
                let mut contacts = Vec::new();
                for chunk in ids.chunks(usize::from(MAX_CONTACT_PAGE_SIZE)) {
                    let lookup = ContactLookup::new(chunk.to_vec())
                        .ok_or_else(|| rootcause::report!("contact lookup exceeded its bound"))?;
                    contacts.extend(
                        self.lists
                            .lookup_listed_contacts(user_id.clone(), &lookup)
                            .await?,
                    );
                }
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

impl<Legacy, Lists, F> PeopleSearchService for FlaggedContactReads<Legacy, Lists, F>
where
    Legacy: PeopleSearchService,
    Lists: ContactListReader,
    F: FeatureFlags + 'static,
{
    /// The list-aware search ranks by list group and returns each match's
    /// lists. A legacy search keeps its ranking; its matches get their lists
    /// from the list-aware tables, like the GraphQL directory's, so a match
    /// only the legacy graph knows has none.
    #[tracing::instrument(
        name = "contacts.reads.people_search",
        skip_all,
        fields(source = tracing::field::Empty),
        err
    )]
    async fn search_people(
        &self,
        viewer: MacroUserIdStr<'_>,
        query: &PeopleSearchQuery,
        limit: PeopleSearchLimit,
    ) -> Result<Vec<PersonMatch>, Report> {
        match self.source_for(&viewer).await {
            DirectorySource::Lists => {
                search_people_with(query, limit, |needle| {
                    self.lists.search_listed_people(viewer, needle, limit)
                })
                .await
            }
            DirectorySource::Legacy => {
                let people = self
                    .legacy
                    .search_people(viewer.clone(), query, limit)
                    .await?;
                self.with_lists(viewer, people).await
            }
        }
    }
}

impl<Legacy, Lists, F> FlaggedContactReads<Legacy, Lists, F>
where
    Lists: ContactListReader,
{
    /// Gives people the legacy graph found their lists from the list-aware
    /// tables, like the GraphQL directory's, so a person only the legacy graph
    /// knows has none.
    async fn with_lists(
        &self,
        viewer: MacroUserIdStr<'_>,
        mut people: Vec<PersonMatch>,
    ) -> Result<Vec<PersonMatch>, Report> {
        let ids = people
            .iter()
            .map(|person| person.contact.user_id.clone())
            .collect();
        let Some(lookup) = ContactLookup::new(ids) else {
            return Err(rootcause::report!("people search exceeded its limit"));
        };
        let mut lists: HashMap<_, _> = self
            .lists
            .contact_lists(viewer, &lookup)
            .await?
            .into_iter()
            .map(|listed| (listed.user_id, listed.lists))
            .collect();
        for person in &mut people {
            if let Some(person_lists) = lists.remove(&person.contact.user_id) {
                person.contact.lists = person_lists;
            }
        }
        Ok(people)
    }
}

impl<Legacy, Lists, F> PeopleNamingService for FlaggedContactReads<Legacy, Lists, F>
where
    Legacy: PeopleNamingService,
    Lists: ContactListReader,
    F: FeatureFlags + 'static,
{
    /// The list-aware read ranks by list group and returns each match's lists;
    /// a legacy read ranks teammates first and its matches get their lists
    /// from the list-aware tables.
    #[tracing::instrument(
        name = "contacts.reads.people_named",
        skip_all,
        fields(source = tracing::field::Empty),
        err
    )]
    async fn people_named(
        &self,
        viewer: MacroUserIdStr<'_>,
        query: &NamedPeopleQuery,
        limit: PeopleSearchLimit,
    ) -> Result<Vec<PersonMatch>, Report> {
        match self.source_for(&viewer).await {
            DirectorySource::Lists => {
                people_named_with(query, limit, || {
                    self.lists.name_listed_people(viewer, query, limit)
                })
                .await
            }
            DirectorySource::Legacy => {
                let people = self
                    .legacy
                    .people_named(viewer.clone(), query, limit)
                    .await?;
                self.with_lists(viewer, people).await
            }
        }
    }
}

impl<Legacy, Lists, F> CorrespondentsService for FlaggedContactReads<Legacy, Lists, F>
where
    Legacy: CorrespondentsService,
    Lists: ContactListReader,
    F: FeatureFlags + 'static,
{
    /// The list-aware path returns only the user's inbox contacts.
    #[tracing::instrument(
        name = "contacts.reads.correspondents",
        skip_all,
        fields(source = tracing::field::Empty, count = tracing::field::Empty),
        err
    )]
    async fn correspondents(
        &self,
        user_id: MacroUserIdStr<'_>,
    ) -> Result<Vec<MacroUserIdStr<'static>>, Report> {
        let correspondents = match self.source_for(&user_id).await {
            DirectorySource::Legacy => self.legacy.correspondents(user_id).await?,
            DirectorySource::Lists => self.lists.inbox_contacts(user_id).await?,
        };
        tracing::Span::current().record("count", correspondents.len() as i64);
        Ok(correspondents)
    }
}
