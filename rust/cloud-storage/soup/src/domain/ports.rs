use crate::domain::models::{
    AdvancedSortParams, FrecencySoupItem, SimpleSortRequest, SoupErr, SoupRequest,
};
use either::Either;
use item_filters::ast::EntityFilterAst;
use models_pagination::{Frecency, PaginatedCursor, SimpleSortMethod};
use models_soup::item::SoupItem;

#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait SoupRepo: Send + Sync + 'static {
    type Err;
    fn expanded_generic_cursor_soup<'a>(
        &self,
        req: SimpleSortRequest<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem>, Self::Err>> + Send;

    fn unexpanded_generic_cursor_soup<'a>(
        &self,
        req: SimpleSortRequest<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem>, Self::Err>> + Send;

    fn expanded_soup_by_ids<'a>(
        &self,
        req: AdvancedSortParams<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem>, Self::Err>> + Send;

    fn unexpanded_soup_by_ids<'a>(
        &self,
        req: AdvancedSortParams<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem>, Self::Err>> + Send;
}

/// type alias which represents the posible outputs of soup
/// The response is a paginated cursor where
/// 1. The item type is [FrecencySoupItem]
/// 1. The id type is [String] (this should be changed to uuid)
/// 1. The sort method is [Either] [SimpleSortMethod] or [Frecency]
/// 1. The filter type is an [Option] [EntityFilterAst]
pub type SoupOutput = Either<
    PaginatedCursor<FrecencySoupItem, String, SimpleSortMethod, Option<EntityFilterAst>>,
    PaginatedCursor<FrecencySoupItem, String, Frecency, Option<EntityFilterAst>>,
>;

pub trait SoupService: Send + Sync + 'static {
    fn get_user_soup(
        &self,
        req: SoupRequest,
    ) -> impl Future<Output = Result<SoupOutput, SoupErr>> + Send;
}
