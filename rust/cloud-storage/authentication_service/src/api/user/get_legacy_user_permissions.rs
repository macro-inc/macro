use std::str::FromStr;

use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};
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
    group: Option<String>,
    /// Whether the user has the chrome extension
    has_chrome_ext: bool,
    /// Whether the user has trialed through stripe
    has_trialed: bool,
}

#[derive(thiserror::Error, Debug)]
pub enum GetLegacyUserPermissionsError {
    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
    #[error("Stripe error")]
    StripeError,
    #[error("Invalid macro user id")]
    InvalidMacroUserId,
}

impl IntoResponse for GetLegacyUserPermissionsError {
    fn into_response(self) -> Response {
        match self {
            GetLegacyUserPermissionsError::InternalError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal error",
                }),
            ),
            GetLegacyUserPermissionsError::StripeError => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "stripe error",
                }),
            ),
            GetLegacyUserPermissionsError::InvalidMacroUserId => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "invalid user id",
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
#[tracing::instrument(skip(ctx, user_context), err, fields(user_id=%user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<Json<GetLegacyUserPermissionsResponse>, GetLegacyUserPermissionsError> {
    let user_id = MacroUserId::parse_from_str(&user_context.user_id)
        .map_err(|_| GetLegacyUserPermissionsError::InvalidMacroUserId)?
        .lowercase();

    let email = user_id.email_part().lowercase();

    let permissions: Vec<String> = if let Some(permissions) = user_context.permissions.as_ref() {
        permissions.iter().cloned().collect()
    } else {
        vec![]
    };

    let legacy_user_info = macro_db_client::user::get::get_legacy_user_info(&ctx.db, &user_id)
        .await
        .map_err(GetLegacyUserPermissionsError::InternalError)?;

    let license_status = if user_context.organization_id.is_some() {
        // organizations default to active license status
        "active"
    } else if let Some(permissions) = user_context.permissions.as_ref() {
        // If the user has premium permission their license status is active
        if permissions.contains(&PermissionId::ReadProfessionalFeatures.to_string()) {
            "active"
        } else {
            // By default, we can be lazy and just say they are inactive
            // If the requirements change, we will need to update this to actually check the user's
            // stripe subscription if present
            "inactive"
        }
    } else {
        // The user is not part of an organization and has no stripe customer id
        // They do not have a license
        "inactive"
    };

    let has_trialed = if let Some(stripe_customer_id) = legacy_user_info.stripe_customer_id.as_ref()
    {
        let customer_id = stripe::CustomerId::from_str(stripe_customer_id)
            .map_err(|_| GetLegacyUserPermissionsError::StripeError)?;
        // Get the user's stripe metadata and check if they have trialed
        let customer = stripe::Customer::retrieve(&ctx.stripe_client, &customer_id, &[])
            .await
            .map_err(|_| GetLegacyUserPermissionsError::StripeError)?;

        customer
            .metadata
            .map(|m| m.contains_key("has_trialed"))
            .unwrap_or(false)
    } else {
        false
    };

    Ok(Json(GetLegacyUserPermissionsResponse {
        user_id: user_id.as_ref().to_string(),
        email: email.as_ref().to_string(),
        permissions,
        name: legacy_user_info.name,
        license_status: license_status.to_string(),
        tutorial_complete: legacy_user_info.tutorial_complete,
        group: legacy_user_info.group,
        has_chrome_ext: legacy_user_info.has_chrome_ext,
        has_trialed,
    }))
}
