use axum::{
    Extension, Json,
    extract::State,
    http::StatusCode,
    response::{IntoResponse, Response},
};

use crate::api::context::ApiContext;

use model::response::ErrorResponse;
use model::user::UserContext;

#[derive(Debug, serde::Serialize, utoipa::ToSchema)]
#[serde(rename_all = "camelCase")]
pub struct UserOrganizationResponse {
    /// The id of the organization
    pub organization_id: i32,
    /// The name of the organization
    pub organization_name: String,
}

#[derive(thiserror::Error, Debug)]
pub enum UserOrganizationError {
    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for UserOrganizationError {
    fn into_response(self) -> Response {
        match self {
            UserOrganizationError::InternalError(_) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "internal error",
                }),
            ),
        }
        .into_response()
    }
}

pub enum GetUserOrganizationResponse {
    /// The user is not part of an organization
    NoOrganization,
    /// The user is part of an organization
    Organization(UserOrganizationResponse),
}

impl IntoResponse for GetUserOrganizationResponse {
    fn into_response(self) -> Response {
        match self {
            GetUserOrganizationResponse::NoOrganization => StatusCode::NO_CONTENT.into_response(),
            GetUserOrganizationResponse::Organization(organization) => {
                Json(organization).into_response()
            }
        }
    }
}

/// Retrieves the users organization if present.
/// Returns NO_CONTENT if the user is a not part of an organization.
#[utoipa::path(
        get,
        path = "/user/organization",
        operation_id = "get_user_organization",
        responses(
            (status = 200, body=UserOrganizationResponse),
            (status = 204),
            (status = 401, body=String),
            (status = 500, body=ErrorResponse),
        ),
    )]
#[tracing::instrument(skip(ctx, user_context), err, fields(user_id=?user_context.user_id))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    user_context: Extension<UserContext>,
) -> Result<GetUserOrganizationResponse, UserOrganizationError> {
    let organization_id = if let Some(organization_id) = user_context.organization_id {
        organization_id
    } else {
        return Ok(GetUserOrganizationResponse::NoOrganization);
    };

    let organization_name =
        macro_db_client::organization::get::organization::get_organization_name(
            &ctx.db,
            organization_id,
        )
        .await
        .map_err(UserOrganizationError::InternalError)?;

    Ok(GetUserOrganizationResponse::Organization(
        UserOrganizationResponse {
            organization_id,
            organization_name,
        },
    ))
}
