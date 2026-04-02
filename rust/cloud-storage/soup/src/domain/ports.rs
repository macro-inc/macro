use crate::domain::models::{
    AdvancedSortParams, FrecencySoupItem, IntoSoupReqAst, SimpleSortRequest, SoupErr, SoupRequest,
};
use either::Either;
use models_pagination::{Frecency, PaginatedCursor, SimpleSortMethod};
use models_soup::item::SoupItem;
use serde::Serialize;

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

    /// Populates properties for a slice of SoupItems.
    fn populate_properties(
        &self,
        items: &mut [SoupItem],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;
}

/// type alias which represents the posible outputs of soup
/// The response is a paginated cursor where
/// 1. The item type is [FrecencySoupItem]
/// 1. The id type is [String] (this should be changed to uuid)
/// 1. The sort method is [Either] [SimpleSortMethod] or [Frecency]
/// 1. The filter type is an [Option] [EntityFilterAst]
pub type SoupOutput<T> = Either<
    PaginatedCursor<FrecencySoupItem, String, SimpleSortMethod, T>,
    PaginatedCursor<FrecencySoupItem, String, Frecency, T>,
>;

pub trait SoupService: Send + Sync + 'static {
    fn get_user_soup<T>(
        &self,
        req: SoupRequest<T>,
    ) -> impl Future<Output = Result<SoupOutput<T>, SoupErr>> + Send
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send;
}
