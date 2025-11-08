use frecency::domain::{models::AggregateFrecency, ports::FrecencyQueryErr};
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

/// possible things we can exclude from the results
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SoupExclude {
    /// excludes any item that has a frecency record from the results
    Frecency,
}

/// the parameters required for a [SimpleSortMethod]
#[derive(Debug)]
pub struct SimpleSortRequest<'a> {
    /// the limit of the number of items to return
    pub limit: u16,
    /// the [ParsedCursor] the client passes (if any)
    pub cursor: Query<String, SimpleSortMethod>,
    /// the id of the user
    pub user_id: MacroUserIdStr<'a>,
    /// a list of things that should be excluded from the query
    pub exclude: Vec<SoupExclude>,
}

#[derive(Debug)]
pub struct AdvancedSortParams<'a> {
    pub entities: &'a [Entity<'a>],
    pub user_id: MacroUserIdStr<'a>,
}

pub enum SoupQuery {
    Simple(Query<String, SimpleSortMethod>),
    Frecency(Query<String, Frecency>),
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
    fn sort_on(
        sort_type: Frecency,
    ) -> impl FnOnce(&Self) -> models_pagination::CursorVal<Frecency> {
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
    fn sort_on(sort: SimpleSortMethod) -> impl FnOnce(&Self) -> CursorVal<SimpleSortMethod> {
        let cb = SoupItem::sort_on(sort);
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
