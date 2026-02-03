use comms::domain::models::GetChannelsRequest;
use email::domain::models::{GetEmailsRequest, PreviewView};
use frecency::domain::models::{AggregateFrecency, FrecencyQueryErr};
use item_filters::{
    EntityFilters,
    ast::{EntityFilterAst, ExpandErr},
};
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use models_pagination::{
    Cursor, CursorVal, CursorWithValAndFilter, Frecency, FrecencyValue, Identify, Query,
    SimpleSortMethod, SortOn,
};
use models_soup::item::SoupItem;
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

/// the inner private type for [SoupQuery::Simple]
#[derive(Debug)]
pub struct SimpleQueryInner<T>(pub(crate) Query<Uuid, SimpleSortMethod, T>);

/// the inner private type for [SoupQuery::Frecency]
#[derive(Debug)]
pub struct FrecencyQueryInner<T>(pub(crate) Query<Uuid, Frecency, T>);

impl SoupQuery<EntityFilters> {
    /// create a new instance of a [SimpleSortMethod] with [EntityFilters] this is used to
    /// construct the initial page request. To paginate an existing cursor see [Self::new_cursor_simple]
    pub fn new_sort_simple(method: SimpleSortMethod, filters: EntityFilters) -> Self {
        SoupQuery::Simple(SimpleQueryInner(models_pagination::Query::Sort(
            method, filters,
        )))
    }

    /// create a new instance of a [Frecency] with [EntityFilters] this is used to
    /// construct the initial page request. To paginate an existing cursor see [Self::new_cursor_frecency]
    pub fn new_sort_frecency(method: Frecency, filters: EntityFilters) -> Self {
        SoupQuery::Frecency(FrecencyQueryInner(models_pagination::Query::Sort(
            method, filters,
        )))
    }

    /// create a new instance of a [SimpleSortMethod] with an existing cursor on [EntityFilters].
    /// This is used to continue paginating on an existing cursor.
    /// To create a new initial page see [Self::new_sort_simple]
    pub fn new_cursor_simple(
        cursor: CursorWithValAndFilter<Uuid, SimpleSortMethod, EntityFilters>,
    ) -> Self {
        SoupQuery::Simple(SimpleQueryInner(models_pagination::Query::Cursor(cursor)))
    }

    /// create a new instance of a [Frecency] with an existing cursor on [EntityFilters].
    /// This is used to continue paginating on an existing cursor.
    /// To create a new initial page see [Self::new_sort_simple]
    pub fn new_cursor_frecency(
        cursor: CursorWithValAndFilter<Uuid, Frecency, EntityFilters>,
    ) -> Self {
        SoupQuery::Frecency(FrecencyQueryInner(models_pagination::Query::Cursor(cursor)))
    }

    pub fn filter(&self) -> &EntityFilters {
        match self {
            SoupQuery::Simple(SimpleQueryInner(query)) => query.filter(),
            SoupQuery::Frecency(FrecencyQueryInner(query)) => query.filter(),
        }
    }

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

impl SoupRequest<EntityFilters> {
    /// returns a reference to the filters to pass to the paginator
    /// this is used to prevent passing back the full ast on each server request
    pub(crate) fn filters(&self) -> &EntityFilters {
        self.cursor.filter()
    }

    pub(crate) fn into_ast(self) -> Result<SoupRequest<Option<EntityFilterAst>>, ExpandErr> {
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

impl SoupRequest<Option<EntityFilterAst>> {
    /// take the parts of the [SoupRequest] that are only relevant to email
    /// and move them into a [GetEmailsRequest] if it is possible to create one
    pub(crate) fn build_email_request(&self) -> Option<GetEmailsRequest> {
        Some(GetEmailsRequest {
            view: self.email_preview_view.clone(),
            link_id: self.link_id?,
            macro_id: self.user.clone(),
            limit: Some(self.limit as u32),
            query: match &self.cursor {
                SoupQuery::Simple(SimpleQueryInner(Query::Sort(t, f))) => Some(Query::Sort(
                    *t,
                    f.as_ref().and_then(|f| f.email_filter.clone()),
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
                    filter: filter.as_ref().and_then(|f| f.email_filter.clone()),
                })),
                // we don't yet have sort by frecency implemented for emails yet
                SoupQuery::Frecency(_) => None,
            }?,
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
    #[error(transparent)]
    AstErr(#[from] ExpandErr),
}
