use crate::domain::models::{
    AdvancedSortParams, FrecencySoupItem, GroupedSortRequest, GroupedSoupItem, IntoSoupReqAst,
    SimpleSortRequest, SoupErr, SoupRequest,
};
use either::Either;
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use models_pagination::{Frecency, PaginatedCursor, SimpleSortMethod};
use models_soup::item::SoupItem;
use serde::Serialize;

/// Repository abstraction for loading soup items from storage.
#[cfg_attr(test, mockall::automock(type Err = anyhow::Error;))]
pub trait SoupRepo: Send + Sync + 'static {
    /// Error returned by repository operations.
    type Err;
    /// Fetch expanded soup items for a simple sorted cursor query.
    fn expanded_generic_cursor_soup<'a>(
        &self,
        req: SimpleSortRequest<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem>, Self::Err>> + Send;

    /// Fetch unexpanded soup items for a simple sorted cursor query.
    fn unexpanded_generic_cursor_soup<'a>(
        &self,
        req: SimpleSortRequest<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem>, Self::Err>> + Send;

    /// Fetch expanded soup items for an explicit list of entity ids.
    fn expanded_soup_by_ids<'a>(
        &self,
        req: AdvancedSortParams<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem>, Self::Err>> + Send;

    /// Fetch unexpanded soup items for an explicit list of entity ids.
    fn unexpanded_soup_by_ids<'a>(
        &self,
        req: AdvancedSortParams<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem>, Self::Err>> + Send;

    /// Populates properties for a slice of SoupItems.
    fn populate_properties(
        &self,
        items: &mut [SoupItem],
    ) -> impl Future<Output = Result<(), Self::Err>> + Send;

    /// Fetches expanded soup items with group metadata.
    fn expanded_grouped_cursor_soup<'a>(
        &self,
        req: GroupedSortRequest<'a>,
    ) -> impl Future<Output = Result<Vec<GroupedSoupItem>, Self::Err>> + Send;
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

/// Service abstraction for executing user-facing soup queries.
pub trait SoupService: Send + Sync + 'static {
    /// Run a soup query for the authenticated user.
    ///
    /// `team_receipt` proves the user belongs to a team and may be used by
    /// filters that broaden visibility beyond the user's own mailboxes (e.g.
    /// `EmailFilters::crm_domains` / `crm_addresses`). Pass `None` when
    /// no CRM-scoped filter is active.
    fn get_user_soup<T>(
        &self,
        req: SoupRequest<T>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> impl Future<Output = Result<SoupOutput<T>, SoupErr>> + Send
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send;

    /// Run a grouped soup query for the authenticated user.
    fn get_user_soup_grouped(
        &self,
        req: GroupedSortRequest<'_>,
    ) -> impl Future<Output = Result<Vec<GroupedSoupItem>, SoupErr>> + Send;
}
