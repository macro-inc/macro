mod grouping;

pub use grouping::{
    GroupMeta, GroupedResponse, build_grouped_response, entity_type_labels,
    resolve_group_label_and_order,
};

use call::domain::models::GetCallRecordsRequest;
use comms::domain::models::GetChannelsRequest;
use crm::domain::companies_repo::CrmCompanyListSort;
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
    pub link_id: Option<Uuid>,
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
            link_id,
        } = self;

        Ok(SoupRequest {
            soup_type,
            limit,
            cursor: cursor.into_ast()?,
            user,
            email_preview_view,
            link_id,
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
            link_id,
        } = self;

        Ok(SoupRequest {
            soup_type,
            limit,
            cursor: cursor.map(|f| if f.is_empty() { None } else { Some(f) }),
            user,
            email_preview_view,
            link_id,
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

        Some(GetEmailsRequest {
            view: self.email_preview_view.clone(),
            link_id: self.link_id?,
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
        let team_id = Uuid::parse_str(&receipt.entity().entity_id)
            .inspect_err(|e| {
                tracing::warn!(
                    error=?e,
                    "team_receipt entity_id is not a valid uuid; skipping crm_company sub-request"
                );
            })
            .ok()?;

        let (sort_method, filter_ast): (SimpleSortMethod, Option<&EntityFilterAst>) =
            match &self.cursor {
                SoupQuery::Simple(SimpleQueryInner(Query::Sort(t, f))) => (*t, f.as_ref()),
                SoupQuery::Simple(SimpleQueryInner(Query::Cursor(CursorWithValAndFilter {
                    val,
                    filter,
                    ..
                }))) => (val.sort_type, filter.as_ref()),
                SoupQuery::Frecency(_) => return None,
            };

        // No viewed_at signal for crm_company yet — ViewedAt/ViewedUpdated
        // fall back to updated_at.
        let sort = match sort_method {
            SimpleSortMethod::CreatedAt => CrmCompanyListSort::CreatedAt,
            SimpleSortMethod::UpdatedAt
            | SimpleSortMethod::ViewedAt
            | SimpleSortMethod::ViewedUpdated => CrmCompanyListSort::UpdatedAt,
        };

        let mut company_ids = Vec::new();
        if let Some(tree) = filter_ast.and_then(|a| a.crm_company_filter.as_ref())
            && !collect_crm_company_ids(tree, &mut company_ids)
        {
            // Fail closed: unsupported AST shape would widen the result
            // set. Skip the CRM sub-request rather than over-include.
            return None;
        }

        Some(GetCrmCompaniesRequest {
            team_id,
            company_ids,
            sort,
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
    /// Team whose CRM companies to list. Derived from the team receipt.
    pub team_id: Uuid,
    /// Filter to specific company ids. Empty = all of the team's
    /// non-hidden companies (subject to the killswitch).
    pub company_ids: Vec<Uuid>,
    /// Which timestamp column to sort by.
    pub sort: CrmCompanyListSort,
    /// Upper bound on rows returned — the soup paginator re-slices.
    pub limit: i64,
}

/// Walks a `CrmCompanyLiteral` AST collecting every `Id(uuid)` literal.
/// Returns `false` when the AST contains `And` or `Not` — both shapes
/// would change set semantics (`And` would intersect, `Not` would
/// invert) but a flat collector can't represent that, so the caller
/// fails closed rather than widening the result.
fn collect_crm_company_ids(expr: &Expr<CrmCompanyLiteral>, out: &mut Vec<Uuid>) -> bool {
    match expr {
        Expr::Or(a, b) => collect_crm_company_ids(a, out) && collect_crm_company_ids(b, out),
        Expr::Literal(CrmCompanyLiteral::Id(id)) => {
            out.push(*id);
            true
        }
        Expr::And(_, _) | Expr::Not(_) => false,
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
