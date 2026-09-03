use std::sync::Arc;

use crate::domain::models::{
    AdvancedSortParams, EnrichedSoupItem, GroupedSortRequest, IntoSoupReqAst, NotifiedEntity,
    NotifiedSoupRequest, SimpleSortRequest, SoupErr, SoupProjectionHydration, SoupPropertiesField,
    SoupRequest, TouchedEntity, TouchedSoupRequest, grouping::ItemGroupingInfo,
};
use entity_access::domain::models::{EntityAccessReceipt, MemberTeamRole};
use macro_user_id::user_id::MacroUserIdStr;
use models_pagination::{
    Frecency, NotifiedAt, PaginatedCursor, PaginatedOpaqueCursor, SimpleSortMethod, TouchedByMe,
    TypeEraseCursor,
};
use models_properties::service::property_definition_with_options::PropertyDefinitionWithOptions;
use models_soup::item::SoupItem;
use serde::Serialize;

/// Repository abstraction for loading soup items from storage.
#[cfg_attr(
    test,
    mockall::automock(
        type Err = anyhow::Error;
        type GroupedItems = std::vec::IntoIter<ItemGroupingInfo>;
    )
)]
pub trait SoupRepo: Send + Sync + 'static {
    /// Error returned by repository operations.
    type Err;
    /// Iterator returned by grouped Soup queries.
    type GroupedItems: Iterator<Item = ItemGroupingInfo> + Send;
    /// Fetch expanded soup items for a simple sorted cursor query.
    fn expanded_generic_cursor_soup<'a>(
        &self,
        req: SimpleSortRequest<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem<()>>, Self::Err>> + Send;

    /// Fetch expanded Soup items and optional document server facts from the
    /// same authorized detail rows.
    fn expanded_generic_cursor_soup_with_projection<'a>(
        &self,
        req: SimpleSortRequest<'a>,
    ) -> impl Future<Output = Result<Vec<SoupProjectionHydration>, Self::Err>> + Send;

    /// Fetch unexpanded soup items for a simple sorted cursor query.
    fn unexpanded_generic_cursor_soup<'a>(
        &self,
        req: SimpleSortRequest<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem<()>>, Self::Err>> + Send;

    /// Fetch expanded soup items for an explicit list of entity ids.
    fn expanded_soup_by_ids<'a>(
        &self,
        req: AdvancedSortParams<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem<()>>, Self::Err>> + Send;

    /// Fetch expanded Soup items by ID with optional document server facts
    /// from the same authorized detail rows.
    fn expanded_soup_by_ids_with_projection<'a>(
        &self,
        req: AdvancedSortParams<'a>,
    ) -> impl Future<Output = Result<Vec<SoupProjectionHydration>, Self::Err>> + Send;

    /// Fetch unexpanded soup items for an explicit list of entity ids.
    fn unexpanded_soup_by_ids<'a>(
        &self,
        req: AdvancedSortParams<'a>,
    ) -> impl Future<Output = Result<Vec<SoupItem<()>>, Self::Err>> + Send;

    /// Attaches properties to raw Soup items while preserving their order and
    /// count. The user id scopes which tag properties are visible (the
    /// caller's own and their team's).
    fn populate_properties<'a>(
        &self,
        user_id: MacroUserIdStr<'a>,
        items: Vec<SoupItem<()>>,
    ) -> impl Future<Output = Result<Vec<SoupItem<SoupPropertiesField>>, Self::Err>> + Send;

    /// Fetches the tag definitions visible to a user — their own plus their
    /// teams' — with options attached.
    fn caller_tag_sets<'a>(
        &self,
        user_id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<Vec<PropertyDefinitionWithOptions>, Self::Err>> + Send;

    /// Fetches expanded soup items with group metadata.
    fn expanded_grouped_cursor_soup<'a>(
        &self,
        req: GroupedSortRequest<'a>,
    ) -> impl Future<Output = Result<Self::GroupedItems, Self::Err>> + Send;

    /// Fetch one page of touched-by-me candidates: entities the user has
    /// mutated (views excluded), newest own-mutation first, already gated on
    /// existence, deletion, access, and the request's entity filters.
    fn touched_soup_page<'a>(
        &self,
        req: TouchedSoupRequest<'a>,
    ) -> impl Future<Output = Result<Vec<TouchedEntity>, Self::Err>> + Send;

    /// Fetch one page of notified-at candidates: entities the user holds a
    /// live notification for, newest notification first, already gated on
    /// existence, deletion and access, and on the request's entity filters
    /// where soup owns the fold.
    fn notified_soup_page<'a>(
        &self,
        req: NotifiedSoupRequest<'a>,
    ) -> impl Future<Output = Result<Vec<NotifiedEntity>, Self::Err>> + Send;
}

/// The possible outputs of soup — one paginated page per query mode.
/// The page is a paginated cursor where
/// 1. The item type is the requested raw or enriched Soup representation
/// 1. The id type is [String] (this should be changed to uuid)
/// 1. The sort method matches the variant's query mode
/// 1. The filter type is an [Option] [EntityFilterAst]
#[derive(Debug)]
pub enum SoupOutput<T, Item = SoupItem<()>> {
    /// Page of a timestamp-sorted query.
    Simple(PaginatedCursor<Item, String, SimpleSortMethod, T>),
    /// Page of a frecency-sorted query.
    Frecency(PaginatedCursor<Item, String, Frecency, T>),
    /// Page of a touched-by-me query.
    Touched(PaginatedCursor<Item, String, TouchedByMe, T>),
    /// Page of a notified-at query.
    Notified(PaginatedCursor<Item, String, NotifiedAt, T>),
}

impl<T, Item> SoupOutput<T, Item> {
    /// Maps the item type of the page, preserving the cursor.
    pub fn map<F, V>(self, f: F) -> SoupOutput<T, V>
    where
        F: FnMut(Item) -> V,
    {
        match self {
            SoupOutput::Simple(page) => SoupOutput::Simple(page.map(f)),
            SoupOutput::Frecency(page) => SoupOutput::Frecency(page.map(f)),
            SoupOutput::Touched(page) => SoupOutput::Touched(page.map(f)),
            SoupOutput::Notified(page) => SoupOutput::Notified(page.map(f)),
        }
    }

    /// Discards the cursor and returns the page's items.
    pub fn into_items(self) -> Vec<Item> {
        match self {
            SoupOutput::Simple(page) => page.items,
            SoupOutput::Frecency(page) => page.items,
            SoupOutput::Touched(page) => page.items,
            SoupOutput::Notified(page) => page.items,
        }
    }

    /// Returns the page when this is a [`SoupOutput::Simple`] output.
    pub fn into_simple(self) -> Option<PaginatedCursor<Item, String, SimpleSortMethod, T>> {
        match self {
            SoupOutput::Simple(page) => Some(page),
            SoupOutput::Frecency(_) | SoupOutput::Touched(_) | SoupOutput::Notified(_) => None,
        }
    }

    /// Returns the page when this is a [`SoupOutput::Frecency`] output.
    pub fn into_frecency(self) -> Option<PaginatedCursor<Item, String, Frecency, T>> {
        match self {
            SoupOutput::Frecency(page) => Some(page),
            SoupOutput::Simple(_) | SoupOutput::Touched(_) | SoupOutput::Notified(_) => None,
        }
    }

    /// Returns the page when this is a [`SoupOutput::Touched`] output.
    pub fn into_touched(self) -> Option<PaginatedCursor<Item, String, TouchedByMe, T>> {
        match self {
            SoupOutput::Touched(page) => Some(page),
            SoupOutput::Simple(_) | SoupOutput::Frecency(_) | SoupOutput::Notified(_) => None,
        }
    }

    /// Returns the page when this is a [`SoupOutput::Notified`] output.
    pub fn into_notified(self) -> Option<PaginatedCursor<Item, String, NotifiedAt, T>> {
        match self {
            SoupOutput::Notified(page) => Some(page),
            SoupOutput::Simple(_) | SoupOutput::Frecency(_) | SoupOutput::Touched(_) => None,
        }
    }
}

impl<T, Item> TypeEraseCursor<Item> for SoupOutput<T, Item> {
    fn type_erase(self) -> PaginatedOpaqueCursor<Item> {
        match self {
            SoupOutput::Simple(page) => page.type_erase(),
            SoupOutput::Frecency(page) => page.type_erase(),
            SoupOutput::Touched(page) => page.type_erase(),
            SoupOutput::Notified(page) => page.type_erase(),
        }
    }
}

#[cfg(test)]
mod test;

/// Service abstraction for executing user-facing soup queries.
pub trait SoupService: Send + Sync + 'static {
    /// Run a soup query without loading entity properties or frecency.
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

    /// Run a Soup query and retain authoritative document server facts for
    /// expanded items.
    ///
    /// Implementations that do not opt into relation hydration leave every
    /// item's server facts empty. The production service overrides this method.
    fn get_user_soup_with_projection<T>(
        &self,
        req: SoupRequest<T>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> impl Future<Output = Result<SoupOutput<T, SoupProjectionHydration>, SoupErr>> + Send
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send,
    {
        async move {
            self.get_user_soup(req, team_receipt).await.map(|output| {
                output.map(|item| SoupProjectionHydration {
                    item,
                    document_server_facts: None,
                })
            })
        }
    }

    /// Run a soup query and attach entity properties to the returned page.
    fn get_user_soup_with_properties<T>(
        &self,
        req: SoupRequest<T>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> impl Future<Output = Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>> + Send
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send;

    /// Run a soup query and attach frecency to the returned page.
    fn get_user_soup_with_frecency<T>(
        &self,
        req: SoupRequest<T>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> impl Future<Output = Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>> + Send
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send;

    /// Run a Soup query with frecency and authoritative document server facts
    /// for expanded items.
    fn get_user_soup_with_frecency_and_projection<T>(
        &self,
        req: SoupRequest<T>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> impl Future<
        Output = Result<SoupOutput<T, SoupProjectionHydration<EnrichedSoupItem>>, SoupErr>,
    > + Send
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send,
    {
        async move {
            self.get_user_soup_with_frecency(req, team_receipt)
                .await
                .map(|output| {
                    output.map(|item| SoupProjectionHydration {
                        item,
                        document_server_facts: None,
                    })
                })
        }
    }

    /// Run a soup query and attach both properties and frecency to the page.
    fn get_user_soup_with_properties_and_frecency<T>(
        &self,
        req: SoupRequest<T>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> impl Future<Output = Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>> + Send
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send;

    /// Run a grouped soup query for the authenticated user with properties.
    fn get_user_soup_grouped(
        &self,
        req: GroupedSortRequest<'_>,
    ) -> impl Future<
        Output = Result<
            impl Iterator<Item = ItemGroupingInfo<SoupPropertiesField>> + Send,
            SoupErr,
        >,
    > + Send;

    /// Fetch the tag definitions visible to a user — their own plus their
    /// teams' — with options attached.
    fn caller_tag_sets<'a>(
        &self,
        user_id: MacroUserIdStr<'a>,
    ) -> impl Future<Output = Result<Vec<PropertyDefinitionWithOptions>, SoupErr>> + Send;
}

impl<S> SoupService for Arc<S>
where
    S: SoupService,
{
    async fn get_user_soup<T>(
        &self,
        req: SoupRequest<T>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send,
    {
        (**self).get_user_soup(req, team_receipt).await
    }

    async fn get_user_soup_with_projection<T>(
        &self,
        req: SoupRequest<T>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, SoupProjectionHydration>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send,
    {
        (**self)
            .get_user_soup_with_projection(req, team_receipt)
            .await
    }

    async fn get_user_soup_with_properties<T>(
        &self,
        req: SoupRequest<T>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send,
    {
        (**self)
            .get_user_soup_with_properties(req, team_receipt)
            .await
    }

    async fn get_user_soup_with_frecency<T>(
        &self,
        req: SoupRequest<T>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send,
    {
        (**self)
            .get_user_soup_with_frecency(req, team_receipt)
            .await
    }

    async fn get_user_soup_with_frecency_and_projection<T>(
        &self,
        req: SoupRequest<T>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, SoupProjectionHydration<EnrichedSoupItem>>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send,
    {
        (**self)
            .get_user_soup_with_frecency_and_projection(req, team_receipt)
            .await
    }

    async fn get_user_soup_with_properties_and_frecency<T>(
        &self,
        req: SoupRequest<T>,
        team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send,
    {
        (**self)
            .get_user_soup_with_properties_and_frecency(req, team_receipt)
            .await
    }

    async fn get_user_soup_grouped(
        &self,
        req: GroupedSortRequest<'_>,
    ) -> Result<impl Iterator<Item = ItemGroupingInfo<SoupPropertiesField>> + Send, SoupErr> {
        (**self).get_user_soup_grouped(req).await
    }

    async fn caller_tag_sets<'a>(
        &self,
        user_id: MacroUserIdStr<'a>,
    ) -> Result<Vec<PropertyDefinitionWithOptions>, SoupErr> {
        (**self).caller_tag_sets(user_id).await
    }
}

/// No-op [`SoupService`] for binaries that need to satisfy the bound but
/// never serve soup queries — e.g. schema-only GraphQL SDL export. Every
/// method errors; swap for a real implementation if you actually need soup.
#[derive(Clone, Copy, Debug, Default)]
pub struct NoOpSoupService;

fn no_op_soup_err() -> SoupErr {
    SoupErr::SoupDbErr(anyhow::anyhow!("no-op soup service"))
}

impl SoupService for NoOpSoupService {
    async fn get_user_soup<T>(
        &self,
        _req: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send,
    {
        Err(no_op_soup_err())
    }

    async fn get_user_soup_with_properties<T>(
        &self,
        _req: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send,
    {
        Err(no_op_soup_err())
    }

    async fn get_user_soup_with_frecency<T>(
        &self,
        _req: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send,
    {
        Err(no_op_soup_err())
    }

    async fn get_user_soup_with_properties_and_frecency<T>(
        &self,
        _req: SoupRequest<T>,
        _team_receipt: Option<EntityAccessReceipt<MemberTeamRole>>,
    ) -> Result<SoupOutput<T, EnrichedSoupItem>, SoupErr>
    where
        SoupRequest<T>: IntoSoupReqAst,
        T: Clone + Serialize + Send,
    {
        Err(no_op_soup_err())
    }

    async fn get_user_soup_grouped(
        &self,
        _req: GroupedSortRequest<'_>,
    ) -> Result<impl Iterator<Item = ItemGroupingInfo<SoupPropertiesField>> + Send, SoupErr> {
        Err::<std::vec::IntoIter<ItemGroupingInfo<SoupPropertiesField>>, _>(no_op_soup_err())
    }

    async fn caller_tag_sets<'a>(
        &self,
        _user_id: MacroUserIdStr<'a>,
    ) -> Result<Vec<PropertyDefinitionWithOptions>, SoupErr> {
        Err(no_op_soup_err())
    }
}
