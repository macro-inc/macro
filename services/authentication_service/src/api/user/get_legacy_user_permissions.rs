use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_middleware::user_permissions::attach_user_permissions::PermissionsExtractor;
use macro_user_id::user_id::MacroUserId;
use roles_and_permissions::domain::model::PermissionId;

use crate::api::context::ApiContext;

use model::response::ErrorResponse;
use model::user::UserContext;

#[derive(serde::Serialize, Debug, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct GetLegacyUserPermissionsResponse {
    /// The user id
    user_id: String,
    /// The permissions the user has
    permissions: Vec<String>,
    /// The user's email
    email: String,
    /// The user's name
    name: Option<String>,
    /// The user's license status
    license_status: String,
    /// Whether the user has completed the tutorial
    tutorial_complete: bool,
    /// The user's group
    group: Option<ABGroup>,
    /// Whether the user has the chrome extension
    has_chrome_ext: bool,
    /// Whether the user has trialed through stripe
    has_trialed: bool,
    /// Whether the user has consented to AI data sharing
    ai_data_consent: bool,
    /// The referral code for the user
    referral_code: String,
}

#[derive(serde::Serialize, Debug, utoipa::ToSchema)]
enum ABGroup {
    A,
    B,
}

impl IntoResponse for GetLegacyUserPermissionsResponse {
    fn into_response(self) -> Response {
        Json(self).into_response()
    }
}

#[derive(thiserror::Error, Debug)]
pub enum GetLegacyUserPermissionsError {
    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
    #[error("Invalid macro user id")]
    InvalidMacroUserId,
}

impl IntoResponse for GetLegacyUserPermissionsError {
    fn into_response(self) -> Response {
        match self {
            GetLegacyUserPermissionsError::InternalError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal error".into(),
                }),
            ),
            GetLegacyUserPermissionsError::InvalidMacroUserId => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid user id".into(),
                }),
            ),
        }
        .into_response()
    }
}

/// Gets the calling user's info which matches what was given in the **deprecated**
/// getUserPermissions query in our graphql api.
/// This will eventually be removed and optimized to use smaller calls that grab
/// what is needed for various parts of the UI.
#[utoipa::path(
        get,
        path = "/user/legacy_user_permissions",
        operation_id = "get_legacy_user_permissions",
        responses(
            (status = 200, body=GetLegacyUserPermissionsResponse),
            (status = 401, body=String),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx, user_context, permissions), err, fields(user_id=%user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
    PermissionsExtractor(permissions): PermissionsExtractor,
) -> Result<GetLegacyUserPermissionsResponse, GetLegacyUserPermissionsError> {
    let user_id = MacroUserId::parse_from_str(&user_context.user_id)
        .map_err(|_| GetLegacyUserPermissionsError::InvalidMacroUserId)?
        .lowercase();

    let email = user_id.email_part().lowercase();

    let legacy_user_info = macro_db_client::user::get::get_legacy_user_info(&ctx.db, &user_id)
        .await
        .map_err(GetLegacyUserPermissionsError::InternalError)?;

    let license_status =
        if permissions.contains(&PermissionId::ReadProfessionalFeatures.to_string()) {
            // If the user has premium permission their license status is active
            "active"
        } else {
            // By default, we can be lazy and just say they are inactive
            // If the requirements change, we will need to update this to actually check the user's
            // stripe subscription if present
            "inactive"
        };

    Ok(GetLegacyUserPermissionsResponse {
        user_id: user_id.as_ref().to_string(),
        email: email.as_ref().to_string(),
        permissions: permissions.into_iter().collect(),
        name: legacy_user_info.name,
        license_status: license_status.to_string(),
        tutorial_complete: legacy_user_info.tutorial_complete,
        group: match legacy_user_info.group.as_deref() {
            Some("A" | "a") => Some(ABGroup::A),
            Some("B" | "b") => Some(ABGroup::B),
            _ => None,
        },
        has_chrome_ext: legacy_user_info.has_chrome_ext,
        has_trialed: legacy_user_info.has_trialed,
        ai_data_consent: legacy_user_info.ai_data_consent,
        referral_code: legacy_user_info.referral_code,
    })
}
