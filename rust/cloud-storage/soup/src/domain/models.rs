use email::domain::models::{GetEmailsRequest, PreviewView};
use frecency::domain::models::{AggregateFrecency, FrecencyQueryErr};
use item_filters::ast::EntityFilterAst;
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

pub enum SoupQuery {
    Simple(Query<Uuid, SimpleSortMethod, Option<EntityFilterAst>>),
    Frecency(Query<Uuid, Frecency, Option<EntityFilterAst>>),
}

impl SoupQuery {
    pub(crate) fn filter(&self) -> Option<&EntityFilterAst> {
        match self {
            SoupQuery::Simple(query) => query.filter().as_ref(),
            SoupQuery::Frecency(query) => query.filter().as_ref(),
        }
    }
}

pub struct SoupRequest {
    pub soup_type: SoupType,
    pub limit: u16,
    pub cursor: SoupQuery,
    pub user: MacroUserIdStr<'static>,
    pub email_preview_view: PreviewView,
    pub link_id: Uuid,
}

impl SoupRequest {
    pub(crate) fn build_email_request(&self) -> Option<GetEmailsRequest> {
        Some(GetEmailsRequest {
            view: self.email_preview_view.clone(),
            link_id: self.link_id,
            macro_id: self.user.clone(),
            limit: Some(self.limit as u32),
            query: match &self.cursor {
                SoupQuery::Simple(Query::Sort(t, _f)) => Some(Query::Sort(*t, ())),
                SoupQuery::Simple(Query::Cursor(CursorWithValAndFilter {
                    id,
                    limit,
                    val,
                    filter: _,
                })) => Some(Query::Cursor(CursorWithValAndFilter {
                    id: *id,
                    limit: *limit,
                    val: val.clone(),
                    filter: (),
                })),
                // we don't yet have sort by frecency implemented for emails yet
                // so we fallback to viewedupdated
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
}
