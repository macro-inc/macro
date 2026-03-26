use anyhow::Context;
use axum::{
    Json,
    response::{Html, IntoResponse, Response},
};
use github::domain::{models::GithubError, ports::GithubLinkService};
use macro_user_id::{cowlike::CowLike, user_id::MacroUserId};
use model::response::ErrorResponse;
use tower_cookies::Cookies;

use crate::api::{
    context::ApiContext,
    oauth2::{
        OAuthState, format_redirect_uri,
        login::{self},
    },
};

/// Error type for Github Link operations
#[derive(thiserror::Error, Debug)]
pub enum GithubLinkError {
    /// Internal error
    #[error("internal error occurred")]
    InternalError(#[from] anyhow::Error),
    /// Internal github error
    #[error("internal error occurred")]
    GithubServiceError(#[from] GithubError),
}

impl IntoResponse for GithubLinkError {
    fn into_response(self) -> Response {
        Json(ErrorResponse {
            message: self.to_string().into(),
        })
        .into_response()
    }
}

/// Success response for Github OAuth handler
pub enum GithubOAuthSuccess {
    /// HTML response for account linking flow
    Html(Html<&'static str>),
    /// Response for login flow (redirect or status)
    Login(Response),
}

impl IntoResponse for GithubOAuthSuccess {
    fn into_response(self) -> Response {
        match self {
            GithubOAuthSuccess::Html(html) => html.into_response(),
            GithubOAuthSuccess::Login(response) => response,
        }
    }
}

/// Links the users github to an existing fusionauth account
#[tracing::instrument(skip(ctx), err)]
async fn link_user(
    ctx: &ApiContext,
    link_id: &uuid::Uuid,
    code: &str,
) -> Result<(), GithubLinkError> {
    let fusionauth_user_id =
        macro_db_client::in_progress_user_link::get_macro_user_id_by_link_id(&ctx.db, link_id)
            .await?;

    // SAFETY: we don't support multi-profile at this time but we do need to support the method for
    // fetching
    let macro_user_id = macro_db_client::user::get::get_user_profiles_by_fusionauth_user_id(
        &ctx.db,
        &fusionauth_user_id.to_string(),
    )
    .await?;

    let macro_user_id = macro_user_id.first().context("expected user profile")?;

    let macro_user_id = MacroUserId::parse_from_str(macro_user_id)
        .map(|id| id.into_owned().lowercase())
        .context("valid macro user id")?;

    ctx.github_link_service
        .link_user(
            &macro_user_id,
            &fusionauth_user_id,
            link_id,
            &format_redirect_uri("github"),
            code,
        )
        .await?;

    Ok(())
}

pub(in crate::api::oauth2) async fn handler(
    ctx: &ApiContext,
    cookies: Cookies,
    code: &str,
    state: &OAuthState,
) -> Result<GithubOAuthSuccess, GithubLinkError> {
    // if the link id is provided, this user is already logged in to an account. therefore, we
    // don't need to handle completing the login through fusionauth
    if let Some(link_id) = state.link_id.as_ref() {
        link_user(ctx, link_id, code).await?;

        // Return HTML that notifies the opener window and closes the popup
        let html = Html(
            r#"
            <!DOCTYPE html>
            <html>
            <head><title>Github Connected</title></head>
            <body>
                <script>
                    console.log('OAuth callback received');
                    if (window.opener) {
                        console.log('Sending message to opener window');
                        window.opener.postMessage({ type: 'github-linked', success: true }, '*');
                        console.log('Message sent, closing in 500ms');
                        setTimeout(() => {
                            window.close();
                        }, 500);
                    } else {
                        console.log('No opener window found');
                        window.close();
                    }
                </script>
                <p>Github account connected successfully. This window will close automatically...</p>
            </body>
            </html>
        "#,
        );
        return Ok(GithubOAuthSuccess::Html(html));
    }

    // The user does not need a link, complete the standard idp login
    tracing::trace!("no link provided handling login normally");

    let response = login::handler(ctx, cookies, code, "github", state)
        .await
        .map_err(|_response| {
            GithubLinkError::InternalError(anyhow::anyhow!("login handler failed"))
        })?;

    Ok(GithubOAuthSuccess::Login(response))
}
