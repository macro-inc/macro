#[cfg(test)]
mod test;

use async_graphql::Context;
use axum::extract::FromRef;
use axum_extra::extract::Cached;
use macro_authorization::{
    MacroAuthorizationService, MacroAuthorizationState, OptionalMacroAuthorizationExtractor,
};
use macro_user_id::user_id::MacroUserIdStr;

use crate::extract_part;

/// Extract the authorized caller (reusing the `Cached` entry primed by the
/// mounting HTTP handler) and require an authenticated user.
pub async fn require_authorized_user<Auth, St>(
    ctx: &Context<'_>,
) -> async_graphql::Result<MacroUserIdStr<'static>>
where
    Auth: MacroAuthorizationService,
    MacroAuthorizationState<Auth>: FromRef<St>,
    St: Clone + Send + Sync + 'static,
{
    let Cached(authorization) =
        extract_part::<Cached<OptionalMacroAuthorizationExtractor<Auth>>, St>(ctx).await?;

    authorization
        .macro_user_id
        .ok_or_else(|| async_graphql::Error::new("authentication required"))
}
