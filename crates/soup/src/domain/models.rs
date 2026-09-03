pub mod grouping;

#[cfg(test)]
mod test;

use call::domain::models::GetCallRecordsRequest;
use channels::domain::models::{GetChannelsRequest, GetThreadReplyRowsRequest};
use crm::domain::auth::CrmTeamReceipt;
use crm::domain::companies_repo::{CrmCompanyListSort, CrmCompanySoupCursor};
use email::domain::models::{GetEmailsRequest, PreviewView};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use filter_ast::Expr;
use foreign_entity::domain::{
    models::{ForeignEntityError, SourceId},
    ports::ForeignEntityListQuery,
};
use frecency::domain::models::{AggregateFrecency, FrecencyQueryErr};
use item_filters::{
    EntityFilters,
    ast::{
        EntityFilterAst, ExpandErr,
        calendar_event::CalendarEventLiteral,
        call::CallLiteral,
        crm_company::CrmCompanyLiteral,
        email::EmailLiteral,
        properties::{
            PropertiesLiteral, PropertyEntityType, properties_filter_can_apply_to,
            properties_filter_matches_propertyless,
        },
        reminder::ReminderLiteral,
    },
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use models_grouping::GroupingConfig;
use models_pagination::{
    Cursor, CursorWithValAndFilter, Frecency, NotifiedAt, Query, SimpleSortMethod, TouchedByMe,
};
use models_soup::SoupProperty;
use models_soup::item::SoupItem;
use non_empty::IsEmpty;
use recursion::CollapsibleExt;
use reminders::domain::models::SoupOrder;
use serde::{Deserialize, Serialize};
use std::sync::Arc;
use thiserror::Error;
use uuid::Uuid;

/// Direction the merged Soup page is ordered in.
///
/// Deliberately Soup's own type rather than one borrowed from the paginator:
/// `Paginator` already exposes `sort_asc`/`sort_desc`, so this only has to name
/// the choice, and doing it here keeps the shared pagination crate untouched.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub enum SoupSortDirection {
    /// Smallest sort value first — oldest, or soonest for a future timestamp.
    Asc,
    /// Largest sort value first. What every view but Scheduled reminders wants.
    #[default]
    Desc,
}

/// Controls whether soup items should include expanded nested data.
#[derive(Debug, Clone, Copy)]
pub enum SoupType {
    /// Return fully expanded soup items.
    Expanded,
    /// Return compact soup items without expanded nested data.
    UnExpanded,
}

/// the parameters required for a [SimpleSortMethod]
#[derive(Debug, Clone)]
pub struct SimpleSortRequest<'a> {
    /// the limit of the number of items to return
    pub(crate) limit: u16,
    /// the [Query] the client passes (if any)
    pub(crate) cursor: SimpleSortQuery,
    /// the id of the user
    pub(crate) user_id: MacroUserIdStr<'a>,
}

/// Parameters for grouped soup queries.
#[derive(Debug)]
pub struct GroupedSortRequest<'a> {
    /// the limit of the number of items to return
    pub limit: u16,
    /// the cursor/query
    pub cursor: Query<Uuid, SimpleSortMethod, EntityFilterAst>,
    /// the id of the user
    pub user_id: MacroUserIdStr<'a>,
    /// grouping configuration
    pub grouping: GroupingConfig,
}

#[derive(Debug, Clone)]
pub(crate) enum SimpleSortQuery {
    /// we dont have anything to filter out
    NoFilter(Query<Uuid, SimpleSortMethod, ()>),
    /// we filter out items that DO have a [Frecency] record
    FilterFrecency(Query<Uuid, SimpleSortMethod, Frecency>),
    /// we filter out items based on the input [EntityFilterAst]
    ItemsFilter(Query<Uuid, SimpleSortMethod, EntityFilterAst>),
    /// we filter out items based on the input [EntityFilterAst] IN ADDITION to ANY items that DO have a [Frecency] score
    ItemsAndFrecencyFilter(Query<Uuid, SimpleSortMethod, (Frecency, EntityFilterAst)>),
}

impl SimpleSortQuery {
    pub(crate) fn from_entity_cursor(
        cursor: Query<Uuid, SimpleSortMethod, Option<EntityFilterAst>>,
    ) -> Self {
        match cursor {
            Query::Sort(s, Some(f)) => SimpleSortQuery::ItemsFilter(Query::Sort(s, f)),
            Query::Sort(s, None) => SimpleSortQuery::NoFilter(Query::Sort(s, ())),
            Query::Cursor(Cursor {
                id,
                limit,
                val,
                filter: Some(filter),
            }) => SimpleSortQuery::ItemsFilter(Query::Cursor(Cursor {
                id,
                limit,
                val,
                filter,
            })),
            Query::Cursor(Cursor {
                id,
                limit,
                val,
                filter: None,
            }) => SimpleSortQuery::NoFilter(Query::Cursor(Cursor {
                id,
                limit,
                val,
                filter: (),
            })),
        }
    }
}

impl SimpleSortQuery {
    pub(crate) fn sort_method(&self) -> &SimpleSortMethod {
        match self {
            SimpleSortQuery::NoFilter(query) => query.sort_method(),
            SimpleSortQuery::FilterFrecency(query) => query.sort_method(),
            SimpleSortQuery::ItemsFilter(query) => query.sort_method(),
            SimpleSortQuery::ItemsAndFrecencyFilter(query) => query.sort_method(),
        }
    }
}

/// Parameters for fetching soup items by an explicit ordered entity list.
#[derive(Debug, Clone)]
pub struct AdvancedSortParams<'a> {
    /// Entities to fetch and preserve in the requested order.
    pub entities: &'a [Entity<'a>],
    /// User whose accessible soup items should be fetched.
    pub user_id: MacroUserIdStr<'a>,
}

/// Cursor or initial-sort query for a soup request.
#[derive(Debug)]
pub enum SoupQuery<T> {
    /// Query sorted by a simple timestamp-based method.
    Simple(SimpleQueryInner<T>),
    /// Query sorted by frecency.
    Frecency(FrecencyQueryInner<T>),
    /// Query filtered and sorted by the user's own latest mutation per
    /// entity (the activity log's touched-by-me surface).
    Touched(TouchedQueryInner<T>),
    /// Query filtered and sorted by the user's latest notification per
    /// entity (the inbox's notified-at surface).
    Notified(NotifiedQueryInner<T>),
}

impl<T> SoupQuery<T> {
    pub(crate) fn map<F, U>(self, f: F) -> SoupQuery<U>
    where
        F: FnOnce(T) -> U,
    {
        match self {
            SoupQuery::Simple(SimpleQueryInner(i)) => {
                SoupQuery::Simple(SimpleQueryInner(i.map_filter(f)))
            }
            SoupQuery::Frecency(FrecencyQueryInner(i)) => {
                SoupQuery::Frecency(FrecencyQueryInner(i.map_filter(f)))
            }
            SoupQuery::Touched(TouchedQueryInner(i)) => {
                SoupQuery::Touched(TouchedQueryInner(i.map_filter(f)))
            }
            SoupQuery::Notified(NotifiedQueryInner(i)) => {
                SoupQuery::Notified(NotifiedQueryInner(i.map_filter(f)))
            }
        }
    }
}

/// the inner private type for [SoupQuery::Simple]
#[derive(Debug)]
pub struct SimpleQueryInner<T>(pub(crate) Query<Uuid, SimpleSortMethod, T>);

/// the inner private type for [SoupQuery::Frecency]
#[derive(Debug)]
pub struct FrecencyQueryInner<T>(pub(crate) Query<Uuid, Frecency, T>);

/// the inner private type for [SoupQuery::Touched]
///
/// The id is a [String] rather than a [Uuid]: touched cursors key into the
/// activity log's TEXT `entity_id` column, and the raw string must survive
/// the cursor round-trip byte-for-byte (see
/// [`TouchedPagePosition::entity_id`]).
#[derive(Debug)]
pub struct TouchedQueryInner<T>(pub(crate) Query<String, TouchedByMe, T>);

/// the inner private type for [SoupQuery::Notified]
///
/// The id is a [String] for the same reason as [`TouchedQueryInner`]: the
/// keyset compares it byte-for-byte against `notification.event_item_id`,
/// an unconstrained TEXT column.
#[derive(Debug)]
pub struct NotifiedQueryInner<T>(pub(crate) Query<String, NotifiedAt, T>);

impl<T> SoupQuery<T> {
    /// create a new instance of a [SimpleSortMethod] with [T] this is used to
    /// construct the initial page request. To paginate an existing cursor see [Self::new_cursor_simple]
    pub fn new_sort_simple(method: SimpleSortMethod, filters: T) -> Self {
        SoupQuery::Simple(SimpleQueryInner(models_pagination::Query::Sort(
            method, filters,
        )))
    }

    /// create a new instance of a [Frecency] with [T] this is used to
    /// construct the initial page request. To paginate an existing cursor see [Self::new_cursor_frecency]
    pub fn new_sort_frecency(method: Frecency, filters: T) -> Self {
        SoupQuery::Frecency(FrecencyQueryInner(models_pagination::Query::Sort(
            method, filters,
        )))
    }

    /// create a new instance of a [SimpleSortMethod] with an existing cursor on [T].
    /// This is used to continue paginating on an existing cursor.
    /// To create a new initial page see [Self::new_sort_simple]
    pub fn new_cursor_simple(cursor: CursorWithValAndFilter<Uuid, SimpleSortMethod, T>) -> Self {
        SoupQuery::Simple(SimpleQueryInner(models_pagination::Query::Cursor(cursor)))
    }

    /// create a new instance of a [Frecency] with an existing cursor on [T].
    /// This is used to continue paginating on an existing cursor.
    /// To create a new initial page see [Self::new_sort_simple]
    pub fn new_cursor_frecency(cursor: CursorWithValAndFilter<Uuid, Frecency, T>) -> Self {
        SoupQuery::Frecency(FrecencyQueryInner(models_pagination::Query::Cursor(cursor)))
    }

    /// create a new instance of a [TouchedByMe] query with [T]. This is used
    /// to construct the initial page request. To paginate an existing cursor
    /// see [Self::new_cursor_touched]
    pub fn new_sort_touched(filters: T) -> Self {
        SoupQuery::Touched(TouchedQueryInner(models_pagination::Query::Sort(
            TouchedByMe,
            filters,
        )))
    }

    /// create a new instance of a [TouchedByMe] query with an existing cursor
    /// on [T]. This is used to continue paginating on an existing cursor.
    /// To create a new initial page see [Self::new_sort_touched]
    pub fn new_cursor_touched(cursor: CursorWithValAndFilter<String, TouchedByMe, T>) -> Self {
        SoupQuery::Touched(TouchedQueryInner(models_pagination::Query::Cursor(cursor)))
    }

    /// create a new instance of a [NotifiedAt] query with [T]. This is used
    /// to construct the initial page request. To paginate an existing cursor
    /// see [Self::new_cursor_notified]
    pub fn new_sort_notified(filters: T) -> Self {
        SoupQuery::Notified(NotifiedQueryInner(models_pagination::Query::Sort(
            NotifiedAt, filters,
        )))
    }

    /// create a new instance of a [NotifiedAt] query with an existing cursor
    /// on [T]. This is used to continue paginating on an existing cursor.
    /// To create a new initial page see [Self::new_sort_notified]
    pub fn new_cursor_notified(cursor: CursorWithValAndFilter<String, NotifiedAt, T>) -> Self {
        SoupQuery::Notified(NotifiedQueryInner(models_pagination::Query::Cursor(cursor)))
    }

    /// Returns the filter payload embedded in this query.
    pub fn filter(&self) -> &T {
        match self {
            SoupQuery::Simple(SimpleQueryInner(query)) => query.filter(),
            SoupQuery::Frecency(FrecencyQueryInner(query)) => query.filter(),
            SoupQuery::Touched(TouchedQueryInner(query)) => query.filter(),
            SoupQuery::Notified(NotifiedQueryInner(query)) => query.filter(),
        }
    }
}

impl SoupQuery<EntityFilters> {
    /// Converts high-level entity filters into an AST-backed soup query.
    pub fn into_ast(self) -> Result<SoupQuery<Option<EntityFilterAst>>, ExpandErr> {
        match self {
            SoupQuery::Simple(SimpleQueryInner(query)) => Ok(SoupQuery::Simple(SimpleQueryInner(
                query.try_map_filter(EntityFilterAst::new_from_filters)?,
            ))),
            SoupQuery::Frecency(FrecencyQueryInner(query)) => Ok(SoupQuery::Frecency(
                FrecencyQueryInner(query.try_map_filter(EntityFilterAst::new_from_filters)?),
            )),
            SoupQuery::Touched(TouchedQueryInner(query)) => Ok(SoupQuery::Touched(
                TouchedQueryInner(query.try_map_filter(EntityFilterAst::new_from_filters)?),
            )),
            SoupQuery::Notified(NotifiedQueryInner(query)) => Ok(SoupQuery::Notified(
                NotifiedQueryInner(query.try_map_filter(EntityFilterAst::new_from_filters)?),
            )),
        }
    }
}

/// Request to fetch a page of soup items for a user.
#[derive(Debug)]
pub struct SoupRequest<T> {
    /// Whether to return expanded or unexpanded soup items.
    pub soup_type: SoupType,
    /// Maximum number of items to return.
    pub limit: u16,
    /// Initial query or pagination cursor to execute.
    pub cursor: SoupQuery<T>,
    /// Direction the merged page is ordered in. Defaults to descending, which
    /// is what every feed but reminders wants.
    ///
    /// One choice per request: the paginator sorts the whole merged page, so
    /// this cannot differ per entity type within a single feed. It is a
    /// sibling of the cursor rather than part of it because clients re-send
    /// the request params on every page, which keeps the cursor format alone.
    ///
    /// Only the [`SoupQuery::Simple`] branch honours this. Frecency pages come
    /// back ordered by relevance score and never have the merged sort applied,
    /// so there is no ascending frecency order to produce — the REST adapter
    /// rejects that combination rather than letting it read as supported, and
    /// the GraphQL adapter cannot express frecency at all.
    pub sort_direction: SoupSortDirection,
    /// User whose soup should be queried.
    pub user: MacroUserIdStr<'static>,
    /// Email preview view used when hydrating email soup items.
    pub email_preview_view: PreviewView,
    /// Every inbox the caller can read (own + delegated via macro_user_links).
    /// Empty when the caller has no inboxes — `build_email_request` returns
    /// `None` so the email branch is skipped.
    pub link_ids: Vec<Uuid>,
}

/// trait which defines a type which can be fallibly converted into a SoupRequest with ast
pub trait IntoSoupReqAst {
    /// perform the conversion
    fn into_ast(self) -> Result<SoupRequest<Option<EntityFilterAst>>, ExpandErr>;
}

impl IntoSoupReqAst for SoupRequest<EntityFilters> {
    fn into_ast(self) -> Result<SoupRequest<Option<EntityFilterAst>>, ExpandErr> {
        let SoupRequest {
            soup_type,
            limit,
            cursor,
            sort_direction,
            user,
            email_preview_view,
            link_ids,
        } = self;

        Ok(SoupRequest {
            soup_type,
            limit,
            cursor: cursor.into_ast()?,
            sort_direction,
            user,
            email_preview_view,
            link_ids,
        })
    }
}

impl IntoSoupReqAst for SoupRequest<EntityFilterAst> {
    fn into_ast(self) -> Result<SoupRequest<Option<EntityFilterAst>>, ExpandErr> {
        let SoupRequest {
            soup_type,
            limit,
            cursor,
            sort_direction,
            user,
            email_preview_view,
            link_ids,
        } = self;

        Ok(SoupRequest {
            soup_type,
            limit,
            cursor: cursor.map(|f| if f.is_empty() { None } else { Some(f) }),
            sort_direction,
            user,
            email_preview_view,
            link_ids,
        })
    }
}

impl<T> SoupRequest<T> {
    /// returns a reference to the filters to pass to the paginator
    /// this is used to prevent passing back the full ast on each server request
    pub(crate) fn filters(&self) -> &T {
        self.cursor.filter()
    }
}

impl SoupRequest<Option<EntityFilterAst>> {
    /// take the parts of the [SoupRequest] that are only relevant to email
    /// and move them into a [GetEmailsRequest] if it is possible to create one.
    ///
    /// `team_receipt` is forwarded onto the email request so the query
    /// layer can verify and use it when the email filter carries a CRM
    /// scope tag (`EntityFilterAst::email_filter::crm_scope`).
    pub(crate) fn build_email_request(
        &self,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Option<GetEmailsRequest> {
        let entity_ast = self.entity_ast();
        let crm_scope = entity_ast.and_then(|a| a.email_filter.crm_scope.clone());

        if self.link_ids.is_empty() {
            return None;
        }

        // A properties filter that cannot match threads makes the email
        // branch empty, so the sub-request is skipped. Otherwise it is ANDed
        // into the email tree so the query returns exactly matching threads.
        let properties_filter = entity_ast.and_then(|a| a.properties_filter.as_deref());
        if let Some(propf) = properties_filter
            && !properties_filter_can_apply_to(propf, &[PropertyEntityType::Thread])
        {
            return None;
        }

        Some(GetEmailsRequest {
            view: self.email_preview_view.clone(),
            link_ids: self.link_ids.clone(),
            macro_id: self.user.clone(),
            limit: Some(self.limit as u32),
            query: match &self.cursor {
                SoupQuery::Simple(SimpleQueryInner(Query::Sort(t, f))) => Some(Query::Sort(
                    *t,
                    with_properties_filter(
                        f.as_ref().and_then(|f| f.email_filter.tree.clone()),
                        properties_filter,
                    ),
                )),
                SoupQuery::Simple(SimpleQueryInner(Query::Cursor(CursorWithValAndFilter {
                    id,
                    limit,
                    val,
                    filter,
                }))) => Some(Query::Cursor(CursorWithValAndFilter {
                    id: *id,
                    limit: *limit,
                    val: val.clone(),
                    filter: with_properties_filter(
                        filter.as_ref().and_then(|f| f.email_filter.tree.clone()),
                        properties_filter,
                    ),
                })),
                // we don't yet have sort by frecency implemented for emails yet
                SoupQuery::Frecency(_) => None,
                // touched-by-me hydrates emails by thread id, not via this leg
                SoupQuery::Touched(_) => None,
                // notified-at hydrates its email candidates through this leg
                // with the request's own tree, so the view and every email
                // literal keep applying: the handler ANDs the thread ids in.
                SoupQuery::Notified(NotifiedQueryInner(query)) => Some(Query::Sort(
                    SimpleSortMethod::UpdatedAt,
                    with_properties_filter(
                        query
                            .filter()
                            .as_ref()
                            .and_then(|f| f.email_filter.tree.clone()),
                        properties_filter,
                    ),
                )),
            }?,
            include_frecency: false,
            team_receipt,
            crm_scope,
        })
    }

    /// The request's entity filter ast, regardless of cursor position.
    pub(crate) fn entity_ast(&self) -> Option<&EntityFilterAst> {
        match &self.cursor {
            SoupQuery::Simple(SimpleQueryInner(Query::Sort(_, f))) => f.as_ref(),
            SoupQuery::Simple(SimpleQueryInner(Query::Cursor(CursorWithValAndFilter {
                filter,
                ..
            }))) => filter.as_ref(),
            SoupQuery::Frecency(_) => None,
            SoupQuery::Touched(TouchedQueryInner(query)) => query.filter().as_ref(),
            SoupQuery::Notified(NotifiedQueryInner(query)) => query.filter().as_ref(),
        }
    }

    /// True when an active properties filter can never match an entity with
    /// no property rows. Property-less sub-requests (channels, channel
    /// threads, calls, CRM companies, foreign entities) are skipped so pages
    /// only contain rows the filter applies to.
    fn properties_filter_blocks_propertyless(&self) -> bool {
        self.entity_ast()
            .and_then(|a| a.properties_filter.as_deref())
            .is_some_and(|p| !properties_filter_matches_propertyless(p))
    }

    pub(crate) fn build_call_request(&self) -> Option<GetCallRecordsRequest> {
        // A def-less tag filter (entity_type None on every literal) applies to
        // calls, which carry tags; it is folded into the call filter below and
        // rendered as a `properties.values` EXISTS by the call query. Any other
        // active properties filter can't match a call, so the leg is skipped by
        // the propertyless check.
        let properties_filter = self
            .entity_ast()
            .and_then(|a| a.properties_filter.as_deref())
            .filter(|p| properties_filter_can_apply_to(p, &[]));
        if properties_filter.is_none() && self.properties_filter_blocks_propertyless() {
            return None;
        }
        Some(GetCallRecordsRequest {
            user_id: self.user.clone(),
            limit: self.limit as u32,
            query: match &self.cursor {
                SoupQuery::Simple(SimpleQueryInner(Query::Sort(t, f))) => Some(Query::Sort(
                    *t,
                    with_call_properties_filter(
                        f.as_ref().and_then(|f| f.call_filter.clone()),
                        properties_filter,
                    ),
                )),
                SoupQuery::Simple(SimpleQueryInner(Query::Cursor(CursorWithValAndFilter {
                    id,
                    limit,
                    val,
                    filter,
                }))) => Some(Query::Cursor(CursorWithValAndFilter {
                    id: *id,
                    limit: *limit,
                    val: val.clone(),
                    filter: with_call_properties_filter(
                        filter.as_ref().and_then(|f| f.call_filter.clone()),
                        properties_filter,
                    ),
                })),
                // query by frecency not yet implemented for call records
                SoupQuery::Frecency(_) => None,
                // call records carry no activity of their own (calls land on
                // the channel), so the touched feed never includes them
                SoupQuery::Touched(_) => None,
                // call notifications are not rolled into the notified feed
                SoupQuery::Notified(_) => None,
            }?,
        })
    }

    /// Returns `None` (skipping the CRM sub-request) for no-team users,
    /// Frecency cursors, or a malformed team-receipt uuid.
    pub(crate) fn build_crm_company_request(
        &self,
        team_receipt: &Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Option<GetCrmCompaniesRequest> {
        if self.properties_filter_blocks_propertyless() {
            return None;
        }
        let receipt = team_receipt.as_ref()?;
        // Re-wrap the verified team receipt as the CRM capability token the
        // service now requires; a malformed receipt skips the sub-request.
        let access = CrmTeamReceipt::from_team_receipt(receipt.clone())
            .inspect_err(|e| {
                tracing::warn!(
                    error=?e,
                    "team_receipt is not a valid CRM team receipt; skipping crm_company sub-request"
                );
            })
            .ok()?;

        // Follow-up pages carry a keyset cursor (sort_ts + id of the
        // previous page's last row); the first page has none. Without
        // this the CRM sub-query always returned offset 0, so every
        // page re-served the same top companies.
        let (sort_method, filter_ast, cursor): (
            SimpleSortMethod,
            Option<&EntityFilterAst>,
            Option<CrmCompanySoupCursor>,
        ) = match &self.cursor {
            SoupQuery::Simple(SimpleQueryInner(Query::Sort(t, f))) => (*t, f.as_ref(), None),
            SoupQuery::Simple(SimpleQueryInner(Query::Cursor(CursorWithValAndFilter {
                id,
                val,
                filter,
                ..
            }))) => (
                val.sort_type,
                filter.as_ref(),
                Some(CrmCompanySoupCursor {
                    last_sort_ts: val.last_val,
                    last_id: *id,
                }),
            ),
            SoupQuery::Frecency(_) => return None,
            // CRM has no mutation activity (deferred from touched-by-me)
            SoupQuery::Touched(_) => return None,
            // CRM companies receive no notifications
            SoupQuery::Notified(_) => return None,
        };

        let sort = match sort_method {
            SimpleSortMethod::CreatedAt => CrmCompanyListSort::CreatedAt,
            SimpleSortMethod::UpdatedAt => CrmCompanyListSort::UpdatedAt,
            SimpleSortMethod::ViewedAt => CrmCompanyListSort::ViewedAt,
            SimpleSortMethod::ViewedUpdated => CrmCompanyListSort::ViewedUpdated,
        };

        let mut extract = CrmCompanyFilterExtract::default();
        if let Some(tree) = filter_ast.and_then(|a| a.crm_company_filter.as_ref())
            && !extract_crm_company_filter(tree, &mut extract)
        {
            // Fail closed: unsupported AST shape would widen the result
            // set. Skip the CRM sub-request rather than over-include.
            return None;
        }

        Some(GetCrmCompaniesRequest {
            access,
            user_id: self.user.clone(),
            company_ids: extract.ids,
            hidden: extract.hidden,
            sort,
            cursor,
            // Match the soup paginator's bounds so the CRM layer doesn't
            // overfetch on an oversized client limit.
            limit: self.limit.clamp(20, 500) as i64,
        })
    }

    /// Build the reminder leg of the query.
    ///
    /// Unlike every other entity type, reminders are **opt-in**: a query that
    /// says nothing about them gets none. Adding reminders to Soup therefore
    /// left every existing view's results unchanged; only views that ask (today
    /// just the Inbox Signal filter) see them.
    ///
    /// Reminders also carry no properties, so an active properties filter that
    /// cannot match a propertyless item skips the leg — the same gate channels
    /// and foreign entities use.
    pub(crate) fn build_reminder_request(
        &self,
        limit: i64,
    ) -> Option<GetRemindersRequest<'static>> {
        if self.properties_filter_blocks_propertyless() {
            return None;
        }
        // Reminders sort on `next_run_at` regardless of the requested method,
        // so there is nothing to translate — but frecency has no reminder
        // scoring and reminders record no activity, so both paths skip them.
        // Notified-at keeps the leg: a fired reminder notifies its owner, and
        // the handler narrows `reminder_ids` to the page's candidates.
        if matches!(self.cursor, SoupQuery::Frecency(_) | SoupQuery::Touched(_)) {
            return None;
        }

        // Absent filter means the query never mentioned reminders, which is the
        // opt-out. Every pre-existing Soup view lands here.
        let tree = self.entity_ast().and_then(|a| a.reminder_filter.as_ref())?;
        let mut extract = ReminderFilterExtract::default();
        if !extract_reminder_filter(tree, &mut extract) {
            // Fail closed: an unsupported AST shape would widen the result set.
            return None;
        }
        if !extract.opted_in() {
            return None;
        }

        Some(GetRemindersRequest {
            user_id: self.user.clone(),
            reminder_ids: extract.ids,
            entities: extract.entities,
            completed: extract.completed,
            fired: extract.fired,
            order: match self.sort_direction {
                SoupSortDirection::Asc => SoupOrder::SoonestFirst,
                SoupSortDirection::Desc => SoupOrder::LatestFirst,
            },
            limit,
        })
    }

    pub(crate) fn build_comms_request(&self) -> Option<GetChannelsRequest> {
        if self.properties_filter_blocks_propertyless() {
            return None;
        }
        Some(GetChannelsRequest {
            macro_id: self.user.clone(),
            limit: Some(self.limit as u32),
            include_frecency: false,
            query: match &self.cursor {
                SoupQuery::Simple(SimpleQueryInner(Query::Sort(t, f))) => Some(Query::Sort(
                    *t,
                    f.as_ref().and_then(|f| f.channel_filter.clone()),
                )),
                SoupQuery::Simple(SimpleQueryInner(Query::Cursor(CursorWithValAndFilter {
                    id,
                    limit,
                    val,
                    filter,
                }))) => Some(Query::Cursor(CursorWithValAndFilter {
                    id: *id,
                    limit: *limit,
                    val: val.clone(),
                    filter: filter.as_ref().and_then(|f| f.channel_filter.clone()),
                })),
                // query by frecency not yet implemented for channels
                SoupQuery::Frecency(_) => None,
                // touched-by-me hydrates channels by id, not via this leg
                SoupQuery::Touched(_) => None,
                // notified-at hydrates its channel candidates through this
                // leg with the request's own tree; the handler ANDs the ids in
                SoupQuery::Notified(NotifiedQueryInner(query)) => Some(Query::Sort(
                    SimpleSortMethod::UpdatedAt,
                    query
                        .filter()
                        .as_ref()
                        .and_then(|f| f.channel_filter.clone()),
                )),
            }?,
        })
    }

    pub(crate) fn build_comms_thread_request(&self) -> Option<GetThreadReplyRowsRequest> {
        if self.properties_filter_blocks_propertyless() {
            return None;
        }
        let query = match &self.cursor {
            SoupQuery::Simple(SimpleQueryInner(Query::Sort(t, f))) => Some(Query::Sort(
                *t,
                f.as_ref().and_then(|f| f.channel_thread_filter.clone()),
            )),
            SoupQuery::Simple(SimpleQueryInner(Query::Cursor(CursorWithValAndFilter {
                id,
                limit,
                val,
                filter,
            }))) => Some(Query::Cursor(CursorWithValAndFilter {
                id: *id,
                limit: *limit,
                val: val.clone(),
                filter: filter
                    .as_ref()
                    .and_then(|f| f.channel_thread_filter.clone()),
            })),
            // query by frecency not yet implemented for channel threads
            SoupQuery::Frecency(_) => None,
            // channel-thread rows carry no activity (messages attribute to
            // the channel), so the touched feed never includes them
            SoupQuery::Touched(_) => None,
            // notified-at hydrates thread-scoped channel notifications through
            // this leg with the request's own tree; the handler ANDs the
            // thread ids in
            SoupQuery::Notified(NotifiedQueryInner(query)) => Some(Query::Sort(
                SimpleSortMethod::UpdatedAt,
                query
                    .filter()
                    .as_ref()
                    .and_then(|f| f.channel_thread_filter.clone()),
            )),
        }?;

        Some(GetThreadReplyRowsRequest {
            macro_id: self.user.clone(),
            limit: Some(self.limit as u32),
            query,
        })
    }

    pub(crate) fn build_foreign_entity_query(&self) -> Option<ForeignEntityListQuery> {
        if self.properties_filter_blocks_propertyless() {
            return None;
        }
        match &self.cursor {
            SoupQuery::Simple(SimpleQueryInner(Query::Sort(t, f))) => Some(Query::Sort(
                *t,
                f.as_ref()
                    .and_then(|filter| filter.foreign_entity_filter.clone()),
            )),
            SoupQuery::Simple(SimpleQueryInner(Query::Cursor(CursorWithValAndFilter {
                id,
                limit,
                val,
                filter,
            }))) => Some(Query::Cursor(CursorWithValAndFilter {
                id: *id,
                limit: *limit,
                val: val.clone(),
                filter: filter
                    .as_ref()
                    .and_then(|filter| filter.foreign_entity_filter.clone()),
            })),
            // query by frecency is not implemented for foreign entities
            SoupQuery::Frecency(_) => None,
            // foreign entities record no activity, so the touched feed never
            // includes them
            SoupQuery::Touched(_) => None,
            // notified-at hydrates its foreign-entity candidates through this
            // leg with the request's own tree; the handler ANDs the ids in
            SoupQuery::Notified(NotifiedQueryInner(query)) => Some(Query::Sort(
                SimpleSortMethod::UpdatedAt,
                query
                    .filter()
                    .as_ref()
                    .and_then(|filter| filter.foreign_entity_filter.clone()),
            )),
        }
    }

    pub(crate) fn build_foreign_entity_source_ids(
        &self,
        team_receipt: Option<&EntityAccessReceipt<MemberTeamRole>>,
    ) -> Vec<SourceId> {
        let mut source_ids = vec![SourceId::user(self.user.as_ref())];

        if let Some(receipt) = team_receipt {
            source_ids.push(SourceId::new(receipt.entity().entity_id.clone(), "team"));
        }

        source_ids
    }
}

/// Keyset position for a touched-by-me page: the touch timestamp and entity
/// id of the previous page's last row.
///
/// The id stays the raw stored string (never round-tripped through [`Uuid`]):
/// the SQL keyset compares it byte-for-byte against the `entity_id` TEXT
/// column, so any canonicalization would shift the page boundary.
#[derive(Debug, Clone)]
pub struct TouchedPagePosition {
    /// The last entity's latest-mutation timestamp.
    pub occurred_at: chrono::DateTime<chrono::Utc>,
    /// The last entity's id — the global tiebreaker when two entities share
    /// a touch timestamp.
    pub entity_id: String,
}

/// Parameters for one page of touched-by-me candidates.
#[derive(Debug)]
pub struct TouchedSoupRequest<'a> {
    /// User whose touches are listed; also the access-check subject.
    pub user_id: MacroUserIdStr<'a>,
    /// Maximum entities to return.
    pub limit: u16,
    /// Resume after this position; `None` for the first page.
    pub after: Option<TouchedPagePosition>,
    /// Entity filters folded into the candidate query.
    pub filter: Option<&'a EntityFilterAst>,
    /// Every inbox the caller can read; gates email-thread candidates.
    pub link_ids: &'a [Uuid],
}

/// One touched entity: what it is and when the user last mutated it.
#[derive(Debug, Clone)]
pub struct TouchedEntity {
    /// The touched entity.
    pub entity: Entity<'static>,
    /// The user's latest mutation of it.
    pub touched_at: chrono::DateTime<chrono::Utc>,
}

/// Keyset position for a notified-at page: the notification timestamp and
/// event item id of the previous page's last candidate.
///
/// Like [`TouchedPagePosition`], the id stays the raw stored string: the SQL
/// keyset compares it byte-for-byte against `notification.event_item_id`.
#[derive(Debug, Clone)]
pub struct NotifiedPagePosition {
    /// When the last candidate's latest notification was created for the user.
    pub notified_at: chrono::DateTime<chrono::Utc>,
    /// The last candidate's event item id — the tiebreaker when two
    /// candidates share a notification timestamp.
    pub entity_id: String,
}

/// Parameters for one page of notified-at candidates.
#[derive(Debug)]
pub struct NotifiedSoupRequest<'a> {
    /// User whose notifications are listed; also the access-check subject.
    pub user_id: MacroUserIdStr<'a>,
    /// Maximum candidates to return.
    pub limit: u16,
    /// Resume after this position; `None` for the first page.
    pub after: Option<NotifiedPagePosition>,
    /// Entity filters folded into the candidate query where soup owns the
    /// fold (documents, chats, projects, calendar events, properties).
    pub filter: Option<&'a EntityFilterAst>,
    /// Every inbox the caller can read; gates email-thread candidates.
    pub link_ids: &'a [Uuid],
    /// Sources (the caller and their team) whose stored foreign entities the
    /// caller may see; gates foreign-entity candidates.
    pub foreign_entity_sources: &'a [SourceId],
    /// Entity types whose candidates the domain can hydrate for this request.
    /// Types outside this set are never returned, whatever the notifications
    /// table holds.
    pub hydratable: NotifiedHydratableTypes,
}

/// Which domain-hydrated entity types a notified-at request can surface.
///
/// The repository gates documents, chats, projects and calendar events on
/// the filter tree itself; these four are hydrated through other domains'
/// legs, so whether that leg is active for the request is decided by the
/// service and passed down here.
#[derive(Debug, Clone, Copy, Default)]
pub struct NotifiedHydratableTypes {
    /// The channel leg is active.
    pub channels: bool,
    /// The channel-thread leg is active. Thread-scoped channel notifications
    /// (mentions and replies, which name their thread root as the secondary
    /// event item) surface as thread rows, the way the client attributes them.
    pub channel_threads: bool,
    /// The email leg is active.
    pub email_threads: bool,
    /// The foreign-entity leg is active.
    pub foreign_entities: bool,
    /// The reminder leg is active (the request opted into reminders).
    pub reminders: bool,
}

/// One notified entity: what it is and when the user was last notified.
#[derive(Debug, Clone)]
pub struct NotifiedEntity {
    /// The entity the notification is about.
    pub entity: Entity<'static>,
    /// When the user's latest notification about it was created.
    pub notified_at: chrono::DateTime<chrono::Utc>,
}

/// Whether the notified-at candidate query can fold this calendar filter.
///
/// Only id and notification-state literals have a soup-owned fold; the rest
/// (status, time bounds, attendee, organizer) live in the calendar leg's
/// query builder, which the candidate query cannot reach. Rejecting up front
/// beats silently returning a feed with those events unfiltered.
pub(crate) fn calendar_filter_supported_by_notified(
    tree: Option<&Expr<CalendarEventLiteral>>,
) -> bool {
    tree.is_none_or(|expr| {
        expr.collapse_frames(|frame| match frame {
            filter_ast::ExprFrame::And(a, b) | filter_ast::ExprFrame::Or(a, b) => a && b,
            filter_ast::ExprFrame::Not(a) => a,
            filter_ast::ExprFrame::Literal(
                CalendarEventLiteral::Id(_)
                | CalendarEventLiteral::NotificationDone(_)
                | CalendarEventLiteral::NotificationSeen(_),
            ) => true,
            filter_ast::ExprFrame::Literal(_) => false,
        })
    })
}

/// ANDs a properties filter into the email filter tree as thread-level
/// [EmailLiteral::Property] conditions, so the email query returns exactly
/// the threads that satisfy it.
fn with_properties_filter(
    tree: Option<Arc<Expr<EmailLiteral>>>,
    properties_filter: Option<&Expr<PropertiesLiteral>>,
) -> Option<Arc<Expr<EmailLiteral>>> {
    let Some(propf) = properties_filter else {
        return tree;
    };
    let mapped = map_properties_to_email(propf);
    Some(Arc::new(match tree {
        Some(tree) => Expr::and((*tree).clone(), mapped),
        None => mapped,
    }))
}

fn map_properties_to_email(expr: &Expr<PropertiesLiteral>) -> Expr<EmailLiteral> {
    match expr {
        Expr::And(a, b) => Expr::and(map_properties_to_email(a), map_properties_to_email(b)),
        Expr::Or(a, b) => Expr::or(map_properties_to_email(a), map_properties_to_email(b)),
        Expr::Not(a) => Expr::Not(Box::new(map_properties_to_email(a))),
        Expr::Literal(lit) => Expr::Literal(EmailLiteral::Property(lit.clone())),
    }
}

/// ANDs a properties filter (mapped to [CallLiteral::Property] conditions) into
/// the call filter tree, so the call query returns exactly the calls that also
/// satisfy the tag filter.
fn with_call_properties_filter(
    tree: Option<Arc<Expr<CallLiteral>>>,
    properties_filter: Option<&Expr<PropertiesLiteral>>,
) -> Option<Arc<Expr<CallLiteral>>> {
    let Some(propf) = properties_filter else {
        return tree;
    };
    let mapped = map_properties_to_call(propf);
    Some(Arc::new(match tree {
        Some(tree) => Expr::and((*tree).clone(), mapped),
        None => mapped,
    }))
}

fn map_properties_to_call(expr: &Expr<PropertiesLiteral>) -> Expr<CallLiteral> {
    match expr {
        Expr::And(a, b) => Expr::and(map_properties_to_call(a), map_properties_to_call(b)),
        Expr::Or(a, b) => Expr::or(map_properties_to_call(a), map_properties_to_call(b)),
        Expr::Not(a) => Expr::Not(Box::new(map_properties_to_call(a))),
        Expr::Literal(lit) => Expr::Literal(CallLiteral::Property(lit.clone())),
    }
}

/// Parameters for fetching CRM companies to fold into the soup feed.
#[derive(Debug)]
pub struct GetCrmCompaniesRequest {
    /// Capability token for the team whose CRM companies to list. The
    /// service derives the team id from it.
    pub access: CrmTeamReceipt<MemberTeamRole>,
    /// Requesting user — used to scope the per-user `UserHistory` join
    /// behind the `Viewed*` sort variants. Always populated; the soup
    /// request always has a user.
    pub user_id: MacroUserIdStr<'static>,
    /// Filter to specific company ids. Empty = all of the team's
    /// companies matching `hidden` (subject to the killswitch).
    pub company_ids: Vec<Uuid>,
    /// Optional `crm_companies.hidden` filter. `None` = visible only
    /// (default); `Some(false)` = visible only (explicit); `Some(true)`
    /// = hidden only. The admin/owner role check is enforced by the CRM
    /// service from `access` when this request is executed.
    pub hidden: Option<bool>,
    /// Which timestamp column to sort by.
    pub sort: CrmCompanyListSort,
    /// Keyset cursor to seek past the previous page (`None` = first page).
    pub cursor: Option<CrmCompanySoupCursor>,
    /// Upper bound on rows returned — the soup paginator re-slices.
    pub limit: i64,
}

/// Outcome of walking a `CrmCompanyLiteral` AST: the ids and the
/// optional `hidden` constraint pulled out of the tree.
#[derive(Debug, Default)]
pub(crate) struct CrmCompanyFilterExtract {
    pub ids: Vec<Uuid>,
    pub hidden: Option<bool>,
}

/// Walks a `CrmCompanyLiteral` AST collecting `Id(uuid)` literals into
/// `out.ids` and a single `Hidden(bool)` constraint into `out.hidden`.
/// Returns `false` (fail closed) when:
///   - `Not(_)` appears (would invert set semantics),
///   - two `Hidden(_)` literals conflict (e.g. `Hidden(true) AND Hidden(false)`),
///   - an `Or(_, _)` branch mixes ids and a hidden literal (would change
///     set semantics in ways the simple extractor can't represent).
fn extract_crm_company_filter(
    expr: &Expr<CrmCompanyLiteral>,
    out: &mut CrmCompanyFilterExtract,
) -> bool {
    match expr {
        Expr::Literal(CrmCompanyLiteral::Id(id)) => {
            out.ids.push(*id);
            true
        }
        Expr::Literal(CrmCompanyLiteral::Hidden(b)) => match out.hidden {
            Some(prev) if prev != *b => false,
            _ => {
                out.hidden = Some(*b);
                true
            }
        },
        // `And` of arbitrary sub-trees: each side contributes independently
        // (e.g. id-OR AND Hidden).
        Expr::And(a, b) => extract_crm_company_filter(a, out) && extract_crm_company_filter(b, out),
        // `Or` is only safe over ids — mixing a Hidden literal under an Or
        // would change semantics ("these ids OR all hidden") that the flat
        // extract can't represent.
        Expr::Or(a, b) => or_is_ids_only(a, out) && or_is_ids_only(b, out),
        Expr::Not(_) => false,
    }
}

/// Helper for [`extract_crm_company_filter`]: an `Or` branch must be a
/// pure id sub-tree (nested `Or` of `Id` literals) — any `Hidden`, `And`,
/// or `Not` inside fails closed.
fn or_is_ids_only(expr: &Expr<CrmCompanyLiteral>, out: &mut CrmCompanyFilterExtract) -> bool {
    match expr {
        Expr::Literal(CrmCompanyLiteral::Id(id)) => {
            out.ids.push(*id);
            true
        }
        Expr::Or(a, b) => or_is_ids_only(a, out) && or_is_ids_only(b, out),
        _ => false,
    }
}

/// Parameters for the reminder leg of a soup query.
#[derive(Debug)]
pub struct GetRemindersRequest<'a> {
    /// Whose reminders to list. Reminders are private to their owner, so this
    /// is the whole of the access check.
    pub user_id: MacroUserIdStr<'a>,
    /// Filter to specific reminder ids. Empty = all of the user's reminders.
    pub reminder_ids: Vec<Uuid>,
    /// Filter to reminders attached to these entities, each `"{type}:{id}"`.
    /// Empty = no entity constraint.
    pub entities: Vec<String>,
    /// Filter on whether the owner marked the reminder done. `None` returns both.
    pub completed: Option<bool>,
    /// Filter on whether the reminder has come due. `None` returns both.
    pub fired: Option<bool>,
    /// Which end of the `next_run_at` ordering to take `limit` rows from.
    /// Mirrors the request's sort direction so the leg and the merge agree.
    pub order: SoupOrder,
    /// Upper bound on rows returned — the soup paginator re-slices.
    pub limit: i64,
}

/// Outcome of walking a `ReminderLiteral` AST.
#[derive(Debug, Default)]
pub(crate) struct ReminderFilterExtract {
    pub(crate) include: bool,
    pub(crate) ids: Vec<Uuid>,
    pub(crate) entities: Vec<String>,
    pub(crate) completed: Option<bool>,
    pub(crate) fired: Option<bool>,
}

impl ReminderFilterExtract {
    /// Whether the query asked for reminders at all. Reminders are off unless
    /// something in the filter names them.
    fn opted_in(&self) -> bool {
        self.include || !self.ids.is_empty() || !self.entities.is_empty()
    }
}

/// Walks a `ReminderLiteral` AST collecting ids, entity tokens, and a single
/// single `Completed(bool)`/`Fired(bool)` constraint. Returns `false` (fail
/// closed) on `Not(_)`, on conflicting literals, and on an `Or` branch that is not a pure
/// id/entity sub-tree — the same shape restrictions as the CRM extractor, for
/// the same reason: a flat extract cannot represent those set semantics.
fn extract_reminder_filter(expr: &Expr<ReminderLiteral>, out: &mut ReminderFilterExtract) -> bool {
    match expr {
        Expr::Literal(ReminderLiteral::Include) => {
            out.include = true;
            true
        }
        Expr::Literal(ReminderLiteral::Id(id)) => {
            out.ids.push(*id);
            true
        }
        Expr::Literal(ReminderLiteral::Entity(entity)) => {
            out.entities.push(entity.clone());
            true
        }
        Expr::Literal(ReminderLiteral::Completed(b)) => match out.completed {
            Some(prev) if prev != *b => false,
            _ => {
                out.completed = Some(*b);
                true
            }
        },
        Expr::Literal(ReminderLiteral::Fired(b)) => match out.fired {
            Some(prev) if prev != *b => false,
            _ => {
                out.fired = Some(*b);
                true
            }
        },
        Expr::And(a, b) => extract_reminder_filter(a, out) && extract_reminder_filter(b, out),
        Expr::Or(a, b) => {
            // The repo ANDs `ids` against `entities`, so an `Or` spanning both
            // would come out as an `And` — narrower than asked. Only reject
            // when this `Or` actually contributes both; ids-only or
            // entities-only branches still flatten faithfully.
            let (ids_before, entities_before) = (out.ids.len(), out.entities.len());
            let ok = reminder_or_is_sets_only(a, out) && reminder_or_is_sets_only(b, out);
            ok && !(out.ids.len() > ids_before && out.entities.len() > entities_before)
        }
        Expr::Not(_) => false,
    }
}

/// Helper for [`extract_reminder_filter`]: an `Or` branch must be a pure
/// id/entity sub-tree — a `Completed`, `Fired`, `And`, or `Not` inside fails
/// closed.
fn reminder_or_is_sets_only(expr: &Expr<ReminderLiteral>, out: &mut ReminderFilterExtract) -> bool {
    match expr {
        Expr::Literal(ReminderLiteral::Id(id)) => {
            out.ids.push(*id);
            true
        }
        Expr::Literal(ReminderLiteral::Entity(entity)) => {
            out.entities.push(entity.clone());
            true
        }
        Expr::Or(a, b) => reminder_or_is_sets_only(a, out) && reminder_or_is_sets_only(b, out),
        _ => false,
    }
}

/// Authoritative document facts that are unavailable as direct Soup fields.
///
/// This value is internal hydration state. It is deliberately separate from
/// public Soup entity models so relation-backed facts do not become business
/// fields on [`models_soup::document::SoupDocument`].
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SoupDocumentServerFacts {
    /// Whether `document_email` contains a row for the document.
    pub is_email_attachment: bool,
    /// Whether the document is important to the requesting viewer.
    ///
    /// Non-task documents are important. Tasks are important when the viewer
    /// appears in the authoritative Assignees system property.
    pub is_important: bool,
    /// Complete authoritative Status select-option IDs for a task.
    ///
    /// Non-task documents and tasks without a Status value carry an empty set.
    pub status_option_ids: Vec<uuid::Uuid>,
}

/// An authorized Soup item and any server-only facts read by the same
/// hydration operation.
///
/// `document_server_facts` is populated only when authoritative document
/// relation state was loaded. Projects, chats, unsupported entities, and
/// unenriched hydration paths leave it empty because they have no supplement
/// to emit.
#[derive(Debug, Clone)]
pub struct SoupProjectionHydration<Item = SoupItem<()>> {
    /// Authorized Soup item returned to the caller.
    pub item: Item,
    /// Relation-backed document facts unavailable in direct Soup fields.
    pub document_server_facts: Option<SoupDocumentServerFacts>,
}

impl<Item> SoupProjectionHydration<Item> {
    /// Map the hydrated item while preserving its authoritative server facts.
    pub fn map<F, Mapped>(self, map: F) -> SoupProjectionHydration<Mapped>
    where
        F: FnOnce(Item) -> Mapped,
    {
        SoupProjectionHydration {
            item: map(self.item),
            document_server_facts: self.document_server_facts,
        }
    }
}

/// A Soup result with both optional enrichments represented in one model.
///
/// Service methods decide which fields to populate. An unfetched enrichment
/// remains empty without changing the response model.
#[derive(Debug, Clone)]
#[non_exhaustive]
pub struct EnrichedSoupItem {
    /// The Soup item with its property projection.
    pub item: SoupItem<SoupPropertiesField>,
    /// The aggregate frecency score, when requested and available.
    pub frecency_score: Option<AggregateFrecency>,
    /// The caller's latest own mutation of this entity, populated only when
    /// the page was ordered by `touched_by_me`. Clients sort and optimistic-
    /// reorder the touched feed on this value.
    pub touched_at: Option<chrono::DateTime<chrono::Utc>>,
    /// When the caller was last notified about this entity, populated only
    /// when the page was ordered by `notified_at`. Clients sort and bucket
    /// the notified feed on this value.
    pub notified_at: Option<chrono::DateTime<chrono::Utc>>,
}

/// A soup request with optional grouping configuration.
#[derive(Debug)]
pub struct GroupedSoupRequest<T> {
    /// Base soup request parameters
    pub base: SoupRequest<T>,
    /// Optional grouping configuration
    pub grouping: Option<GroupingConfig>,
}

/// Errors returned while building or executing soup queries.
#[derive(Debug, Error)]
pub enum SoupErr {
    /// Frecency query failed.
    #[error(transparent)]
    FrecencyErr(#[from] FrecencyQueryErr),
    /// Soup repository query failed.
    #[error(transparent)]
    SoupDbErr(#[from] anyhow::Error),
    /// Email preview lookup failed.
    #[error(transparent)]
    EmailErr(#[from] email::domain::models::EmailErr),
    /// Channel or communication lookup failed.
    #[error("A comms error has occured, see logs for more details")]
    CommsErr,
    /// Call record lookup failed.
    #[error("A call error has occurred, see logs for more details")]
    CallErr,
    /// CRM lookup failed.
    #[error("A CRM error has occurred, see logs for more details")]
    CrmErr,
    /// Reminder lookup failed.
    #[error("A reminder error has occurred, see logs for more details")]
    ReminderErr,
    /// A touched-by-me query carried a filter kind this mode cannot
    /// evaluate (the fold lives in another domain's query builder).
    /// Rejecting beats silently returning a feed with that type missing.
    #[error("sort_method=touched_by_me does not support {0} filters")]
    TouchedUnsupportedFilter(&'static str),
    /// A notified-at query carried a filter kind this mode cannot evaluate
    /// (the fold lives in another domain's query builder).
    #[error("sort_method=notified_at does not support {0} filters")]
    NotifiedUnsupportedFilter(&'static str),
    /// The filter requested CRM-scoped data but the caller has no
    /// qualifying team membership.
    #[error("CRM-scoped queries require team membership")]
    CrmTeamRequired,
    /// The filter requested hidden CRM companies but the caller's team
    /// role is below admin/owner.
    #[error("Querying hidden CRM companies requires admin/owner team role")]
    CrmAdminRequired,
    /// Foreign entity lookup failed.
    #[error(transparent)]
    ForeignEntityErr(#[from] ForeignEntityError),
    /// Entity filter AST expansion failed.
    #[error(transparent)]
    AstErr(#[from] ExpandErr),
}

/// Property fields that can be flattened into property-bearing Soup items.
#[derive(Debug, Clone, Default, Serialize, Deserialize)]
#[cfg_attr(feature = "axum", derive(utoipa::ToSchema))]
pub struct SoupPropertiesField {
    /// Properties attached to the entity.
    pub properties: Vec<SoupProperty>,
}

/// A Soup item with entity properties attached.
pub type SoupItemWithProperties = SoupItem<SoupPropertiesField>;

impl SoupPropertiesField {
    /// Creates an extra field containing the supplied properties.
    pub fn new(properties: Vec<SoupProperty>) -> Self {
        Self { properties }
    }
}
