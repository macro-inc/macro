//! Stream-scoped ordered lists for the Soup lanes of a sync stream.
//!
//! A lane of the streamed cache sync pages through everything a filter
//! matches. Paged like any other Soup query, every page finds again which of
//! the user's items match, in order, below its cursor, so a lane costs
//! O(n²/limit) in the database. With [`SoupLaneLists`] in the request data
//! (one per stream), a lane is fetched many pages per statement, and each page
//! is the next slice of what was fetched with the cursor a normal page would
//! carry, so a page's variables still mean what they say: the same request
//! without the list returns the same page, read at most
//! [`ITEM_LIST_MAX_AGE`] later.

use std::{
    collections::VecDeque,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
    time::Duration,
};

use async_graphql::Context;
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use futures::future::BoxFuture;
use item_filters::ast::EntityFilterAst;
use models_pagination::{
    CursorVal, Identify, PaginateOn as _, PaginatedOpaqueCursor, SimpleSortMethod, SortOn,
    TypeEraseCursor as _,
};
use models_soup::item::SoupItem;
use soup::domain::{
    models::{SoupErr, SoupProjectionHydration, SoupQuery, SoupRequest, SoupSortDirection},
    ports::{SoupOutput, SoupService},
};

use tokio::time::Instant;

use crate::inputs::{SimpleSortKey, decode_simple_cursor};

#[cfg(test)]
mod test;

/// Items fetched per statement for a lane that selects only ids: the largest
/// Soup page.
const ID_CHUNK: u16 = u16::MAX;

/// Items fetched per statement for a lane that selects its items' fields. A
/// statement finds the user's matching items once however many it returns, so
/// more per statement costs the database less; a stream holds up to this many
/// items while it waits for its turn, which is what bounds it.
const ITEM_CHUNK: u16 = 5_000;

/// How long fetched items are served. A stream that waits for its turns sends
/// a lane's pages over minutes, and a page must not put fields into the cache
/// that changed long before it was sent; past this age the lane is read again
/// from where its pages got to. Ids are served whatever their age: they carry
/// no fields.
const ITEM_LIST_MAX_AGE: Duration = Duration::from_secs(30);

/// What a lane's pages select of their items, which decides how its list is
/// fetched.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum ListedFields {
    /// Only `__typename` and `id`.
    Ids,
    /// Anything else: items come with their cache projection facts.
    Items,
}

impl ListedFields {
    /// Items fetched per statement.
    fn chunk(self) -> u16 {
        match self {
            Self::Ids => ID_CHUNK,
            Self::Items => ITEM_CHUNK,
        }
    }
}

/// Ordered lists of the Soup lanes of one sync stream. Lanes run one after
/// another, so it holds the current lane's list only; a page that does not
/// continue it starts a new one.
#[derive(Clone, Default)]
pub struct SoupLaneLists(Arc<Mutex<Option<LaneList>>>);

/// What is fetched and not yet served of one lane.
struct LaneList {
    /// The cursor the next page continues from.
    next_cursor: String,
    /// The order the list is fetched in.
    direction: SoupSortDirection,
    /// The sort and filter every page's cursor carries.
    key: SimpleSortKey,
    /// What the lane's pages select.
    fields: ListedFields,
    /// Items fetched and not yet served, in page order.
    remaining: VecDeque<ListedItem>,
    /// When the oldest of `remaining` were fetched.
    fetched_at: Instant,
    /// Items the next statement asks for.
    chunk: u16,
    /// Where the next statement continues; `None` once the lane is fetched to
    /// its end.
    rest: Option<SoupQuery<EntityFilterAst>>,
}

/// A listed item, identified and sorted as the Soup service pages it.
struct ListedItem(SoupProjectionHydration);

impl Identify for ListedItem {
    type Id = String;

    fn id(&self) -> Self::Id {
        self.0.item.entity().entity_id.to_string()
    }
}

impl SortOn<SimpleSortMethod> for ListedItem {
    fn sort_on(sort: SimpleSortMethod) -> impl FnMut(&Self) -> CursorVal<SimpleSortMethod> {
        let mut sort_item = SoupItem::sort_on(sort);
        move |item| sort_item(&item.0.item)
    }
}

/// Whether the `soup` field selects nothing of its items but `__typename`
/// and `id`.
pub(crate) fn selects_ids_only(ctx: &Context<'_>) -> bool {
    let items = ctx.look_ahead().field("items").selection_fields();
    !items.is_empty()
        && items.iter().all(|items| {
            let mut fields = items.selection_set().peekable();
            fields.peek().is_some()
                && fields.all(|field| matches!(field.name(), "__typename" | "id"))
        })
}

impl SoupLaneLists {
    /// The page `request` asks for, served from the lane's list. Starts the
    /// list (from where `request` starts) unless `continuation` is the cursor
    /// the previous page of the list returned, and fetches more of the lane
    /// when the list holds less than the page.
    ///
    /// Boxed here, not in the caller: unoptimized builds give every future a
    /// caller builds its own slot in the caller's poll frame, and this one
    /// holds a whole Soup service call, which overflows a worker's stack
    /// when it sits next to the resolver's other Soup calls.
    pub(crate) fn page<'a, S: SoupService>(
        &'a self,
        service: &'a S,
        request: SoupRequest<EntityFilterAst>,
        key: SimpleSortKey,
        fields: ListedFields,
        continuation: Option<&'a str>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> BoxFuture<'a, async_graphql::Result<PaginatedOpaqueCursor<SoupProjectionHydration>>> {
        Box::pin(self.page_inner(service, request, key, fields, continuation, team_receipt))
    }

    async fn page_inner<S: SoupService>(
        &self,
        service: &S,
        request: SoupRequest<EntityFilterAst>,
        key: SimpleSortKey,
        fields: ListedFields,
        continuation: Option<&str>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> async_graphql::Result<PaginatedOpaqueCursor<SoupProjectionHydration>> {
        let limit = request.limit.max(1);
        let SoupRequest {
            soup_type,
            cursor,
            sort_direction,
            user,
            email_preview_view,
            link_ids,
            ..
        } = request;
        // Taken out while the page is built: a list is left behind only by a
        // page that has a next one.
        let continued = self.lock().take().filter(|list| {
            continuation == Some(list.next_cursor.as_str())
                && list.direction == sort_direction
                && list.fields == fields
        });
        let mut list = match continued {
            Some(mut list) => {
                if list.is_outdated() {
                    list.read_again_from(cursor, limit);
                }
                list
            }
            None => LaneList {
                next_cursor: String::new(),
                direction: sort_direction,
                key,
                fields,
                remaining: VecDeque::new(),
                fetched_at: Instant::now(),
                chunk: fields.chunk(),
                rest: Some(cursor),
            },
        };

        while list.remaining.len() < usize::from(limit)
            && let Some(cursor) = list.rest.take()
        {
            if list.remaining.is_empty() {
                list.fetched_at = Instant::now();
            }
            let chunk = SoupRequest {
                soup_type,
                // Never less than the page: a page is one statement at most.
                limit: list.chunk.max(limit),
                cursor,
                sort_direction,
                user: user.clone(),
                email_preview_view: email_preview_view.clone(),
                link_ids: link_ids.clone(),
            };
            let Some(fetched) = soup_chunk(service, chunk, fields, team_receipt.clone())
                .await?
                .into_simple()
            else {
                return Err(async_graphql::Error::new(
                    "a Soup lane list needs a timestamp sort",
                ));
            };
            list.remaining
                .extend(fetched.items.into_iter().map(ListedItem));
            if let Some(next) = fetched.next_cursor {
                list.rest = Some(SoupQuery::new_cursor_simple(decode_simple_cursor(
                    next.type_erase(),
                )?));
            }
        }

        let page = list.take_page(limit);
        if page.next_cursor.is_some() {
            *self.lock() = Some(list);
        }
        Ok(page)
    }

    /// The list, also after a panic elsewhere left the lock poisoned: every
    /// state of it is a valid list.
    fn lock(&self) -> MutexGuard<'_, Option<LaneList>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl LaneList {
    /// Whether the fetched items are too old to serve.
    fn is_outdated(&self) -> bool {
        self.fields == ListedFields::Items
            && !self.remaining.is_empty()
            && self.fetched_at.elapsed() >= ITEM_LIST_MAX_AGE
    }

    /// Drops the fetched items and continues the lane from `cursor`, the
    /// request's own. This stream's pages come slowly, so the next statements
    /// fetch half as many items, and never less than a page of `limit`.
    fn read_again_from(&mut self, cursor: SoupQuery<EntityFilterAst>, limit: u16) {
        self.remaining.clear();
        self.rest = Some(cursor);
        self.chunk = (self.chunk / 2).max(limit);
    }

    /// The next `limit` items, with a cursor exactly when the page is full (as
    /// the Soup paginator does); the list is used up when it has none.
    fn take_page(&mut self, limit: u16) -> PaginatedOpaqueCursor<SoupProjectionHydration> {
        let take = usize::from(limit).min(self.remaining.len());
        let page = self
            .remaining
            .drain(..take)
            .paginate_on(usize::from(limit), self.key.sort)
            .filter_on(self.key.filter.clone())
            .into_page()
            .type_erase()
            .map(|item| item.0);
        if let Some(cursor) = &page.next_cursor {
            self.next_cursor.clone_from(cursor);
        }
        page
    }
}

/// One Soup service call for the next items of a lane, boxed so its future
/// gets no slot in the caller's poll frame (see [`SoupLaneLists::page`]).
fn soup_chunk<'a, S: SoupService>(
    service: &'a S,
    request: SoupRequest<EntityFilterAst>,
    fields: ListedFields,
    team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
) -> BoxFuture<'a, Result<SoupOutput<EntityFilterAst, SoupProjectionHydration>, SoupErr>> {
    Box::pin(async move {
        match fields {
            ListedFields::Ids => {
                Ok(service
                    .get_user_soup(request, team_receipt)
                    .await?
                    .map(|item| SoupProjectionHydration {
                        item,
                        document_server_facts: None,
                        sort_key: None,
                    }))
            }
            ListedFields::Items => {
                service
                    .get_user_soup_with_projection(request, team_receipt)
                    .await
            }
        }
    })
}
