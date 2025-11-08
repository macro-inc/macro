use crate::api::{
    context::ApiContext,
    login::sso::SsoState,
    utils::{
        create_access_token_cookie, create_refresh_token_cookie, default_redirect_url,
        generate_session_code,
    },
};
use axum::{
    Json,
    extract::{self, State},
    http::{HeaderValue, StatusCode},
    response::{IntoResponse, Response},
};
use maud::{DOCTYPE, Markup, html};
use model::response::ErrorResponse;
use reqwest::{Url, header::CONTENT_TYPE};
use serde::Deserialize;
use serde_utils::JsonEncoded;
use std::time::Duration;
use thiserror::Error;
use tokio::time::sleep;
use tower_cookies::Cookies;

#[cfg(test)]
mod tests;

#[derive(Debug, Deserialize)]
pub(crate) struct OAuthCbParams {
    code: String,
    state: Option<JsonEncoded<SsoState>>,
}

/// Handles oauth redirect
#[utoipa::path(
        get,
        path = "/oauth/redirect",
        operation_id = "oauth_redirect",
        responses(
            (status = 200),
            (status = 400, body=String),
            (status = 401, body=String),
            (status = 500, body=String),
        )
    )]
#[tracing::instrument(skip(ctx, cookies, params))]
pub async fn handler(
    State(ctx): State<ApiContext>,
    cookies: Cookies,
    extract::Query(params): extract::Query<OAuthCbParams>,
) -> Result<Response, Response> {
    // Perform the oauth code grant
    // NOTE: rust is so blazingly fast (super crazy, I know) that we actually need to sleep here temporarily
    // to ensure we give time for the oauth authorization code to be setup in the backend.
    // Obviously this is not ideal, but will work for now.
    sleep(Duration::from_millis(500)).await;

    let (access_token, refresh_token) = match ctx
        .auth_client
        .complete_authorization_code_grant(&params.code)
        .await
    {
        Ok(tokens) => tokens,
        Err(e) => {
            tracing::error!(error=?e, "unable to complete authorization code grant");
            return Err(StatusCode::INTERNAL_SERVER_ERROR.into_response());
        }
    };

    let write_db = async |code: &SessionCode| {
        ctx.macro_cache_client
            .set_mobile_login_session(code.0.as_str(), &refresh_token)
            .await
            .map_err(InnerErr::MacroCacheErr)
    };

    let redirect_url = get_redirect_url(params, write_db)
        .await
        .map_err(IntoResponse::into_response)?;

    tracing::trace!("redirect url {redirect_url}");

    // Set cookies
    cookies.add(create_access_token_cookie(&access_token));
    cookies.add(create_refresh_token_cookie(&refresh_token));

    Ok(html_redirect(&redirect_url).into_response())
}

#[derive(Debug, Error)]
enum InnerErr {
    #[error("{0}")]
    Serde(#[from] serde_json::Error),
    #[error("Macro Cache Err {0}")]
    MacroCacheErr(anyhow::Error),
    #[error("Failed to parse url {0}")]
    ParseErr(#[from] url::ParseError),
}

impl IntoResponse for InnerErr {
    fn into_response(self) -> Response {
        match self {
            InnerErr::Serde(_error) => (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "failed to deserialize input",
                }),
            )
                .into_response(),
            InnerErr::MacroCacheErr(_e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to store session code",
                }),
            )
                .into_response(),

            InnerErr::ParseErr(_e) => (
                StatusCode::INTERNAL_SERVER_ERROR,
                Json(ErrorResponse {
                    message: "unable to parse original url",
                }),
            )
                .into_response(),
        }
    }
}

/// unit struct just to denote in the type system that a given string is a session code
#[derive(Debug)]
struct SessionCode(String);

#[tracing::instrument(ret, err, skip(write_db))]
async fn get_redirect_url(
    params: OAuthCbParams,
    write_db: impl AsyncFnOnce(&SessionCode) -> Result<(), InnerErr>,
) -> Result<Url, InnerErr> {
    let Some(state) = params.state else {
        return Ok(default_redirect_url());
    };

    let state = state.decode()?;

    // Generate the session code if necessary
    let session_code = state.is_mobile.then(generate_session_code).map(SessionCode);
    let res = update_url_with_session_code(
        state.original_url.unwrap_or_else(default_redirect_url),
        session_code.as_ref(),
        write_db,
    )
    .await?;

    Ok(res)
}

/// given an input url, attaches a session code as a query param if required.
/// Side effect: write the code to db
#[tracing::instrument(ret, err, skip(write_db))]
async fn update_url_with_session_code(
    mut url: Url,
    session_code: Option<&SessionCode>,
    write_db: impl AsyncFnOnce(&SessionCode) -> Result<(), InnerErr>,
) -> Result<Url, InnerErr> {
    let Some(session_code) = session_code else {
        return Ok(url);
    };

    url.query_pairs_mut()
        .append_pair("session_code", &session_code.0);

    write_db(session_code).await?;

    Ok(url)
}

fn html_redirect_inner(url: &Url) -> Markup {
    html! {
        (DOCTYPE)
        html {
            head {
                meta charset="utf-8";
                title { "Redirect" }
                meta http-equiv="refresh" content=(format!("0;url={url}"));
            };
        };
    }
}

fn html_redirect(url: &Url) -> Response {
    let s = html_redirect_inner(url).0;

    // we can't use the html into_response bc it needs axum 0.8
    let headers = [(
        CONTENT_TYPE,
        HeaderValue::from_static("text/html; charset=utf-8"),
    )];
    (headers, s).into_response()
}
