//! Viewer-scoped time tracking reads.

use async_graphql::Context;
use graphql_soup::SoupEntityEdges;
use macro_user_id::user_id::MacroUserIdStr;

use crate::{GraphqlTimeTracking, TimeTrackingGraphqlContext, graphql_error};

/// The authenticated viewer's running timer and the server's clock.
#[tracing::instrument(skip_all, err(Debug))]
pub async fn resolve_time_tracking<E: SoupEntityEdges>(
    ctx: &Context<'_>,
    user_id: &MacroUserIdStr<'static>,
) -> async_graphql::Result<GraphqlTimeTracking<E>> {
    let state = ctx
        .data::<TimeTrackingGraphqlContext>()?
        .0
        .timer(user_id.clone())
        .await
        .map_err(graphql_error)?;
    Ok(GraphqlTimeTracking::new(user_id.clone(), state))
}
