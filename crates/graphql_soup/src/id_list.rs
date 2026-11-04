//! Stream-scoped ordered id lists for ID-only Soup pages.
//!
//! The streamed cache sync's membership lanes select only `__typename id` and
//! page through everything a filter matches. Paged like any other Soup query,
//! every page re-runs the whole filter below its cursor, so a lane costs
//! O(n²/limit) in the database. With [`SoupIdLists`] in the request data (one
//! per stream), the first ID-only page of a lane fetches the lane's whole
//! ordered list at once, and each following page is the next slice of it with
//! the cursor a normal page would carry, so a page's variables still mean what
//! they say: the same request without the list returns the same page.

use std::{
    collections::VecDeque,
    sync::{Arc, Mutex, MutexGuard, PoisonError},
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
    models::{SoupErr, SoupQuery, SoupRequest, SoupSortDirection},
    ports::{SoupOutput, SoupService},
};

use crate::inputs::{SimpleSortKey, decode_simple_cursor};

#[cfg(test)]
mod test;

/// Items fetched per statement while building a list: the largest Soup page.
const LIST_CHUNK: u16 = u16::MAX;

/// Ordered id lists of the ID-only Soup lanes of one sync stream. Lanes run
/// one after another, so it holds the current lane's list only; a page that
/// does not continue it starts a new one.
#[derive(Clone, Default)]
pub struct SoupIdLists(Arc<Mutex<Option<IdList>>>);

/// The rest of one lane's list.
struct IdList {
    /// The cursor the next page continues from.
    next_cursor: String,
    /// The order the list was fetched in.
    direction: SoupSortDirection,
    /// The sort and filter every page's cursor carries.
    key: SimpleSortKey,
    /// Items not yet served, in page order.
    remaining: VecDeque<ListedItem>,
}

/// A listed item, identified and sorted as the Soup service pages it.
struct ListedItem(SoupItem<()>);

impl Identify for ListedItem {
    type Id = String;

    fn id(&self) -> Self::Id {
        self.0.entity().entity_id.to_string()
    }
}

impl SortOn<SimpleSortMethod> for ListedItem {
    fn sort_on(sort: SimpleSortMethod) -> impl FnMut(&Self) -> CursorVal<SimpleSortMethod> {
        let mut sort_item = SoupItem::sort_on(sort);
        move |item| sort_item(&item.0)
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

impl SoupIdLists {
    /// The page `request` asks for, served from the lane's list. Builds the
    /// list (from where `request` starts) unless `continuation` is the cursor
    /// the previous page of the list returned.
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
        continuation: Option<&'a str>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> BoxFuture<'a, async_graphql::Result<PaginatedOpaqueCursor<SoupItem<()>>>> {
        Box::pin(self.page_inner(service, request, key, continuation, team_receipt))
    }

    async fn page_inner<S: SoupService>(
        &self,
        service: &S,
        request: SoupRequest<EntityFilterAst>,
        key: SimpleSortKey,
        continuation: Option<&str>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> async_graphql::Result<PaginatedOpaqueCursor<SoupItem<()>>> {
        let limit = request.limit.max(1);
        let direction = request.sort_direction;
        {
            let mut list = self.lock();
            if let Some(mut current) = list.take()
                && continuation == Some(current.next_cursor.as_str())
                && current.direction == direction
            {
                let page = current.take_page(limit);
                *list = page.next_cursor.is_some().then_some(current);
                return Ok(page);
            }
        }
        let mut current = IdList {
            next_cursor: String::new(),
            direction,
            key,
            remaining: fetch_all(service, request, team_receipt).await?,
        };
        let page = current.take_page(limit);
        *self.lock() = page.next_cursor.is_some().then_some(current);
        Ok(page)
    }

    /// The list, also after a panic elsewhere left the lock poisoned: every
    /// state of it is a valid list.
    fn lock(&self) -> MutexGuard<'_, Option<IdList>> {
        self.0.lock().unwrap_or_else(PoisonError::into_inner)
    }
}

impl IdList {
    /// The next `limit` items, with a cursor exactly when the page is full (as
    /// the Soup paginator does); the list is used up when it has none.
    fn take_page(&mut self, limit: u16) -> PaginatedOpaqueCursor<SoupItem<()>> {
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

/// Every item `request` would page through from its start, in page order,
/// in as few statements as the largest Soup page allows.
async fn fetch_all<S: SoupService>(
    service: &S,
    request: SoupRequest<EntityFilterAst>,
    team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
) -> async_graphql::Result<VecDeque<ListedItem>> {
    let SoupRequest {
        soup_type,
        cursor,
        sort_direction,
        user,
        email_preview_view,
        link_ids,
        ..
    } = request;
    let mut items = VecDeque::new();
    let mut cursor = cursor;
    loop {
        let chunk = SoupRequest {
            soup_type,
            limit: LIST_CHUNK,
            cursor,
            sort_direction,
            user: user.clone(),
            email_preview_view: email_preview_view.clone(),
            link_ids: link_ids.clone(),
        };
        let Some(page) = soup_chunk(service, chunk, team_receipt.clone())
            .await?
            .into_simple()
        else {
            return Err(async_graphql::Error::new(
                "an ID-only Soup list needs a timestamp sort",
            ));
        };
        items.extend(page.items.into_iter().map(ListedItem));
        match page.next_cursor {
            Some(next) => {
                cursor = SoupQuery::new_cursor_simple(decode_simple_cursor(next.type_erase())?);
            }
            None => return Ok(items),
        }
    }
}

/// One Soup service call, boxed so its future gets no slot in `fetch_all`'s
/// poll frame (see [`SoupIdLists::page`]).
fn soup_chunk<'a, S: SoupService>(
    service: &'a S,
    request: SoupRequest<EntityFilterAst>,
    team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
) -> BoxFuture<'a, Result<SoupOutput<EntityFilterAst>, SoupErr>> {
    Box::pin(service.get_user_soup(request, team_receipt))
}
