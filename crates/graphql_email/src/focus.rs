//! Focus: the importance classification stored for signal email threads.

use std::{collections::HashMap, sync::Arc};

use async_graphql::{Context, Enum, SimpleObject, dataloader::DataLoader, dataloader::Loader};
use email::domain::focus::{FocusCategory, FocusQueries, FocusStore, ImportanceTrend, ThreadFocus};
use futures::future::BoxFuture;
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

#[cfg(test)]
mod test;

/// Most thread ids folded into one Focus lookup.
const MAX_FOCUS_KEYS: usize = 500;

/// Focus reads on behalf of a viewer, limited to the viewer's own inboxes.
pub trait EmailFocusReader: Send + Sync + 'static {
    /// The viewer's Focus threads with mail in the last `window_days`,
    /// newest first by latest message time, in either direction.
    fn focus_thread_ids<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'static>,
        window_days: u16,
    ) -> BoxFuture<'a, Result<Vec<Uuid>, rootcause::Report>>;

    /// Stored classifications for the viewer's threads among `thread_ids`.
    fn focus_for_threads<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'static>,
        thread_ids: Vec<Uuid>,
    ) -> BoxFuture<'a, Result<HashMap<Uuid, ThreadFocus>, rootcause::Report>>;
}

impl<S: FocusStore> EmailFocusReader for FocusQueries<S> {
    fn focus_thread_ids<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'static>,
        window_days: u16,
    ) -> BoxFuture<'a, Result<Vec<Uuid>, rootcause::Report>> {
        Box::pin(FocusQueries::focus_thread_ids(self, user, window_days))
    }

    fn focus_for_threads<'a>(
        &'a self,
        user: &'a MacroUserIdStr<'static>,
        thread_ids: Vec<Uuid>,
    ) -> BoxFuture<'a, Result<HashMap<Uuid, ThreadFocus>, rootcause::Report>> {
        Box::pin(async move { FocusQueries::focus_for_threads(self, user, &thread_ids).await })
    }
}

/// The Focus reader for one request, supplied by the composition root.
#[derive(Clone)]
pub struct EmailFocusContext(pub Arc<dyn EmailFocusReader>);

/// Why a thread is in or out of Focus.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Enum)]
#[graphql(name = "GraphqlEmailFocusCategory")]
pub enum GraphqlEmailFocusCategory {
    /// A customer, client or user asking for help or giving feedback.
    Customer,
    /// Mail from someone at the owner's own company.
    Team,
    /// Mail from someone the owner corresponds with.
    Known,
    /// Relevant mail that fits no narrower category.
    Other,
    /// In Focus, a reschedule, update, cancellation or proposed new time for an
    /// event that isn't over. Left out, a new invite or an RSVP notice.
    Calendar,
    /// Unsolicited outreach: a pitch, recruiting or a job application.
    Outreach,
    /// Automated, bulk or templated mail.
    Automated,
    /// Nothing marks the thread as relevant.
    LowRelevance,
}

impl From<FocusCategory> for GraphqlEmailFocusCategory {
    fn from(category: FocusCategory) -> Self {
        match category {
            FocusCategory::Customer => Self::Customer,
            FocusCategory::Team => Self::Team,
            FocusCategory::Known => Self::Known,
            FocusCategory::Other => Self::Other,
            FocusCategory::Calendar => Self::Calendar,
            FocusCategory::Outreach => Self::Outreach,
            FocusCategory::Automated => Self::Automated,
            FocusCategory::LowRelevance => Self::LowRelevance,
        }
    }
}

/// Which way a thread's importance is moving.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Enum)]
#[graphql(name = "GraphqlEmailImportanceTrend")]
pub enum GraphqlEmailImportanceTrend {
    /// Rising, towards 100.
    Up,
    /// Falling, towards 0.
    Down,
    /// Not moving.
    Flat,
}

impl From<ImportanceTrend> for GraphqlEmailImportanceTrend {
    fn from(trend: ImportanceTrend) -> Self {
        match trend {
            ImportanceTrend::Up => Self::Up,
            ImportanceTrend::Down => Self::Down,
            ImportanceTrend::Flat => Self::Flat,
        }
    }
}

/// The Focus classification of one email thread.
#[derive(Debug, Clone, SimpleObject)]
#[graphql(name = "GraphqlEmailThreadFocus")]
pub struct GraphqlEmailThreadFocus {
    /// Whether the thread belongs in Focus.
    is_focus: bool,
    /// The Focus category, or why the thread was left out.
    category: GraphqlEmailFocusCategory,
    /// How much the thread matters right now, 0 to 100.
    importance: i32,
    /// Someone else sent the latest message and it waits on the owner's answer.
    /// Never true together with `needs_follow_up`.
    needs_reply: bool,
    /// The owner sent the latest message and should come back to the thread: it
    /// has an open loop or has waited for an answer. Never true together with
    /// `needs_reply`.
    needs_follow_up: bool,
    /// When the classification was made, in RFC 3339 format.
    classified_at: String,
    /// Which way `importance` is moving.
    importance_trend: GraphqlEmailImportanceTrend,
}

impl From<ThreadFocus> for GraphqlEmailThreadFocus {
    fn from(focus: ThreadFocus) -> Self {
        Self {
            is_focus: focus.is_focus,
            category: focus.category.into(),
            importance: i32::from(focus.importance),
            needs_reply: focus.needs_reply,
            needs_follow_up: focus.needs_follow_up,
            classified_at: focus.classified_at.to_rfc3339(),
            importance_trend: focus.importance_trend.into(),
        }
    }
}

/// DataLoader for the viewer's stored Focus classifications.
pub struct EmailThreadFocusLoader {
    user_id: MacroUserIdStr<'static>,
    reader: Arc<dyn EmailFocusReader>,
}

impl Loader<Uuid> for EmailThreadFocusLoader {
    type Value = ThreadFocus;
    type Error = Arc<rootcause::Report>;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, Self::Value>, Self::Error> {
        self.reader
            .focus_for_threads(&self.user_id, keys.to_vec())
            .await
            // Once per batch; every thread in it then fails with the same error.
            .inspect_err(|error| {
                tracing::error!(error = ?error, threads = keys.len(), "email thread focus load failed");
            })
            .map_err(Arc::new)
    }
}

/// Build a Focus DataLoader scoped to the requesting user.
pub fn email_thread_focus_loader(
    user_id: MacroUserIdStr<'static>,
    reader: Arc<dyn EmailFocusReader>,
) -> DataLoader<EmailThreadFocusLoader> {
    let loader = DataLoader::new(EmailThreadFocusLoader { user_id, reader }, tokio::spawn)
        .max_batch_size(MAX_FOCUS_KEYS);
    // Subscription connection data outlives one payload; never serve a stale verdict.
    loader.enable_all_cache(false);
    loader
}

/// The stored Focus classification of a thread, or `None` when the thread is
/// unclassified, belongs to someone else's inbox, or Focus is not served here.
pub async fn load_email_thread_focus(
    ctx: &Context<'_>,
    thread_id: Uuid,
) -> async_graphql::Result<Option<GraphqlEmailThreadFocus>> {
    let Some(loader) = ctx.data_opt::<DataLoader<EmailThreadFocusLoader>>() else {
        return Ok(None);
    };
    loader
        .load_one(thread_id)
        .await
        .map(|focus| focus.map(Into::into))
        .map_err(|_| async_graphql::Error::new("email thread focus is unavailable"))
}

/// The viewer's Focus thread ids, newest first; empty when Focus is not served
/// here.
pub async fn load_email_focus_thread_ids(
    ctx: &Context<'_>,
    user_id: &MacroUserIdStr<'static>,
    window_days: u16,
) -> async_graphql::Result<Vec<Uuid>> {
    let Some(EmailFocusContext(reader)) = ctx.data_opt::<EmailFocusContext>() else {
        return Ok(Vec::new());
    };
    reader
        .focus_thread_ids(user_id, window_days)
        .await
        .map_err(|error| {
            tracing::error!(error = ?error, "email focus list load failed");
            async_graphql::Error::new("email focus is unavailable")
        })
}
