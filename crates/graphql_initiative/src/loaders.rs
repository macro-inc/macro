//! Lazy, viewer-scoped initiative details composed onto Soup entities.

use std::{collections::HashMap, convert::Infallible, sync::Arc};

use async_graphql::{
    Context,
    dataloader::{DataLoader, Loader},
};
use futures::{StreamExt, stream};
use initiative::domain::{models::InitiativeDetail, reads::InitiativePageRow};
use macro_user_id::user_id::MacroUserIdStr;
use uuid::Uuid;

use crate::{InitiativeGraphqlContext, graphql_error};

/// Bound concurrent domain reads until the domain exposes bulk detail/summary reads.
const MAX_CONCURRENT_READS: usize = 16;

/// Viewer-scoped detail reader; authorization remains in the capability bridge.
pub struct InitiativeDetailLoader {
    context: InitiativeGraphqlContext,
    user: MacroUserIdStr<'static>,
}

impl Loader<Uuid> for InitiativeDetailLoader {
    type Value = async_graphql::Result<Arc<InitiativeDetail>>;
    type Error = Infallible;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, Self::Value>, Self::Error> {
        Ok(stream::iter(keys.iter().copied().map(|id| async move {
            let result = self
                .context
                .0
                .get(self.user.clone(), id)
                .await
                .map(Arc::new)
                .map_err(graphql_error);
            (id, result)
        }))
        .buffer_unordered(MAX_CONCURRENT_READS)
        .collect()
        .await)
    }
}

/// Viewer-scoped task progress reader, selected independently of project details.
pub struct InitiativeSummaryLoader {
    context: InitiativeGraphqlContext,
    user: MacroUserIdStr<'static>,
}

impl Loader<Uuid> for InitiativeSummaryLoader {
    type Value = async_graphql::Result<Arc<InitiativePageRow>>;
    type Error = Infallible;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, Self::Value>, Self::Error> {
        Ok(stream::iter(keys.iter().copied().map(|id| async move {
            let result = self
                .context
                .0
                .summary(self.user.clone(), id)
                .await
                .map(Arc::new)
                .map_err(graphql_error);
            (id, result)
        }))
        .buffer_unordered(MAX_CONCURRENT_READS)
        .collect()
        .await)
    }
}

/// Coalesce concurrent detail fields without retaining data across mutations or subscription events.
pub fn initiative_detail_loader(
    context: InitiativeGraphqlContext,
    user: MacroUserIdStr<'static>,
) -> DataLoader<InitiativeDetailLoader> {
    DataLoader::new(InitiativeDetailLoader { context, user }, tokio::spawn)
}

/// Coalesce progress fields without retaining data across mutations or subscription events.
pub fn initiative_summary_loader(
    context: InitiativeGraphqlContext,
    user: MacroUserIdStr<'static>,
) -> DataLoader<InitiativeSummaryLoader> {
    DataLoader::new(InitiativeSummaryLoader { context, user }, tokio::spawn)
}

/// Load authorized initiative details only when a detail field is requested.
pub async fn load_initiative_detail(
    ctx: &Context<'_>,
    id: Uuid,
) -> async_graphql::Result<Arc<InitiativeDetail>> {
    match ctx
        .data::<DataLoader<InitiativeDetailLoader>>()?
        .load_one(id)
        .await
    {
        Ok(Some(result)) => result,
        Ok(None) => Err(async_graphql::Error::new(
            "initiative detail is unavailable",
        )),
        Err(impossible) => match impossible {},
    }
}

/// Load permission-filtered task progress only when a count field is requested.
pub async fn load_initiative_summary(
    ctx: &Context<'_>,
    id: Uuid,
) -> async_graphql::Result<Arc<InitiativePageRow>> {
    match ctx
        .data::<DataLoader<InitiativeSummaryLoader>>()?
        .load_one(id)
        .await
    {
        Ok(Some(result)) => result,
        Ok(None) => Err(async_graphql::Error::new(
            "initiative progress is unavailable",
        )),
        Err(impossible) => match impossible {},
    }
}
