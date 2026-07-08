use crate::api::{
    context::ApiContext,
    link::gmail::GMAIL_IDENTITY_PROVIDER_NAME,
    oauth2::{OAuthState, format_redirect_uri},
    utils::{
        create_access_token_cookie, create_refresh_token_cookie, default_redirect_url,
        generate_session_code,
    },
};
use axum::{
    Json,
    response::{IntoResponse, Redirect, Response},
};
use email::domain::ports::{FirstInboxProvisionOutcome, FirstInboxProvisioner};
use macro_env::Environment;
use model::response::ErrorResponse;
use reqwest::StatusCode;
use tower_cookies::Cookies;

/// Provisions the user's primary inbox after a Gmail-scoped login, the moment
/// the Google grant is minted or refreshed. Fire-and-forget so the login
/// redirect is never delayed. Init is idempotent and recurs on every login, so
/// a lost attempt only delays provisioning until the next one.
fn spawn_first_inbox_provision(ctx: &ApiContext, identity_provider_id: &str, access_token: &str) {
    let auth_client = ctx.auth_client.clone();
    let email_service_client = ctx.email_service_client.clone();
    let identity_provider_id = identity_provider_id.to_string();
    let access_token = access_token.to_string();

    tokio::spawn(async move {
        let gmail_idp_id = match auth_client
            .get_identity_provider_id_by_name(GMAIL_IDENTITY_PROVIDER_NAME)
            .await
        {
            Ok(id) => id,
            Err(e) => {
                tracing::warn!(error=?e, "first-inbox provision: unable to resolve gmail idp id");
                return;
            }
        };

        if identity_provider_id != gmail_idp_id {
            return;
        }

        match email_service_client
            .provision_first_inbox(&access_token)
            .await
        {
            Ok(FirstInboxProvisionOutcome::Provisioned) => {
                tracing::info!("first-inbox provision: inbox initialized on login");
            }
            Ok(FirstInboxProvisionOutcome::Skipped) => {}
            Err(e) => {
                tracing::warn!(error=?e, "first-inbox provision: init failed");
            }
        }
    });
}

/// Handles logging in through an identity provider
pub(in crate::api::oauth2) async fn handler(
    ctx: &ApiContext,
    cookies: Cookies,
    code: &str,
    provider: &str,
    state: &OAuthState,
) -> Result<Response, Response> {
    let environment = Environment::new_or_prod();

    // No link_id was provided, login the user through fusionauth
    let (access_token, refresh_token) = ctx
        .auth_client
        .complete_identity_provider_login(
            &state.identity_provider_id,
            code,
            &format_redirect_uri(provider),
            false, // no_link set to false means the user will be automatically created/linked by fusionauth depending on how we have the identity provider setup
        )
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "unable to complete identity provider login");
            StatusCode::INTERNAL_SERVER_ERROR.into_response()
        })?;

    // generate a session code if we are on mobile
    let session_code = if let Some(is_mobile) = state.is_mobile {
        if is_mobile {
            Some(generate_session_code())
        } else {
            None
        }
    } else {
        None
    };

    // Create base redirect url
    let mut url = if let Some(original_url) = &state.original_url {
        let url = urlencoding::decode(original_url).map_err(|e| {
            tracing::error!(error=?e, "unable to decode original url");
            (
                StatusCode::BAD_REQUEST,
                Json(ErrorResponse {
                    message: "unable to decode original url".into(),
                }),
            )
                .into_response()
        })?;

        url.parse()
            .inspect_err(|e| tracing::error!(error=?e, "unable to parse string to url"))
            .map_err(|_| {
                (
                    StatusCode::BAD_REQUEST,
                    Json(ErrorResponse {
                        message: "unable to parse to original url".into(),
                    }),
                )
                    .into_response()
            })?
    } else {
        default_redirect_url()
    };

    if let Some(session_code) = session_code {
        // Strip any existing token params from the URL before appending the new one
        let filtered: Vec<(String, String)> = url
            .query_pairs()
            .filter(|(k, _)| k != "token")
            .map(|(k, v)| (k.into_owned(), v.into_owned()))
            .collect();
        url.query_pairs_mut().clear().extend_pairs(filtered);
        url.query_pairs_mut().append_pair("token", &session_code);

        ctx.macro_cache_client
            .set_mobile_login_session(&session_code, &refresh_token)
            .await
            .map_err(|e| {
                tracing::error!(error=?e, "unable to set mobile login session");
                (
                    StatusCode::INTERNAL_SERVER_ERROR,
                    Json(ErrorResponse {
                        message: "unable to store session code".into(),
                    }),
                )
                    .into_response()
            })?;

        tracing::trace!("session code provided, updating redirect url");
    }

    // Set cookies
    cookies.add(create_access_token_cookie(&access_token));
    cookies.add(create_refresh_token_cookie(&refresh_token));

    spawn_first_inbox_provision(ctx, &state.identity_provider_id, &access_token);

    match environment {
        Environment::Local => Ok(StatusCode::OK.into_response()), // We don't really care about redirect in local
        Environment::Production | Environment::Develop => {
            Ok(Redirect::to(url.as_str()).into_response())
        }
    }
}
