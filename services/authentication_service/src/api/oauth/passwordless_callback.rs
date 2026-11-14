use axum::{
    Json,
    extract::{Path, Query, State},
    http::StatusCode,
    response::{IntoResponse, Redirect, Response},
};
use std::collections::HashMap;
use tower_cookies::Cookies;

use crate::api::{
    context::ApiContext,
    utils::{
        append_signed_up_param_if_new_user, create_access_token_cookie, create_refresh_token_cookie,
    },
};
use crate::service::user::team_auto_join::join_team_by_email_domain;
use fusionauth::error::FusionAuthClientError;
use macro_user_id::user_id::MacroUserId;
use referral::domain::{models::ReferralCode, ports::ReferralService};

use model::response::{ErrorResponse, UserTokensResponse};

#[derive(serde::Deserialize)]
pub struct Params {
    pub code: String,
}

/// Handles oauth redirect
#[utoipa::path(
        get,
        path = "/oauth/passwordless/{code}",
        operation_id = "passwordless_callback",
        params(
            ("code" = String, Path, description = "Code"),
            ("email" = String, Query, description = "Email"),
        ),
        responses(
            (status = 200, body = UserTokensResponse),
            (status = 400, body=String),
            (status = 401, body=String),
            (status = 500, body=String),
        )
    )]
// The path holds the one-time login code and the query the email address;
// keep both out of the span.
#[tracing::instrument(skip_all)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    cookies: Cookies,
    Path(Params { code }): Path<Params>,
    Query(params): Query<HashMap<String, String>>,
) -> Result<Response, Response> {
    let disable_redirect = if let Some(disable_redirect) = params.get("disable_redirect") {
        disable_redirect == "true"
    } else {
        false
    };

    // validate email matches code
    let raw_email = params
        .get("email")
        .ok_or((StatusCode::BAD_REQUEST, "email required").into_response())?;

    let email = urlencoding::decode(raw_email).map_err(|e| {
        tracing::error!(error=?e, "unable to decode email");
        (StatusCode::BAD_REQUEST, "unable to decode email").into_response()
    })?;

    let passwordless_code = ctx
        .macro_cache_client
        .get_passwordless_login_code(&email)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, email=%email, "unable to get passwordless login code");
            (StatusCode::UNAUTHORIZED, "no passwordless login found").into_response()
        })?;

    if passwordless_code != code {
        return Err((StatusCode::UNAUTHORIZED, "invalid code").into_response());
    }

    let passwordless_response = ctx
        .auth_client
        .complete_passwordless_login(&code)
        .await
        .map_err(|e| {
            tracing::error!(error=?e, "complete_passwordless_login: unable to complete passwordless login");
            match e {
                FusionAuthClientError::IncorrectCode => (
                    StatusCode::UNAUTHORIZED,
                    Json(ErrorResponse {
                        message: "invalid code".into(),
                    }),
                )
                    .into_response(),
                _ => StatusCode::INTERNAL_SERVER_ERROR.into_response(),
            }
        })?;

    // Ensure that the user email matches what email we associated with the code
    // Only perform this check if the email param was not provided
    if !params.contains_key("email") {
        tracing::trace!("no email param provided, performing additional verification");
        let email = passwordless_response.user.email.to_lowercase();
        let passwordless_code = ctx.macro_cache_client.get_passwordless_login_code(&email).await.map_err(|e| {
            tracing::error!(error=?e, email=%passwordless_response.user.email, "unable to get passwordless login code");
            (StatusCode::INTERNAL_SERVER_ERROR, "unable to get passwordless login code").into_response()
        })?;

        if code != passwordless_code {
            tracing::error!("passwordless code does not match");
            return Err((StatusCode::UNAUTHORIZED, "invalid code").into_response());
        }
    }

    cookies.add(create_access_token_cookie(&passwordless_response.token));
    cookies.add(create_refresh_token_cookie(
        &passwordless_response.refresh_token,
    ));

    // The code proved the address: run the onboarding a passwordless signup
    // deferred until now. Awaited so a shutdown can't drop it mid-flight.
    complete_pending_passwordless_signup(
        ctx.clone(),
        passwordless_response.user.email.to_lowercase(),
    )
    .await;

    // remove the users passwordless login rate limits
    tokio::spawn({
        let macro_cache_client = ctx.macro_cache_client.clone();
        let email = passwordless_response.user.email.clone();
        async move {
            let _ = macro_cache_client
                .delete_passwordless_rate_limit(&email)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "unable to delete passwordless rate limit");
                });

            let _ = macro_cache_client
                .delete_passwordless_daily_rate_limit(&email)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "unable to delete passwordless daily rate limit");
                });

            let _ = macro_cache_client
                .delete_code_rate_limit(&email)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "unable to delete login code rate limit");
                });

            let _ = macro_cache_client
                .delete_daily_code_rate_limit(&email)
                .await
                .inspect_err(|e| {
                    tracing::error!(error=?e, "unable to delete login code daily rate limit");
                });
        }
    });

    if disable_redirect {
        return Ok((
            StatusCode::OK,
            Json(UserTokensResponse {
                access_token: passwordless_response.token,
                refresh_token: passwordless_response.refresh_token,
            }),
        )
            .into_response());
    }

    let mut redirect_uri = passwordless_response.state.redirect_uri.clone();
    match url::Url::parse(&redirect_uri) {
        Ok(mut url) => {
            append_signed_up_param_if_new_user(
                &ctx.macro_cache_client,
                &passwordless_response.user.email.to_lowercase(),
                &mut url,
            )
            .await;
            redirect_uri = url.to_string();
        }
        Err(e) => {
            tracing::error!(error=?e, "unable to parse redirect uri for signup attribution");
        }
    }

    Ok(Redirect::to(&redirect_uri).into_response())
}

/// Runs the onboarding a passwordless signup deferred until a sign-in proved
/// its address: domain team auto-join and referral credit. Only the first
/// completed sign-in finds the pending marker, so this runs at most once.
#[tracing::instrument(skip(ctx, email))]
async fn complete_pending_passwordless_signup(ctx: ApiContext, email: String) {
    let pending = match ctx
        .macro_cache_client
        .take_passwordless_signup_pending(&email)
        .await
    {
        Ok(Some(pending)) => pending,
        Ok(None) => return,
        Err(e) => {
            tracing::error!(error=?e, "unable to read pending passwordless signup");
            return;
        }
    };
    tracing::info!(
        has_referral_code = pending.referral_code.is_some(),
        "completing deferred passwordless signup onboarding"
    );

    let user_id = format!("macro|{email}");
    join_team_by_email_domain(ctx.teams_service.as_ref(), &user_id).await;

    if let Some(referral_code) = pending.referral_code {
        let referred_user_id = match MacroUserId::parse_from_str(&user_id) {
            Ok(user_id) => user_id.lowercase(),
            Err(e) => {
                tracing::error!(error=?e, "unable to parse user id for referral");
                return;
            }
        };
        let _ = ctx
            .referral_service
            .track_referral(&referred_user_id, &ReferralCode(referral_code))
            .await
            .inspect_err(|e| tracing::error!(error=?e, "unable to track referral for new user"));
    }
}
