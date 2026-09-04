//! The single resolver: `Query.soup`.

use std::sync::Arc;

use async_graphql::{Context, Object};

use crate::listing::SoupLister;
use crate::schema::input::SoupQueryInput;
use crate::schema::output::SoupQueryPage;

/// Root query type. Named `Query` in the SDL.
pub(crate) struct Query;

#[Object]
impl Query {
    /// The user's unified inbox: one page of items they can access.
    async fn soup(
        &self,
        ctx: &Context<'_>,
        #[graphql(default)] input: SoupQueryInput,
    ) -> async_graphql::Result<SoupQueryPage> {
        let lister = ctx.data::<Arc<dyn SoupLister>>()?;
        let request = input.into_listing()?;
        let page = lister.list(request).await?;
        Ok(SoupQueryPage::from_listing(page))
    }
}
