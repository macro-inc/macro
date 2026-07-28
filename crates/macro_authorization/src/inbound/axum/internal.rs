use ::axum::{
    extract::FromRef,
    http::{HeaderMap, request::Parts},
};
use rootcause::Report;

use crate::{
    InternalIdentityClaims, MacroAuthorization, MacroAuthorizationError, MacroAuthorizationService,
};

use super::{MacroAuthorizationRejection, MacroAuthorizationState, authenticated_user, rejection};

/// Header carrying the shared key for standard internal service authorization.
pub const INTERNAL_API_KEY_HEADER: &str = "x-internal-auth-key";
/// Header carrying the acting Macro user ID for standard internal authorization.
pub const INTERNAL_MACRO_USER_ID_HEADER: &str = "x-internal-macro-user-id";
/// Header carrying the acting organization ID for standard internal authorization.
pub const INTERNAL_MACRO_ORGANIZATION_ID_HEADER: &str = "x-internal-macro-organization-id";
/// Header carrying the acting FusionAuth user ID for standard internal authorization.
pub const INTERNAL_FUSIONAUTH_USER_ID_HEADER: &str = "x-internal-fusionauth-user-id";

/// Legacy DSS header carrying the internal service authorization key.
#[deprecated(note = "migrate callers to INTERNAL_API_KEY_HEADER")]
pub const LEGACY_DSS_INTERNAL_API_KEY_HEADER: &str = "x-document-storage-service-auth-key";
/// Legacy DSS header carrying the acting Macro user ID.
#[deprecated(note = "migrate callers to INTERNAL_MACRO_USER_ID_HEADER")]
pub const LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER: &str = "x-document-storage-service-user-id";

pub(super) struct InternalHeaderConvention {
    key_header: &'static str,
    user_id_header: &'static str,
    organization_id_header: Option<&'static str>,
    fusion_user_id_header: Option<&'static str>,
}

#[allow(deprecated)]
static INTERNAL_HEADER_CONVENTIONS: [InternalHeaderConvention; 2] = [
    InternalHeaderConvention {
        key_header: INTERNAL_API_KEY_HEADER,
        user_id_header: INTERNAL_MACRO_USER_ID_HEADER,
        organization_id_header: Some(INTERNAL_MACRO_ORGANIZATION_ID_HEADER),
        fusion_user_id_header: Some(INTERNAL_FUSIONAUTH_USER_ID_HEADER),
    },
    InternalHeaderConvention {
        key_header: LEGACY_DSS_INTERNAL_API_KEY_HEADER,
        user_id_header: LEGACY_DSS_INTERNAL_MACRO_USER_ID_HEADER,
        organization_id_header: None,
        fusion_user_id_header: None,
    },
];

pub(super) async fn authorize_internal_request<S, Svc>(
    parts: &Parts,
    state: &S,
    convention: &InternalHeaderConvention,
) -> Result<Option<MacroAuthorization>, MacroAuthorizationRejection>
where
    MacroAuthorizationState<Svc>: FromRef<S>,
    Svc: MacroAuthorizationService,
    S: Send + Sync + 'static,
{
    let provided_key = parts
        .headers
        .get(convention.key_header)
        .and_then(|header| header.to_str().ok())
        .ok_or_else(|| rejection("unauthorized"))?;
    let claims = internal_identity_claims(&parts.headers, convention);
    let authorization = MacroAuthorizationState::<Svc>::from_ref(state);
    let user_context = authorization
        .service
        .authorize_internal(provided_key, claims)
        .await
        .map_err(internal_authorization_rejection)?;
    let acting_user = user_context.map(authenticated_user).transpose()?;

    Ok(Some(MacroAuthorization::Internal(acting_user)))
}

pub(super) fn internal_header_convention(headers: &HeaderMap) -> Option<&InternalHeaderConvention> {
    INTERNAL_HEADER_CONVENTIONS
        .iter()
        .find(|convention| headers.contains_key(convention.key_header))
}

fn internal_identity_claims(
    headers: &HeaderMap,
    convention: &InternalHeaderConvention,
) -> InternalIdentityClaims {
    InternalIdentityClaims {
        user_id: header_string(headers, Some(convention.user_id_header)),
        fusion_user_id: header_string(headers, convention.fusion_user_id_header),
        organization_id: header_string(headers, convention.organization_id_header)
            .and_then(|organization_id| organization_id.parse().ok()),
    }
}

fn header_string(headers: &HeaderMap, name: Option<&str>) -> Option<String> {
    name.and_then(|name| headers.get(name))
        .and_then(|header| header.to_str().ok())
        .map(str::to_owned)
}

fn internal_authorization_rejection(
    error: Report<MacroAuthorizationError>,
) -> MacroAuthorizationRejection {
    tracing::error!(error=?error.current_context(), "internal authorization failed");
    rejection("unauthorized")
}
