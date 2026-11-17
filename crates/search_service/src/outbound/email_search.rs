//! Postgres reads behind email search scoping.

use std::collections::HashSet;

use email_db_client::threads::search_filters::{
    ThreadStateFilter, calendar_thread_ids, thread_ids_matching_states,
};
use entity_access::outbound::{get_user_source_ids, shared_email_threads};
use macro_user_id::{lowercased::Lowercase, user_id::MacroUserId};
use readonly_pool::ReadOnlyPool;
use rootcause::Report;
use uuid::Uuid;

use crate::domain::email_search::{EmailSearchSource, SharedThread, ThreadStates};

pub(crate) struct EmailSearchPgSource {
    pub db: ReadOnlyPool,
}

fn limit(limit: usize) -> i64 {
    i64::try_from(limit).unwrap_or(i64::MAX)
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
        Ok(threads
            .into_iter()
            .map(|thread| SharedThread {
                thread_id: thread.thread_id,
                link_id: thread.link_id,
            })
            .collect())
    }

    async fn calendar_threads(&self, link_ids: &[Uuid], max: usize) -> Result<Vec<Uuid>, Report> {
        calendar_thread_ids(&self.db, link_ids, limit(max))
            .await
            .map_err(|error| rootcause::report!("{error:#}"))
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
        };
        let ids = thread_ids_matching_states(&self.db, thread_ids, user.as_ref(), &filter)
            .await
            .map_err(|error| rootcause::report!("{error:#}"))?;
        Ok(ids.into_iter().collect())
    }
}
