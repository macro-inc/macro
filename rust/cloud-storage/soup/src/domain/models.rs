use frecency::domain::{models::AggregateFrecency, ports::FrecencyQueryErr};
use item_filters::ast::EntityFilterAst;
use macro_user_id::user_id::MacroUserIdStr;
use model_entity::Entity;
use models_pagination::{
    CursorVal, Frecency, FrecencyValue, Identify, Query, SimpleSortMethod, SortOn,
};
use models_soup::item::SoupItem;
use thiserror::Error;

#[derive(Debug, Clone, Copy)]
pub enum SoupType {
    Expanded,
    UnExpanded,
}

/// the parameters required for a [SimpleSortMethod]
#[derive(Debug)]
pub(crate) struct SimpleSortRequest<'a> {
    /// the limit of the number of items to return
    pub limit: u16,
    /// the [Query] the client passes (if any)
    pub cursor: Query<String, SimpleSortMethod, Option<SimpleSortFilter>>,
    /// the id of the user
    pub user_id: MacroUserIdStr<'a>,
}

/// the types of values we can potentially filter out of a [SimpleSortRequest]
#[derive(Debug)]
pub(crate) enum SimpleSortFilter {
    /// remove frecency values from output
    Frecency(Frecency),
    /// remove the ast values from output
    Ast(EntityFilterAst),
    ///
    FrecencyAst(Frecency, EntityFilterAst),
}

#[derive(Debug)]
pub struct AdvancedSortParams<'a> {
    pub entities: &'a [Entity<'a>],
    pub user_id: MacroUserIdStr<'a>,
}

pub enum SoupQuery {
    Simple(Query<String, SimpleSortMethod, Option<EntityFilterAst>>),
    Frecency(Query<String, Frecency, Option<EntityFilterAst>>),
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
    fn sort_on<F>(
        sort_type: Frecency,
        filter: F,
    ) -> impl FnOnce(&Self) -> models_pagination::CursorVal<Frecency, F> {
        move |val| CursorVal {
            sort_type,
            // if this record does not have a frecency score we fallback to created_at as the sort
            last_val: match &val.frecency_score {
                Some(f) => FrecencyValue::FrecencyScore(f.data.frecency_score),
                None => FrecencyValue::UpdatedAt(val.item.updated_at()),
            },
            filter,
        }
    }
}

impl SortOn<SimpleSortMethod> for FrecencySoupItem {
    fn sort_on<F>(
        sort: SimpleSortMethod,
        filter: F,
    ) -> impl FnOnce(&Self) -> CursorVal<SimpleSortMethod, F> {
        let cb = SoupItem::sort_on(sort, filter);
        move |v| cb(&v.item)
    }
}

#[derive(Debug, Error)]
pub enum SoupErr {
    #[error(transparent)]
    FrecencyErr(#[from] FrecencyQueryErr),
    #[error(transparent)]
    SoupDbErr(#[from] anyhow::Error),
}
