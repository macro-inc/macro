use crate::api::context::ApiContext;
use axum::{
    Json,
    extract::{Query, State},
    http::StatusCode,
    response::{IntoResponse, Redirect, Response},
};
use model::response::ErrorResponse;
use serde_utils::urlencode::UrlEncoded;
use url::Url;
use utoipa::ToSchema;

#[cfg(test)]
mod tests;

#[derive(serde::Serialize, serde::Deserialize, ToSchema, Debug, Default)]
pub struct SsoState {
    #[schema(value_type = Option<String>)]
    pub original_url: Option<Url>,
    pub is_mobile: bool,
}

#[derive(Debug, serde::Deserialize)]
pub(crate) struct LoginQueryParams {
    idp_name: Option<String>,
    idp_id: Option<String>,
    login_hint: Option<String>,
    /// Once the frontend is update to NOT 2x urlencode this then this should be changed to
    /// `Option<Url>`
    original_url: Option<UrlEncoded<Url>>,
    #[serde(default)]
    is_mobile: bool,
}

/// Initiates an SSO login
#[utoipa::path(
        get,
        path = "/login/sso",
        operation_id = "sso_login",
        params(
            ("idp_name" = String, Query, description = "The name of the identity provider to use for login. e.g Google"),
            ("idp_id" = String, Query, description = "**OPTIONAL**. The idp id of the identity provider to use for login."),
            ("login_hint" = String, Query, description = "**OPTIONAL**. The user's email."),
            ("original_url" = String, Query, description = "**OPTIONAL**. The original url you came from."),
            ("is_mobile" = String, Query, description = "**OPTIONAL**. If the authentication request is from a mobile device."),
        ),
        responses(
            (status = 200),
            (status = 400, body=ErrorResponse),
            (status = 500, body=ErrorResponse),
        )
    )]
#[tracing::instrument(skip(ctx))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    query: Query<LoginQueryParams>,
) -> Result<Response, Response> {
    let Query(LoginQueryParams {
        idp_name,
        idp_id,
        login_hint,
        original_url,
        is_mobile,
    }) = query;

    if idp_name.is_none() && idp_id.is_none() {
        tracing::error!("idp_name and idp_id are both missing");
        return Err((
            StatusCode::BAD_REQUEST,
            Json(ErrorResponse {
                message: "idp_name or idp_id need to be provided",
            }),
        )
            .into_response());
    }

    let idp_id = if let Some(idp_id) = idp_id {
        if idp_id.is_empty() {
            tracing::error!("idp_id is empty");
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "provided idp_id is empty",
                }),
            )
                .into_response());
        }

        idp_id.clone()
    } else {
        let idp_name = idp_name.unwrap_or_default();

        if idp_name.is_empty() {
            tracing::error!("idp_name is empty");
            return Err((
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "provided idp_name is empty",
                }),
            )
                .into_response());
        }

        let sso_idp_id = ctx
            .auth_client
            .get_identity_provider_id_by_name(&idp_name)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to find idp id");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to find idp from idp_name",
                    }),
                )
                    .into_response()
            })?;

        tracing::trace!(sso_idp_id, "idp found from name");

        sso_idp_id
    };

    let state = SsoState {
        is_mobile,
        original_url: original_url.map(|x| x.0),
    };

    // Only include state if it has a value
    let sso_state = (state.is_mobile || state.original_url.is_some()).then_some(state);

    // Generate code
    let sso_url = ctx
        .auth_client
        .construct_oauth2_authorize_url(&idp_id, login_hint.as_deref(), sso_state)
        .map_err(|e| {
            tracing::error!(error=?e, "unable to construct oauth2 authorize url");
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "unable to serialize state into string",
                }),
            )
                .into_response()
        })?;

    tracing::info!(sso_url=%sso_url, "SSO URL");

    Ok(Redirect::temporary(&sso_url).into_response())
}
