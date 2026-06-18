mod grouping;

pub use grouping::{
    GroupMeta, GroupedResponse, build_grouped_response, entity_type_labels,
    resolve_group_label_and_order,
};

use call::domain::models::GetCallRecordsRequest;
use channels::domain::models::GetChannelsRequest;
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
    ast::{EntityFilterAst, ExpandErr, crm_company::CrmCompanyLiteral},
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use models_grouping::GroupingConfig;
use models_pagination::{
    Cursor, CursorVal, CursorWithValAndFilter, Frecency, FrecencyValue, Identify, Query,
    SimpleSortMethod, SortOn,
};
use models_soup::item::SoupItem;
use non_empty::IsEmpty;
use thiserror::Error;
use uuid::Uuid;

#[derive(Debug, Clone, Copy)]
pub enum SoupType {
    Expanded,
    UnExpanded,
}

/// the parameters required for a [SimpleSortMethod]
#[derive(Debug)]
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

#[derive(Debug)]
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
    #[cfg(test)]
    pub(crate) fn sort_method(&self) -> &SimpleSortMethod {
        match self {
            SimpleSortQuery::NoFilter(query) => query.sort_method(),
            SimpleSortQuery::FilterFrecency(query) => query.sort_method(),
            SimpleSortQuery::ItemsFilter(query) => query.sort_method(),
            SimpleSortQuery::ItemsAndFrecencyFilter(query) => query.sort_method(),
        }
    }
}

#[derive(Debug)]
pub struct AdvancedSortParams<'a> {
    pub entities: &'a [Entity<'a>],
    pub user_id: MacroUserIdStr<'a>,
}

#[derive(Debug)]
pub enum SoupQuery<T> {
    Simple(SimpleQueryInner<T>),
    Frecency(FrecencyQueryInner<T>),
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
        }
    }
}

/// the inner private type for [SoupQuery::Simple]
#[derive(Debug)]
pub struct SimpleQueryInner<T>(pub(crate) Query<Uuid, SimpleSortMethod, T>);

/// the inner private type for [SoupQuery::Frecency]
#[derive(Debug)]
pub struct FrecencyQueryInner<T>(pub(crate) Query<Uuid, Frecency, T>);

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

    pub fn filter(&self) -> &T {
        match self {
            SoupQuery::Simple(SimpleQueryInner(query)) => query.filter(),
            SoupQuery::Frecency(FrecencyQueryInner(query)) => query.filter(),
        }
    }
}

impl SoupQuery<EntityFilters> {
    pub fn into_ast(self) -> Result<SoupQuery<Option<EntityFilterAst>>, ExpandErr> {
        match self {
            SoupQuery::Simple(SimpleQueryInner(query)) => Ok(SoupQuery::Simple(SimpleQueryInner(
                query.try_map_filter(EntityFilterAst::new_from_filters)?,
            ))),
            SoupQuery::Frecency(FrecencyQueryInner(query)) => Ok(SoupQuery::Frecency(
                FrecencyQueryInner(query.try_map_filter(EntityFilterAst::new_from_filters)?),
            )),
        }
    }
}

#[derive(Debug)]
pub struct SoupRequest<T> {
    pub soup_type: SoupType,
    pub limit: u16,
    pub cursor: SoupQuery<T>,
    pub user: MacroUserIdStr<'static>,
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
            user,
            email_preview_view,
            link_ids,
        } = self;

        Ok(SoupRequest {
            soup_type,
            limit,
            cursor: cursor.into_ast()?,
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
            user,
            email_preview_view,
            link_ids,
        } = self;

        Ok(SoupRequest {
            soup_type,
            limit,
            cursor: cursor.map(|f| if f.is_empty() { None } else { Some(f) }),
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
        let entity_ast: Option<&EntityFilterAst> = match &self.cursor {
            SoupQuery::Simple(SimpleQueryInner(Query::Sort(_, f))) => f.as_ref(),
            SoupQuery::Simple(SimpleQueryInner(Query::Cursor(CursorWithValAndFilter {
                filter,
                ..
            }))) => filter.as_ref(),
            SoupQuery::Frecency(_) => None,
        };
        let crm_scope = entity_ast.and_then(|a| a.email_filter.crm_scope.clone());

        if self.link_ids.is_empty() {
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
                    f.as_ref().and_then(|f| f.email_filter.tree.clone()),
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
                    filter: filter.as_ref().and_then(|f| f.email_filter.tree.clone()),
                })),
                // we don't yet have sort by frecency implemented for emails yet
                SoupQuery::Frecency(_) => None,
            }?,
            team_receipt,
            crm_scope,
        })
    }

    pub(crate) fn build_call_request(&self) -> Option<GetCallRecordsRequest> {
        Some(GetCallRecordsRequest {
            user_id: self.user.clone(),
            limit: self.limit as u32,
            query: match &self.cursor {
                SoupQuery::Simple(SimpleQueryInner(Query::Sort(t, f))) => Some(Query::Sort(
                    *t,
                    f.as_ref().and_then(|f| f.call_filter.clone()),
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
                    filter: filter.as_ref().and_then(|f| f.call_filter.clone()),
                })),
                // query by frecency not yet implemented for call records
                SoupQuery::Frecency(_) => None,
            }?,
        })
    }

    /// Returns `None` (skipping the CRM sub-request) for no-team users,
    /// Frecency cursors, or a malformed team-receipt uuid.
    pub(crate) fn build_crm_company_request(
        &self,
        team_receipt: &Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Option<GetCrmCompaniesRequest> {
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

    pub(crate) fn build_comms_request(&self) -> Option<GetChannelsRequest> {
        Some(GetChannelsRequest {
            macro_id: self.user.clone(),
            limit: Some(self.limit as u32),
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
            }?,
        })
    }

    pub(crate) fn build_foreign_entity_query(&self) -> Option<ForeignEntityListQuery> {
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
    /// = hidden only. The admin/owner role check is enforced upstream
    /// in soup's axum router before reaching this request.
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

/// a [SoupItem] with an associated frecency score
#[derive(Debug)]
#[non_exhaustive]
pub struct FrecencySoupItem {
    /// the soup item
    pub item: SoupItem,
    /// the frecency score
    pub frecency_score: Option<AggregateFrecency>,
}

impl Identify for FrecencySoupItem {
    type Id = String;

    fn id(&self) -> Self::Id {
        self.item.entity().entity_id.to_string()
    }
}

impl SortOn<Frecency> for FrecencySoupItem {
    fn sort_on(sort_type: Frecency) -> impl FnMut(&Self) -> models_pagination::CursorVal<Frecency> {
        move |val| CursorVal {
            sort_type,
            // if this record does not have a frecency score we fallback to created_at as the sort
            last_val: match &val.frecency_score {
                Some(f) => FrecencyValue::FrecencyScore(f.data.frecency_score),
                None => FrecencyValue::UpdatedAt(val.item.updated_at()),
            },
        }
    }
}

impl SortOn<SimpleSortMethod> for FrecencySoupItem {
    fn sort_on(sort: SimpleSortMethod) -> impl FnMut(&Self) -> CursorVal<SimpleSortMethod> {
        let mut cb = SoupItem::sort_on(sort);
        move |v| cb(&v.item)
    }
}

/// A soup request with optional grouping configuration.
#[derive(Debug)]
pub struct GroupedSoupRequest<T> {
    /// Base soup request parameters
    pub base: SoupRequest<T>,
    /// Optional grouping configuration
    pub grouping: Option<GroupingConfig>,
}

/// A soup item with group metadata attached (returned from grouped queries).
#[derive(Debug)]
pub struct GroupedSoupItem {
    /// The soup item
    pub item: SoupItem,
    /// The frecency score (if available)
    pub frecency_score: Option<AggregateFrecency>,
    /// Which group this item belongs to
    pub group_key: String,
    /// Total items in this group (computed via window function)
    pub group_total_count: u32,
    /// This item's position within the group (1-indexed)
    pub row_in_group: u32,
    /// Label for this group (from property_options or computed)
    pub group_label: Option<String>,
    /// Display order for this group
    pub group_display_order: Option<i32>,
}

#[derive(Debug, Error)]
pub enum SoupErr {
    #[error(transparent)]
    FrecencyErr(#[from] FrecencyQueryErr),
    #[error(transparent)]
    SoupDbErr(#[from] anyhow::Error),
    #[error(transparent)]
    EmailErr(#[from] email::domain::models::EmailErr),
    #[error("A comms error has occured, see logs for more details")]
    CommsErr,
    #[error("A call error has occurred, see logs for more details")]
    CallErr,
    #[error("A CRM error has occurred, see logs for more details")]
    CrmErr,
    #[error(transparent)]
    ForeignEntityErr(#[from] ForeignEntityError),
    #[error(transparent)]
    AstErr(#[from] ExpandErr),
}
