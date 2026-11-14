//! Fresh CRM authority for retiring caches in an already-open client session.

use crate::api::context::{ApiContext, AuthorizationService};
use axum::{
    extract::{Request, State},
    middleware::Next,
    response::{IntoResponse, Response},
};
use axum_extra::extract::Cached;
use crm::domain::service::CrmService;
use macro_authorization::{AnyPrincipal, MacroAuthorization, OptionalMacroAuthorizationExtractor};

pub(crate) const HEADER: &str = "x-macro-crm-access";

#[tracing::instrument(skip_all, err)]
pub(crate) async fn handler(
    State(state): State<ApiContext>,
    Cached(auth): Cached<OptionalMacroAuthorizationExtractor<AuthorizationService, AnyPrincipal>>,
    request: Request,
    next: Next,
) -> Result<Response, crm::domain::model::CrmError> {
    let authority = if let Some(user) = auth
        .authorization
        .as_ref()
        .and_then(MacroAuthorization::acting_user)
    {
        Some(
            match state
                .crm_state
                .service
                .current_member_access(user.macro_user_id.as_ref())
                .await?
            {
                Some((team, allowed)) => {
                    format!("{team}:{}", if allowed { "allowed" } else { "denied" })
                }
                None => "none".to_owned(),
            },
        )
    } else {
        None
    };
    let mut response = next.run(request).await.into_response();
    if let Some(authority) = authority {
        // Only a UUID and fixed policy tokens are serialized into the header.
        response.headers_mut().insert(
            HEADER,
            authority.parse().expect("CRM authority is a valid header"),
        );
    }
    Ok(response)
}
