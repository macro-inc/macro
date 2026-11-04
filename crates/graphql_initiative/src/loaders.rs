//! Lazy, viewer-scoped initiative details composed onto Soup entities.

use std::{collections::HashMap, convert::Infallible, sync::Arc};

use async_graphql::{
    Context,
    dataloader::{DataLoader, Loader},
};
use futures::{StreamExt, stream};
use initiative::domain::{
    models::InitiativeDetail,
    reads::{InitiativePageRow, InitiativeRead},
};
use macro_user_id::user_id::MacroUserIdStr;
use tokio::sync::OnceCell;
use uuid::Uuid;

use crate::{InitiativeGraphqlContext, graphql_error};

/// Bound concurrent domain reads until the domain exposes bulk detail/summary reads.
const MAX_CONCURRENT_READS: usize = 16;

/// One viewer-scoped read shared by detail and progress fields, so task access is checked once.
pub struct LoadedInitiative {
    read: InitiativeRead,
    pub(crate) detail: Arc<InitiativeDetail>,
    summary: OnceCell<Arc<InitiativePageRow>>,
}

/// Viewer-scoped initiative reader; authorization remains in the capability bridge.
pub struct InitiativeLoader {
    context: InitiativeGraphqlContext,
    user: MacroUserIdStr<'static>,
}

impl Loader<Uuid> for InitiativeLoader {
    type Value = async_graphql::Result<Arc<LoadedInitiative>>;
    type Error = Infallible;

    async fn load(&self, keys: &[Uuid]) -> Result<HashMap<Uuid, Self::Value>, Self::Error> {
        Ok(stream::iter(keys.iter().copied().map(|id| async move {
            let result = self
                .context
                .0
                .read(self.user.clone(), id)
                .await
                .map(|read| {
                    Arc::new(LoadedInitiative {
                        detail: Arc::new(read.detail().clone()),
                        read,
                        summary: OnceCell::new(),
                    })
                })
                .map_err(graphql_error);
            (id, result)
        }))
        .buffer_unordered(MAX_CONCURRENT_READS)
        .collect()
        .await)
    }
}

/// Coalesce concurrent initiative fields without retaining data across mutations or subscription events.
pub fn initiative_loader(
    context: InitiativeGraphqlContext,
    user: MacroUserIdStr<'static>,
) -> DataLoader<InitiativeLoader> {
    DataLoader::new(InitiativeLoader { context, user }, tokio::spawn)
}

async fn load_initiative(
    loader: &DataLoader<InitiativeLoader>,
    id: Uuid,
) -> async_graphql::Result<Arc<LoadedInitiative>> {
    match loader.load_one(id).await {
        Ok(Some(result)) => result,
        Ok(None) => Err(async_graphql::Error::new("initiative is unavailable")),
        Err(impossible) => match impossible {},
    }
}

/// Load authorized initiative details only when a detail field is requested.
pub async fn load_initiative_detail(
    ctx: &Context<'_>,
    id: Uuid,
) -> async_graphql::Result<Arc<InitiativeDetail>> {
    let loader = ctx.data::<DataLoader<InitiativeLoader>>()?;
    Ok(load_initiative(loader, id).await?.detail.clone())
}

/// Load task progress only when a count field is requested, from the same visible tasks as detail.
pub async fn load_initiative_summary(
    ctx: &Context<'_>,
    id: Uuid,
) -> async_graphql::Result<Arc<InitiativePageRow>> {
    let loader = ctx.data::<DataLoader<InitiativeLoader>>()?;
    let loaded = load_initiative(loader, id).await?;
    loaded
        .summary
        .get_or_try_init(|| async {
            loader
                .loader()
                .context
                .0
                .summarize(&loaded.read)
                .await
                .map(Arc::new)
                .map_err(graphql_error)
        })
        .await
        .cloned()
}
