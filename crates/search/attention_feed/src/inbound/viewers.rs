//! The viewer a feed request is evaluated as.

use std::sync::Arc;

use entity_access::{
    domain::{
        models::{EntityAccessReceipt, MemberTeamRole},
        ports::EntityAccessService,
    },
    inbound::axum_extractors::user_team_receipt,
};
use futures::future::BoxFuture;
use macro_user_id::user_id::MacroUserIdStr;

use crate::domain::models::FeedViewer;

/// Resolves the team access a feed request is evaluated with. Requests and
/// subscriptions alike only carry the authenticated user, so the team
/// receipt is minted from it at the entity access boundary.
pub trait FeedViewerResolver: Send + Sync + 'static {
    /// The user's qualifying team receipt, if any.
    fn team(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> BoxFuture<'_, Result<Option<EntityAccessReceipt<MemberTeamRole>>, rootcause::Report>>;
}

/// Mints viewer team receipts through the entity access service.
pub struct EntityAccessFeedViewers<S>(pub Arc<S>);

impl<S> FeedViewerResolver for EntityAccessFeedViewers<S>
where
    S: EntityAccessService,
{
    fn team(
        &self,
        user: MacroUserIdStr<'static>,
    ) -> BoxFuture<'_, Result<Option<EntityAccessReceipt<MemberTeamRole>>, rootcause::Report>> {
        Box::pin(async move {
            user_team_receipt::<MemberTeamRole, S>(self.0.as_ref(), user)
                .await
                .map_err(|error| rootcause::report!("failed to resolve team access: {error}"))
        })
    }
}

/// The viewer `user` is evaluated as, with their team receipt.
pub async fn resolve_viewer(
    viewers: &dyn FeedViewerResolver,
    user: MacroUserIdStr<'static>,
) -> Result<FeedViewer, rootcause::Report> {
    let team = viewers.team(user.clone()).await?;
    Ok(FeedViewer { user, team })
}
