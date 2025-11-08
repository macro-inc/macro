use crate::api::context::MacroApiTokenContext;
use axum::{
    Extension, Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Response},
};
use macro_auth::macro_api_token::EncodeMacroApiTokenArgs;
use model::user::UserContext;
use sqlx::PgPool;
use utoipa::ToSchema;

#[derive(serde::Serialize, serde::Deserialize, Debug, ToSchema)]
pub struct MacroApiTokenResponse {
    /// The newly created macro_api_token
    pub macro_api_token: String,
}

#[derive(serde::Serialize, serde::Deserialize, Debug)]
pub struct MacroApiTokenQuery {
    /// The email to generate the macro-api-token for
    pub email: Option<String>,
}

/// Generates a macro-api-token using the user's macro-access-token
/// You can either have your access token in the cookies or in the request
/// headers
/// Authorization: Bearer <access_token>
/// This returns a new macro-api-token
#[utoipa::path(
        get,
        operation_id = "macro_api_token",
        path = "/jwt/macro_api_token",
        params(
            ("email" = String, Query, description = "The email to generate the macro-api-token for. If not provided, we use your default profile."),
        ),
        responses(
            (status = 200, body = MacroApiTokenResponse),
            (status = 401, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(db, macro_api_token_context, user_context))]
pub async fn handler(
    State(db): State<PgPool>,
    State(macro_api_token_context): State<MacroApiTokenContext>,
    user_context: Extension<UserContext>,
    Query(query): Query<MacroApiTokenQuery>,
) -> Result<Response, Response> {
    let email = if let Some(email) = query.email.clone() {
        // TODO: figure out if email is url_encoded by default
        let email = urlencoding::decode(email.as_ref()).map_err(|e| {
            tracing::error!(error=?e, "unable to decode email");
            (StatusCode::BAD_REQUEST, "unable to decode email").into_response()
        })?;

        email.to_string()
    } else if user_context.user_id.is_empty() {
        tracing::error!("user_id is empty");
        return Err((StatusCode::UNAUTHORIZED, "unauthorized").into_response());
    } else {
        user_context.user_id.replace("macro|", "")
    };

    let user_profile =
        macro_db_client::user::get::get_user_profile_by_fusionauth_user_id_and_email(
            &db,
            &user_context.fusion_user_id,
            &email,
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to get user profile by fusionauth user id and email");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to get user profile by fusionauth user id and email",
            )
                .into_response()
        })?;

    let (macro_user_id, organization_id) =
        if let Some((macro_user_id, organization_id)) = user_profile {
            (macro_user_id, organization_id)
        } else {
            tracing::error!("macro user id is none");
            return Err((StatusCode::UNAUTHORIZED, "no access to this profile").into_response());
        };

    let macro_api_token =
        macro_auth::macro_api_token::encode_macro_api_token(EncodeMacroApiTokenArgs {
            macro_user_id,
            fusionauth_id: user_context.fusion_user_id.clone(),
            organization_id, // TOOD: get from user profile
            issuer: macro_api_token_context.issuer.to_string(),
            private_key: macro_api_token_context
                .macro_api_token_private_key
                .as_ref()
                .to_string(),
        })
        .map_err(|e| {
            tracing::error!(error=?e, "unable to encode macro-api-token");
            (
                StatusCode::INTERNAL_SERVER_ERROR,
                "unable to encode macro-api-token",
            )
                .into_response()
        })?;

    Ok((
        StatusCode::OK,
        Json(MacroApiTokenResponse { macro_api_token }),
    )
        .into_response())
}
