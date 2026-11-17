//! Which email threads a search reaches and the thread states its hits must
//! meet, each meaning what the Email list query means by the same filter.
//!
//! Where a filter's set of threads is bounded (shares, threads with an
//! invitation, a sent message or a draft) it is resolved in Postgres and
//! searched as an allowlist of thread ids. Read, done, notification state and
//! attachment kinds can each cover most of a mailbox, or have no index to
//! resolve them by, so those are checked against the threads of each page of
//! hits.

use item_filters::ast::email::AttachmentKind;
use item_filters::{EmailFilters, EmailSearchView, NotificationState, SharedEmailFilter};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use rootcause::Report;
use std::collections::HashSet;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Most shared threads one search reaches. Each is a term in the OpenSearch
/// filter, which refuses more than 65,536.
pub(crate) const MAX_SHARED_THREADS: usize = 10_000;

/// Most threads of one [`ThreadSet`] resolved into an allowlist. A mailbox
/// with more has the set checked against each page of hits instead.
pub(crate) const MAX_THREAD_SET_ALLOWLIST: usize = 10_000;

/// A bounded set of a mailbox's threads that an Email view lists, read from
/// the partial index the view reads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ThreadSet {
    /// Threads with an invitation, the Calendar tab.
    Calendar,
    /// Threads with a sent message, the Sent view.
    Sent,
    /// Threads with a draft, the Drafts view.
    Drafts,
}

impl ThreadSet {
    const ALL: [ThreadSet; 3] = [ThreadSet::Calendar, ThreadSet::Sent, ThreadSet::Drafts];
}

/// A thread shared with the caller, and the inbox holding it.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) struct SharedThread {
    pub thread_id: Uuid,
    pub link_id: Uuid,
}

/// The inboxes the caller reads directly: their own and those delegated to them.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ViewerInboxes {
    pub link_ids: Vec<Uuid>,
    /// The owners the email index files those inboxes' messages under.
    pub user_ids: Vec<String>,
}

/// Thread-level conditions every email hit must meet.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct ThreadStates {
    pub is_read: Option<bool>,
    pub done: Option<bool>,
    pub calendar_only: bool,
    pub notification_states: Vec<NotificationState>,
    pub sent: bool,
    pub has_draft: bool,
    /// The thread carries an attachment of one of these kinds.
    pub attachments: Vec<AttachmentKind>,
}

impl ThreadStates {
    pub fn from_filters(filters: &EmailFilters) -> Self {
        let mut notification_states = Vec::new();
        for state in &filters.notification_filters.states {
            if !notification_states.contains(state) {
                notification_states.push(*state);
            }
        }
        let mut attachments = Vec::new();
        for kind in &filters.attachments {
            if !attachments.contains(kind) {
                attachments.push(*kind);
            }
        }
        Self {
            is_read: filters.is_read,
            done: filters.done,
            calendar_only: filters.calendar_only == Some(true),
            notification_states,
            sent: filters.view == Some(EmailSearchView::Sent),
            has_draft: filters.view == Some(EmailSearchView::Drafts),
            attachments,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.is_read.is_none()
            && self.done.is_none()
            && !self.calendar_only
            && self.notification_states.is_empty()
            && !self.sent
            && !self.has_draft
            && self.attachments.is_empty()
    }

    /// The states that put a thread in `set`.
    fn of_set(set: ThreadSet) -> Self {
        let mut states = Self::default();
        *states.set_flag(set) = true;
        states
    }

    fn set_flag(&mut self, set: ThreadSet) -> &mut bool {
        match set {
            ThreadSet::Calendar => &mut self.calendar_only,
            ThreadSet::Sent => &mut self.sent,
            ThreadSet::Drafts => &mut self.has_draft,
        }
    }
}

/// The email threads one search reaches.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) enum EmailScope {
    /// No thread can match, so emails stay out of the search.
    Nothing,
    Threads(EmailThreads),
}

#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct EmailThreads {
    /// Mailboxes searched, by index owner. Unused when `ids_only`.
    pub user_ids: Vec<String>,
    /// Threads reached besides those mailboxes, or with `ids_only` the only
    /// threads searched.
    pub thread_ids: Vec<Uuid>,
    pub ids_only: bool,
    /// Threads every hit must belong to; empty imposes nothing.
    pub required_thread_ids: Vec<Uuid>,
    /// Conditions each page's hits are checked against.
    pub hit_states: ThreadStates,
    /// The shared threads stopped at [`MAX_SHARED_THREADS`].
    pub shared_capped: bool,
}

/// Reads the threads a filter reaches, for the caller.
pub(crate) trait EmailSearchSource {
    /// Threads granted to the caller's sources outside `own_link_ids`,
    /// narrowed to `requested` when it is not empty, at most `limit`.
    fn shared_threads(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        own_link_ids: &[Uuid],
        requested: &[Uuid],
        limit: usize,
    ) -> impl Future<Output = Result<Vec<SharedThread>, Report>> + Send;

    /// The threads of `set` in the given inboxes, at most `limit`.
    fn threads_in_set(
        &self,
        link_ids: &[Uuid],
        set: ThreadSet,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;

    /// Which of `thread_ids` meet every condition in `states`.
    fn threads_in_states(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        thread_ids: &[Uuid],
        states: &ThreadStates,
    ) -> impl Future<Output = Result<HashSet<Uuid>, Report>> + Send;
}

pub(crate) struct EmailSearchService<S>(pub S);

impl<S: EmailSearchSource> EmailSearchService<S> {
    /// Resolves the threads `filters` reach. Thread ids that are not UUIDs
    /// match nothing.
    pub async fn scope(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        filters: &EmailFilters,
        inboxes: &ViewerInboxes,
    ) -> Result<EmailScope, Report> {
        let requested: Vec<Uuid> = filters
            .email_thread_ids
            .iter()
            .filter_map(|id| Uuid::parse_str(id).ok())
            .collect();
        if !filters.email_thread_ids.is_empty() && requested.is_empty() {
            return Ok(EmailScope::Nothing);
        }

        let shared = match filters.shared {
            SharedEmailFilter::Exclude => Vec::new(),
            SharedEmailFilter::Include | SharedEmailFilter::Only => {
                self.0
                    .shared_threads(user, &inboxes.link_ids, &requested, MAX_SHARED_THREADS)
                    .await?
            }
        };
        let shared_capped = shared.len() >= MAX_SHARED_THREADS;
        let shared_ids: Vec<Uuid> = shared.iter().map(|thread| thread.thread_id).collect();

        let mut hit_states = ThreadStates::from_filters(filters);
        let mut allowlist: Option<Vec<Uuid>> = None;
        for set in ThreadSet::ALL {
            if !*hit_states.set_flag(set) {
                continue;
            }
            let Some(in_set) = self
                .set_allowlist(user, set, filters.shared, inboxes, &shared_ids)
                .await?
            else {
                continue;
            };
            *hit_states.set_flag(set) = false;
            allowlist = Some(match allowlist {
                None => in_set,
                Some(mut so_far) => {
                    let in_set: HashSet<Uuid> = in_set.into_iter().collect();
                    so_far.retain(|id| in_set.contains(id));
                    so_far
                }
            });
        }

        let mut threads = match (allowlist, filters.shared) {
            (Some(thread_ids), _) => EmailThreads {
                thread_ids,
                ids_only: true,
                ..Default::default()
            },
            (None, SharedEmailFilter::Exclude) => EmailThreads {
                user_ids: inboxes.user_ids.clone(),
                ..Default::default()
            },
            (None, SharedEmailFilter::Include) => EmailThreads {
                user_ids: inboxes.user_ids.clone(),
                thread_ids: shared_ids,
                ..Default::default()
            },
            (None, SharedEmailFilter::Only) => EmailThreads {
                thread_ids: shared_ids,
                ids_only: true,
                ..Default::default()
            },
        };
        threads.hit_states = hit_states;
        threads.shared_capped = shared_capped;

        if !requested.is_empty() {
            if threads.ids_only {
                let requested: HashSet<Uuid> = requested.into_iter().collect();
                threads.thread_ids.retain(|id| requested.contains(id));
            } else {
                threads.required_thread_ids = requested;
            }
        }
        if threads.ids_only && threads.thread_ids.is_empty() {
            return Ok(EmailScope::Nothing);
        }
        Ok(EmailScope::Threads(threads))
    }

    /// The threads of `set` the search reaches, or `None` when the caller's
    /// inboxes hold more than [`MAX_THREAD_SET_ALLOWLIST`].
    async fn set_allowlist(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        set: ThreadSet,
        shared: SharedEmailFilter,
        inboxes: &ViewerInboxes,
        shared_ids: &[Uuid],
    ) -> Result<Option<Vec<Uuid>>, Report> {
        let mut allowlist = match shared {
            SharedEmailFilter::Only => Vec::new(),
            SharedEmailFilter::Exclude | SharedEmailFilter::Include => {
                let own = self
                    .0
                    .threads_in_set(&inboxes.link_ids, set, MAX_THREAD_SET_ALLOWLIST + 1)
                    .await?;
                if own.len() > MAX_THREAD_SET_ALLOWLIST {
                    return Ok(None);
                }
                own
            }
        };
        if !shared_ids.is_empty() {
            let shared_in_set = self
                .0
                .threads_in_states(user, shared_ids, &ThreadStates::of_set(set))
                .await?;
            allowlist.extend(shared_ids.iter().filter(|id| shared_in_set.contains(id)));
        }
        Ok(Some(allowlist))
    }

    /// Which of `thread_ids` meet `states`.
    pub async fn matching_threads(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        thread_ids: &[Uuid],
        states: &ThreadStates,
    ) -> Result<HashSet<Uuid>, Report> {
        if thread_ids.is_empty() {
            return Ok(HashSet::new());
        }
        self.0.threads_in_states(user, thread_ids, states).await
    }

    /// Which of `thread_ids` outside the caller's inboxes a grant shares
    /// with them, and the inboxes holding those threads.
    pub async fn shared_among(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        inbox_link_ids: &[Uuid],
        thread_ids: &[Uuid],
    ) -> Result<Vec<SharedThread>, Report> {
        if thread_ids.is_empty() {
            return Ok(Vec::new());
        }
        self.0
            .shared_threads(user, inbox_link_ids, thread_ids, thread_ids.len())
            .await
    }
}
