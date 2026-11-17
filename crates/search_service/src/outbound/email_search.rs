//! Postgres reads behind email search scoping.

use std::collections::HashSet;

use email_db_client::threads::search_filters::{
    ThreadAttachmentKind, ThreadStateFilter, calendar_thread_ids, draft_thread_ids,
    sent_thread_ids, thread_ids_matching_states,
};
use entity_access::outbound::{
    get_user_source_ids, project_email_threads, project_shared_email_threads, shared_email_threads,
};
use item_filters::ast::email::AttachmentKind;
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use readonly_pool::ReadOnlyPool;
use rootcause::Report;
use uuid::Uuid;

use crate::domain::email_search::{EmailSearchSource, SharedThread, ThreadSet, ThreadStates};

pub(crate) struct EmailSearchPgSource {
    pub db: ReadOnlyPool,
}

fn limit(limit: usize) -> i64 {
    i64::try_from(limit).unwrap_or(i64::MAX)
}

fn shared_thread(thread: entity_access::outbound::SharedEmailThread) -> SharedThread {
    SharedThread {
        thread_id: thread.thread_id,
        link_id: thread.link_id,
    }
}

fn attachment_kind(kind: AttachmentKind) -> ThreadAttachmentKind {
    match kind {
        AttachmentKind::Pdf => ThreadAttachmentKind::Pdf,
        AttachmentKind::Image => ThreadAttachmentKind::Image,
        AttachmentKind::Document => ThreadAttachmentKind::Document,
    }
}

impl EmailSearchSource for EmailSearchPgSource {
    async fn shared_threads(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        own_link_ids: &[Uuid],
        requested: &[Uuid],
        max: usize,
    ) -> Result<Vec<SharedThread>, Report> {
        let sources = get_user_source_ids(&self.db, Some(user))
            .await
            .map_err(|error| rootcause::report!("{error:#}"))?;
        let threads =
            shared_email_threads(&self.db, &sources, own_link_ids, requested, limit(max)).await?;
        Ok(threads.into_iter().map(shared_thread).collect())
    }

    async fn project_threads(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        own_link_ids: &[Uuid],
        project_ids: &[String],
        requested: &[Uuid],
        include_own: bool,
        include_thread_shares: bool,
        max: usize,
    ) -> Result<Vec<SharedThread>, Report> {
        let sources = get_user_source_ids(&self.db, Some(user))
            .await
            .map_err(|error| rootcause::report!("{error:#}"))?;
        let threads = project_email_threads(
            &self.db,
            &sources,
            own_link_ids,
            project_ids,
            requested,
            include_own,
            include_thread_shares,
            limit(max),
        )
        .await?;
        Ok(threads.into_iter().map(shared_thread).collect())
    }

    async fn project_shared_threads(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        own_link_ids: &[Uuid],
        thread_ids: &[Uuid],
    ) -> Result<Vec<SharedThread>, Report> {
        let sources = get_user_source_ids(&self.db, Some(user))
            .await
            .map_err(|error| rootcause::report!("{error:#}"))?;
        let threads =
            project_shared_email_threads(&self.db, &sources, own_link_ids, thread_ids).await?;
        Ok(threads.into_iter().map(shared_thread).collect())
    }

    async fn threads_in_set(
        &self,
        link_ids: &[Uuid],
        set: ThreadSet,
        max: usize,
    ) -> Result<Vec<Uuid>, Report> {
        let ids = match set {
            ThreadSet::Calendar => calendar_thread_ids(&self.db, link_ids, limit(max)).await,
            ThreadSet::Sent => sent_thread_ids(&self.db, link_ids, limit(max)).await,
            ThreadSet::Drafts => draft_thread_ids(&self.db, link_ids, limit(max)).await,
        };
        ids.map_err(|error| rootcause::report!("{error:#}"))
    }

    async fn threads_in_states(
        &self,
        user: &MacroUserId<Lowercase<'_>>,
        thread_ids: &[Uuid],
        states: &ThreadStates,
    ) -> Result<HashSet<Uuid>, Report> {
        let filter = ThreadStateFilter {
            is_read: states.is_read,
            inbox_visible: states.done.map(|done| !done),
            calendar_only: states.calendar_only,
            notification_states: states
                .notification_states
                .iter()
                .map(|state| state.as_str().to_string())
                .collect(),
            sent: states.sent,
            has_draft: states.has_draft,
            attachment_kinds: states
                .attachments
                .iter()
                .copied()
                .map(attachment_kind)
                .collect(),
        };
        let ids = thread_ids_matching_states(&self.db, thread_ids, user.as_ref(), &filter)
            .await
            .map_err(|error| rootcause::report!("{error:#}"))?;
        Ok(ids.into_iter().collect())
    }
}
