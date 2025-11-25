use axum::{
    Extension, RequestPartsExt,
    extract::{FromRequestParts, rejection::ExtensionRejection},
    http::{StatusCode, request::Parts},
    response::IntoResponse,
};
use macro_user_id::{cowlike::CowLike, error::ParseErr, user_id::MacroUserIdStr};
use thiserror::Error;

use crate::UserContext;

#[derive(Debug, Error)]
pub enum UserExtractorErr {
    #[error("Internal server error")]
    AxumExtensionErr(#[from] ExtensionRejection),
    #[error("The user context was empty")]
    UserContextEmpty,
    #[error("Invalid macro user id: {0}")]
    InvalidId(#[from] ParseErr),
}

impl IntoResponse for UserExtractorErr {
    fn into_response(self) -> axum::response::Response {
        let msg = self.to_string();
        (StatusCode::UNAUTHORIZED, msg).into_response()
    }
}

#[non_exhaustive]
pub struct MacroUserExtractor {
    pub macro_user_id: MacroUserIdStr<'static>,
    pub user_context: UserContext,
}

#[axum::async_trait]
impl<S> FromRequestParts<S> for MacroUserExtractor
where
    S: Send + Sync,
{
    type Rejection = UserExtractorErr;

    /// Perform the extraction.
    async fn from_request_parts(parts: &mut Parts, state: &S) -> Result<Self, Self::Rejection> {
        let ext: Extension<UserContext> = parts.extract_with_state(state).await?;
        if ext.0.user_id.is_empty() {
            return Err(UserExtractorErr::UserContextEmpty);
        }

        let macro_user_id =
            MacroUserIdStr::parse_from_str(&ext.0.user_id).map(CowLike::into_owned)?;

        Ok(MacroUserExtractor {
            macro_user_id,
            user_context: ext.0,
        })
    }
}
