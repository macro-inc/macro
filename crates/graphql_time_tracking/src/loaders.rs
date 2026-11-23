//! Lazy, viewer-scoped time entries composed onto Soup documents.

use std::{collections::HashMap, convert::Infallible, sync::Arc};

use async_graphql::{
    Context,
    dataloader::{DataLoader, Loader},
};
use chrono::NaiveDate;
use futures::{StreamExt, stream};
use macro_user_id::user_id::MacroUserIdStr;
use time_tracking::domain::models::{TimeEntryCursor, TimeEntryPage, TimeEntryPageRequest};
use tracing::Instrument;
use uuid::Uuid;

use crate::{
    GraphqlTimeEntry, GraphqlTimeEntryPage, TimeTrackingGraphqlContext, graphql_error,
    inputs::{encode_cursor, page_request},
};

/// Bound concurrent domain reads; the domain reads one task's entries at a time.
const MAX_CONCURRENT_READS: usize = 16;

/// One page of one task's entries.
#[derive(Debug, Clone, PartialEq, Eq, Hash)]
pub struct TimeEntriesKey {
    task_id: String,
    limit: Option<u8>,
    after: Option<(NaiveDate, Uuid)>,
}

impl TimeEntriesKey {
    fn page(&self) -> TimeEntryPageRequest {
        TimeEntryPageRequest {
            limit: self.limit,
            after: self.after.map(|(date, id)| TimeEntryCursor { date, id }),
        }
    }
}

/// Viewer-scoped entries reader; each task's read mints its own view receipt.
pub struct TimeEntriesLoader {
    context: TimeTrackingGraphqlContext,
    user: MacroUserIdStr<'static>,
}

impl Loader<TimeEntriesKey> for TimeEntriesLoader {
    type Value = async_graphql::Result<Arc<TimeEntryPage>>;
    type Error = Infallible;

    #[tracing::instrument(
        name = "graphql_time_tracking.load_entries",
        skip_all,
        fields(task_count = keys.len())
    )]
    async fn load(
        &self,
        keys: &[TimeEntriesKey],
    ) -> Result<HashMap<TimeEntriesKey, Self::Value>, Self::Error> {
        Ok(stream::iter(keys.iter().cloned().map(|key| async move {
            let page = self
                .context
                .0
                .entries(self.user.clone(), key.task_id.clone(), key.page())
                .await
                .map(Arc::new)
                .map_err(graphql_error);
            (key, page)
        }))
        .buffer_unordered(MAX_CONCURRENT_READS)
        .collect()
        .await)
    }
}

/// Coalesce the entries edges of a request's documents without retaining data
/// across mutations or subscription events.
pub fn time_entries_loader(
    context: TimeTrackingGraphqlContext,
    user: MacroUserIdStr<'static>,
) -> DataLoader<TimeEntriesLoader> {
    DataLoader::new(TimeEntriesLoader { context, user }, |batch| {
        tokio::spawn(batch.in_current_span())
    })
}

/// Load a page of the document's entries only when the edge is requested.
pub async fn load_time_entries(
    ctx: &Context<'_>,
    document_id: Uuid,
    limit: Option<i32>,
    after: Option<String>,
) -> async_graphql::Result<GraphqlTimeEntryPage> {
    let page = page_request(limit, after.as_deref())?;
    let key = TimeEntriesKey {
        task_id: document_id.to_string(),
        limit: page.limit,
        after: page.after.map(|cursor| (cursor.date, cursor.id)),
    };
    let viewer = graphql_common::require_authenticated_user(ctx)?;
    let loaded = match ctx
        .data::<DataLoader<TimeEntriesLoader>>()?
        .load_one(key)
        .await
    {
        Ok(Some(page)) => page?,
        Ok(None) => return Err(async_graphql::Error::new("time entries are unavailable")),
        Err(impossible) => match impossible {},
    };
    Ok(GraphqlTimeEntryPage {
        entries: loaded
            .entries
            .iter()
            .cloned()
            .map(|entry| GraphqlTimeEntry::new(entry, &viewer))
            .collect(),
        next_cursor: loaded.next_cursor.map(encode_cursor).transpose()?,
    })
}
