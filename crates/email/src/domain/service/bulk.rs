use crate::domain::{
    models::{
        BulkThreadAction, BulkThreadActionResult, BulkThreadCursor, BulkThreadStart,
        BulkThreadTarget, BulkThreadTargetsPage, BulkThreadTargetsRequest, EmailErr,
        EmailThreadPreview, MAX_BULK_THREAD_TARGETS_PAGE, PreviewCursorQuery, PreviewView,
    },
    ports::{EmailBulkThreadService, EmailMessageEnqueuer, EmailRepo},
};
use crm::domain::service::CrmService;
use filter_ast::Expr;
use frecency::domain::ports::FrecencyQueryService;
use futures::{StreamExt, stream};
use item_filters::ast::{LiteralTree, email::EmailLiteral};
use macro_event_broker::MacroEventBroker;
use macro_user_id::{cowlike::CowLike, user_id::MacroUserIdStr};
use models_pagination::{Cursor, CursorVal, Query, SimpleSortMethod};
use std::sync::Arc;
use uuid::Uuid;

use super::EmailServiceImpl;

/// Mail lists order threads by latest activity; bulk targets follow them.
const BULK_THREAD_SORT: SimpleSortMethod = SimpleSortMethod::UpdatedAt;

/// Threads one bulk action request changes at the same time.
const BULK_THREAD_ACTION_CONCURRENCY: usize = 8;

/// The repository answers an empty filter with per-view queries that order
/// threads differently from the filtered query an anchor lookup needs, so an
/// absent filter becomes the filter that matches every thread.
fn query_filter(filter: LiteralTree<EmailLiteral>) -> Arc<Expr<EmailLiteral>> {
    filter.unwrap_or_else(|| Arc::new(Expr::Literal(EmailLiteral::CalendarOnly(false))))
}

fn only_thread(filter: &Arc<Expr<EmailLiteral>>, thread_id: Uuid) -> Arc<Expr<EmailLiteral>> {
    Arc::new(Expr::and(
        (**filter).clone(),
        Expr::Literal(EmailLiteral::ThreadId(thread_id)),
    ))
}

fn cursor_of(thread: &EmailThreadPreview) -> BulkThreadCursor {
    BulkThreadCursor {
        thread_id: thread.id,
        sort_ts: thread.sort_ts,
    }
}

fn target_of(thread: &EmailThreadPreview) -> BulkThreadTarget {
    BulkThreadTarget {
        id: thread.id,
        done: !thread.inbox_visible,
        read: thread.is_read,
        sort_ts: thread.sort_ts,
    }
}

impl<T, U, E, CS, Eam, B> EmailServiceImpl<T, U, E, CS, Eam, B>
where
    T: EmailRepo,
    anyhow::Error: From<T::Err>,
{
    async fn bulk_thread_page(
        &self,
        macro_id: &MacroUserIdStr<'static>,
        link_ids: &[Uuid],
        view: &PreviewView,
        filter: Arc<Expr<EmailLiteral>>,
        after: Option<BulkThreadCursor>,
        limit: u32,
    ) -> Result<Vec<EmailThreadPreview>, EmailErr> {
        let query = match after {
            None => Query::Sort(BULK_THREAD_SORT, Some(filter)),
            Some(after) => Query::Cursor(Cursor {
                id: after.thread_id,
                limit: limit as usize,
                val: CursorVal {
                    sort_type: BULK_THREAD_SORT,
                    last_val: after.sort_ts,
                },
                filter: Some(filter),
            }),
        };
        self.email_repo
            .previews_for_view_cursor(
                PreviewCursorQuery {
                    view: view.clone(),
                    link_ids: link_ids.to_vec(),
                    limit,
                    query,
                    team_id: None,
                },
                macro_id.clone(),
            )
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))
    }
}

impl<T, U, E, CS, Eam, B> EmailBulkThreadService for EmailServiceImpl<T, U, E, CS, Eam, B>
where
    T: EmailRepo,
    U: FrecencyQueryService,
    E: EmailMessageEnqueuer,
    CS: CrmService,
    Eam: Send + Sync + 'static,
    B: MacroEventBroker,
    anyhow::Error: From<T::Err>,
    anyhow::Error: From<E::Err>,
{
    #[tracing::instrument(err, skip_all, fields(user_id = %macro_id, view = %request.query.view))]
    async fn list_bulk_thread_targets(
        &self,
        macro_id: MacroUserIdStr<'static>,
        request: BulkThreadTargetsRequest,
    ) -> Result<BulkThreadTargetsPage, EmailErr> {
        let BulkThreadTargetsRequest {
            query,
            start,
            limit,
        } = request;
        let limit = limit.clamp(1, MAX_BULK_THREAD_TARGETS_PAGE);
        let filter = query_filter(query.filter);
        let link_ids: Vec<Uuid> = self
            .email_repo
            .inboxes_for_macro_id(macro_id.copied())
            .await
            .map_err(|e| EmailErr::RepoErr(anyhow::Error::from(e)))?
            .into_iter()
            .map(|link| link.id)
            .collect();

        let (mut threads, after) = match start {
            BulkThreadStart::Top => (Vec::new(), None),
            BulkThreadStart::After(after) => (Vec::new(), Some(after)),
            BulkThreadStart::FromThread(thread_id) => {
                let anchor = self
                    .bulk_thread_page(
                        &macro_id,
                        &link_ids,
                        &query.view,
                        only_thread(&filter, thread_id),
                        None,
                        1,
                    )
                    .await?
                    .into_iter()
                    .next()
                    .ok_or(EmailErr::ThreadNotFound)?;
                let after = cursor_of(&anchor);
                (vec![anchor], Some(after))
            }
        };

        // One row past the page tells whether another page exists.
        let remaining = limit.saturating_sub(threads.len() as u32);
        let page = self
            .bulk_thread_page(
                &macro_id,
                &link_ids,
                &query.view,
                filter,
                after,
                remaining + 1,
            )
            .await?;
        let has_more = page.len() as u32 > remaining;
        threads.extend(page.into_iter().take(remaining as usize));

        Ok(BulkThreadTargetsPage {
            next: threads.last().filter(|_| has_more).map(cursor_of),
            threads: threads.iter().map(target_of).collect(),
        })
    }

    #[tracing::instrument(skip_all, fields(user_id = %macro_id, count = thread_ids.len(), ?action))]
    async fn apply_bulk_thread_action(
        &self,
        macro_id: MacroUserIdStr<'static>,
        thread_ids: Vec<Uuid>,
        action: BulkThreadAction,
    ) -> BulkThreadActionResult {
        let outcomes: Vec<(Uuid, Result<(), EmailErr>)> = stream::iter(thread_ids)
            .map(|thread_id| {
                let macro_id = macro_id.clone();
                async move {
                    let outcome = match action {
                        BulkThreadAction::Archive => {
                            self.set_thread_archived_impl(macro_id, thread_id, true)
                                .await
                        }
                        BulkThreadAction::Unarchive => {
                            self.set_thread_archived_impl(macro_id, thread_id, false)
                                .await
                        }
                        BulkThreadAction::MarkRead => {
                            self.mark_thread_seen_impl(macro_id, thread_id).await
                        }
                        BulkThreadAction::MarkUnread => {
                            self.mark_thread_unread_impl(macro_id, thread_id).await
                        }
                    };
                    (thread_id, outcome)
                }
            })
            .buffered(BULK_THREAD_ACTION_CONCURRENCY)
            .collect()
            .await;

        let mut result = BulkThreadActionResult::default();
        for (thread_id, outcome) in outcomes {
            match outcome {
                Ok(()) => result.succeeded_ids.push(thread_id),
                Err(error) => {
                    tracing::warn!(error = ?error, %thread_id, ?action, "bulk thread action failed");
                    result.failed_ids.push(thread_id);
                }
            }
        }
        result
    }
}
