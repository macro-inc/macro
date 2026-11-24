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

/// Most threads in the requested Drive folders one search reaches. Each is a
/// term in the OpenSearch filter, which refuses more than 65,536.
pub(crate) const MAX_PROJECT_THREADS: usize = 10_000;

/// Most Drive folders one search may be scoped to.
pub(crate) const MAX_EMAIL_PROJECTS: usize = 50;

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
    /// The thread carries an attachment of any kind.
    pub has_attachment: bool,
    /// States no hit's thread may meet, each checked on its own. Read only by
    /// [`EmailSearchService::matching_threads`]; a source never sees them.
    pub excluded: Vec<ThreadStates>,
}

/// A tag or label condition resolved to what the index stores.
#[derive(Debug, Clone, Default, PartialEq, Eq)]
pub(crate) struct LabelCondition {
    /// Label names in the caller's inboxes, as their messages carry them.
    pub labels: Vec<String>,
    /// The caller's tag options with the label.
    pub tag_option_ids: Vec<Uuid>,
    pub exclude: bool,
}

/// One of the caller's tag options.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct TagOption {
    pub label: String,
    pub option_id: Uuid,
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
        // An attachment of a named kind is an attachment, so asking for any
        // kind on top of it would only widen the kinds' OR.
        let has_attachment = filters.has_attachment == Some(true) && attachments.is_empty();
        let mut excluded = Vec::new();
        if filters.has_attachment == Some(false) {
            excluded.push(Self {
                has_attachment: true,
                ..Self::default()
            });
        }
        Self {
            is_read: filters.is_read,
            done: filters.done,
            calendar_only: filters.calendar_only == Some(true)
                || filters.view == Some(EmailSearchView::Calendar),
            notification_states,
            sent: filters.view == Some(EmailSearchView::Sent),
            has_draft: filters.view == Some(EmailSearchView::Drafts),
            attachments,
            has_attachment,
            excluded,
        }
    }

    pub fn is_empty(&self) -> bool {
        self.requires_nothing() && self.excluded.is_empty()
    }

    /// No condition a hit must meet, whatever it must not.
    fn requires_nothing(&self) -> bool {
        self.is_read.is_none()
            && self.done.is_none()
            && !self.calendar_only
            && self.notification_states.is_empty()
            && !self.sent
            && !self.has_draft
            && self.attachments.is_empty()
            && !self.has_attachment
    }

    /// These states without their exclusions, as a source reads them.
    fn required(&self) -> Self {
        Self {
            excluded: Vec::new(),
            ..self.clone()
        }
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
    /// Threads no hit may belong to.
    pub excluded_thread_ids: Vec<Uuid>,
    /// Tags or labels every hit's thread must, or must not, carry.
    pub label_conditions: Vec<LabelCondition>,
    /// Conditions each page's hits are checked against.
    pub hit_states: ThreadStates,
    /// The shared threads stopped at [`MAX_SHARED_THREADS`].
    pub shared_capped: bool,
    /// The threads in the requested folders stopped at [`MAX_PROJECT_THREADS`].
    pub project_capped: bool,
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

    /// The threads in the given Drive folders the caller reads, as the Email
    /// list's project candidates admit them: their own (`include_own`), every
    /// thread in a folder granted to them, and with `include_thread_shares`
    /// threads in a folder a thread grant shares with them. Non-empty
    /// `requested` narrows them before `limit` applies. At most `limit`.
    #[expect(
        clippy::too_many_arguments,
        reason = "each argument is one input of the folder query"
    )]
    fn project_threads(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        own_link_ids: &[Uuid],
        project_ids: &[String],
        requested: &[Uuid],
        include_own: bool,
        include_thread_shares: bool,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<SharedThread>, Report>> + Send;

    /// Which of `thread_ids` outside `own_link_ids` sit in a folder granted
    /// to the caller, and the inboxes holding them.
    fn project_shared_threads(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        own_link_ids: &[Uuid],
        thread_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<SharedThread>, Report>> + Send;

    /// The threads of `set` in the given inboxes, at most `limit`.
    fn threads_in_set(
        &self,
        link_ids: &[Uuid],
        set: ThreadSet,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;

    /// Which of `thread_ids` meet every condition in `states`. `states`
    /// carries no exclusions.
    fn threads_in_states(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        thread_ids: &[Uuid],
        states: &ThreadStates,
    ) -> impl Future<Output = Result<HashSet<Uuid>, Report>> + Send;

    /// The email threads among the caller's favorites, at most `limit`.
    fn favorite_threads(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        limit: usize,
    ) -> impl Future<Output = Result<Vec<Uuid>, Report>> + Send;

    /// The options of every tag set the caller can apply.
    fn tag_options(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
    ) -> impl Future<Output = Result<Vec<TagOption>, Report>> + Send;

    /// The names of the labels in the given inboxes.
    fn inbox_labels(
        &self,
        link_ids: &[Uuid],
    ) -> impl Future<Output = Result<Vec<String>, Report>> + Send;
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
        let mut requested: Vec<Uuid> = filters
            .email_thread_ids
            .iter()
            .filter_map(|id| Uuid::parse_str(id).ok())
            .collect();
        if !filters.email_thread_ids.is_empty() && requested.is_empty() {
            return Ok(EmailScope::Nothing);
        }

        let favorites = match filters.favorite {
            None => Vec::new(),
            Some(_) => {
                self.0
                    .favorite_threads(user, MAX_THREAD_SET_ALLOWLIST)
                    .await?
            }
        };
        // Favorites narrow the search as named threads do, so shared ones
        // still need a share the caller holds.
        if filters.favorite == Some(true) {
            requested = if filters.email_thread_ids.is_empty() {
                favorites.clone()
            } else {
                let favorites: HashSet<&Uuid> = favorites.iter().collect();
                requested
                    .into_iter()
                    .filter(|id| favorites.contains(id))
                    .collect()
            };
            if requested.is_empty() {
                return Ok(EmailScope::Nothing);
            }
        }

        let Some(label_conditions) = self.label_conditions(user, filters, inboxes).await? else {
            return Ok(EmailScope::Nothing);
        };

        let scope = self.base_scope(user, filters, inboxes, requested).await?;
        let EmailScope::Threads(mut threads) = scope else {
            return Ok(scope);
        };
        threads.label_conditions = label_conditions;
        if filters.favorite == Some(false) {
            threads.excluded_thread_ids = favorites;
        }
        for view in &filters.exclude_views {
            let set = match view {
                EmailSearchView::Sent => ThreadSet::Sent,
                EmailSearchView::Drafts => ThreadSet::Drafts,
                EmailSearchView::Calendar => ThreadSet::Calendar,
            };
            // The threads reached by id (shares, or an allowlist) are checked
            // against the set; the caller's own mailbox is read from it.
            match self
                .set_allowlist(user, set, filters.shared, inboxes, &threads.thread_ids)
                .await?
            {
                Some(in_set) => threads.excluded_thread_ids.extend(in_set),
                None => threads.hit_states.excluded.push(ThreadStates::of_set(set)),
            }
        }
        Ok(EmailScope::Threads(threads))
    }

    /// Resolves each tag or label name to what the index stores, or `None`
    /// when a name that must be carried names nothing, so nothing matches.
    async fn label_conditions(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        filters: &EmailFilters,
        inboxes: &ViewerInboxes,
    ) -> Result<Option<Vec<LabelCondition>>, Report> {
        if filters.label_names.is_empty() {
            return Ok(Some(Vec::new()));
        }
        let (tags, labels) = tokio::try_join!(
            self.0.tag_options(user),
            self.0.inbox_labels(&inboxes.link_ids)
        )?;

        let mut conditions = Vec::new();
        for wanted in &filters.label_names {
            let name = wanted.name.to_lowercase();
            let mut condition = LabelCondition {
                exclude: wanted.exclude,
                ..LabelCondition::default()
            };
            for label in &labels {
                if label.to_lowercase() == name && !condition.labels.contains(label) {
                    condition.labels.push(label.clone());
                }
            }
            for tag in &tags {
                if tag.label.to_lowercase() == name {
                    condition.tag_option_ids.push(tag.option_id);
                }
            }
            let names_nothing = condition.labels.is_empty() && condition.tag_option_ids.is_empty();
            if names_nothing && !wanted.exclude {
                return Ok(None);
            }
            if !names_nothing {
                conditions.push(condition);
            }
        }
        Ok(Some(conditions))
    }

    /// The threads the request's own scope reaches, before the conditions
    /// typed into the search narrow them.
    async fn base_scope(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        filters: &EmailFilters,
        inboxes: &ViewerInboxes,
        requested: Vec<Uuid>,
    ) -> Result<EmailScope, Report> {
        let mut project_ids: Vec<String> = Vec::new();
        for id in &filters.project_ids {
            if !id.is_empty() && !project_ids.contains(id) {
                project_ids.push(id.clone());
            }
        }
        if !project_ids.is_empty() {
            return self
                .project_scope(user, filters, inboxes, &project_ids, requested)
                .await;
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

    /// The threads a search scoped to Drive folders reaches: the folders'
    /// threads the caller reads, as an allowlist. The other thread-level
    /// filters are checked per hit, since the folders' threads can lie in
    /// other people's inboxes, which the per-inbox sets do not cover.
    async fn project_scope(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        filters: &EmailFilters,
        inboxes: &ViewerInboxes,
        project_ids: &[String],
        requested: Vec<Uuid>,
    ) -> Result<EmailScope, Report> {
        let in_projects = self
            .0
            .project_threads(
                user,
                &inboxes.link_ids,
                project_ids,
                &requested,
                !matches!(filters.shared, SharedEmailFilter::Only),
                !matches!(filters.shared, SharedEmailFilter::Exclude),
                MAX_PROJECT_THREADS,
            )
            .await?;
        let project_capped = in_projects.len() >= MAX_PROJECT_THREADS;
        let thread_ids: Vec<Uuid> = in_projects.iter().map(|thread| thread.thread_id).collect();
        if thread_ids.is_empty() {
            return Ok(EmailScope::Nothing);
        }
        Ok(EmailScope::Threads(EmailThreads {
            thread_ids,
            ids_only: true,
            hit_states: ThreadStates::from_filters(filters),
            project_capped,
            ..Default::default()
        }))
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

    /// Which of `thread_ids` meet `states` and none of its exclusions.
    pub async fn matching_threads(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        thread_ids: &[Uuid],
        states: &ThreadStates,
    ) -> Result<HashSet<Uuid>, Report> {
        if thread_ids.is_empty() {
            return Ok(HashSet::new());
        }
        let mut matching = if states.requires_nothing() {
            thread_ids.iter().copied().collect()
        } else {
            self.0
                .threads_in_states(user, thread_ids, &states.required())
                .await?
        };
        for excluded in &states.excluded {
            if matching.is_empty() {
                break;
            }
            let candidates: Vec<Uuid> = matching.iter().copied().collect();
            let left_out = self
                .0
                .threads_in_states(user, &candidates, &excluded.required())
                .await?;
            matching.retain(|id| !left_out.contains(id));
        }
        Ok(matching)
    }

    /// Which of `thread_ids` outside the caller's inboxes a grant on the
    /// thread, or on the Drive folder holding it, shares with them, and the
    /// inboxes holding those threads.
    pub async fn shared_among(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        inbox_link_ids: &[Uuid],
        thread_ids: &[Uuid],
    ) -> Result<Vec<SharedThread>, Report> {
        if thread_ids.is_empty() {
            return Ok(Vec::new());
        }
        let mut shared = self
            .0
            .shared_threads(user, inbox_link_ids, thread_ids, thread_ids.len())
            .await?;
        let found: HashSet<Uuid> = shared.iter().map(|thread| thread.thread_id).collect();
        let remaining: Vec<Uuid> = thread_ids
            .iter()
            .filter(|id| !found.contains(id))
            .copied()
            .collect();
        if !remaining.is_empty() {
            shared.extend(
                self.0
                    .project_shared_threads(user, inbox_link_ids, &remaining)
                    .await?,
            );
        }
        Ok(shared)
    }
}
