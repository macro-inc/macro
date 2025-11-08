use crate::domain::models::{
    AdvancedSortParams, FrecencySoupItem, SimpleSortRequest, SoupErr, SoupRequest,
};
use models_pagination::PaginatedOpaqueCursor;
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

pub trait SoupService: Send + Sync + 'static {
    fn get_user_soup(
        &self,
        req: SoupRequest,
    ) -> impl Future<Output = Result<PaginatedOpaqueCursor<FrecencySoupItem>, SoupErr>> + Send;
}
