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

/// Authenticated user inserted directly into a GraphQL request or connection context.
#[derive(Clone, Debug)]
pub struct GraphqlAuthorizedUser(MacroUserIdStr<'static>);

impl GraphqlAuthorizedUser {
    /// Creates an authenticated GraphQL user context value.
    pub fn new(user_id: MacroUserIdStr<'static>) -> Self {
        Self(user_id)
    }

    /// Returns the authenticated user's id.
    pub fn user_id(&self) -> &MacroUserIdStr<'static> {
        &self.0
    }
}

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
    if let Some(authorization) = ctx.data_opt::<GraphqlAuthorizedUser>() {
        return Ok(authorization.user_id().clone());
    }

    let Cached(authorization) =
        extract_part::<Cached<OptionalMacroAuthorizationExtractor<Auth>>, St>(ctx).await?;

    authorization
        .macro_user_id
        .ok_or_else(|| async_graphql::Error::new("authentication required"))
}
