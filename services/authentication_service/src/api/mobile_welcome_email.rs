use axum::{
    Json, Router,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use model::response::ErrorResponse;
use thiserror::Error;
use tower::ServiceBuilder;
use utoipa::ToSchema;

use crate::api::{context::ApiContext, middleware, utils::default_redirect_url};

const DESKTOP_EMAIL_SUBJECT: &str = "Continue onboarding on desktop";

#[derive(Debug, Error)]
pub enum SendMobileWelcomeEmailError {
    #[error("Invalid email address")]
    InvalidEmail,

    #[error("Email is blocked")]
    EmailBlocked,

    #[error("Please use your work email")]
    PersonalEmail,

    #[error("Internal error")]
    InternalError(#[from] anyhow::Error),
}

impl IntoResponse for SendMobileWelcomeEmailError {
    fn into_response(self) -> Response {
        let status_code = match &self {
            SendMobileWelcomeEmailError::InvalidEmail
            | SendMobileWelcomeEmailError::EmailBlocked
            | SendMobileWelcomeEmailError::PersonalEmail => StatusCode::BAD_REQUEST,
            SendMobileWelcomeEmailError::InternalError(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };

        (
            status_code,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

#[derive(Debug, serde::Deserialize, serde::Serialize, ToSchema)]
pub struct SendMobileWelcomeEmailRequest {
    /// The email address to send the welcome email to
    pub email: String,
}

#[derive(Debug, serde::Serialize, ToSchema)]
pub struct SendMobileWelcomeEmailResponse {
    /// Whether the lead was enrolled (false if they were already enrolled previously)
    pub sent: bool,
}

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new().route(
        "/mobile-welcome-email",
        post(handler).layer(
            ServiceBuilder::new().layer(axum::middleware::from_fn_with_state(
                state,
                middleware::rate_limit::mobile_welcome_email::handler,
            )),
        ),
    )
}

/// Emails a mobile lead a link to continue onboarding on desktop and enrolls
/// them in the Loops welcome sequence. No-ops if the address was already
/// captured, and rejects blocked addresses.
#[utoipa::path(
    post,
    path = "/mobile-welcome-email",
    operation_id = "send_mobile_welcome_email",
    responses(
        (status = 200, body = SendMobileWelcomeEmailResponse),
        (status = 400, body = ErrorResponse),
        (status = 429, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx), fields(email=%req.email), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    extract::Json(req): extract::Json<SendMobileWelcomeEmailRequest>,
) -> Result<Json<SendMobileWelcomeEmailResponse>, SendMobileWelcomeEmailError> {
    if !email_validator::is_valid_email(&req.email) {
        return Err(SendMobileWelcomeEmailError::InvalidEmail);
    }

    if is_personal_email(&req.email) {
        return Err(SendMobileWelcomeEmailError::PersonalEmail);
    }

    let lowercase_email = loops_client::normalize_email(&req.email);

    // Check if the email is blocked
    let blocked_emails =
        macro_db_client::blocked_email::get_blocked_emails(&ctx.db, &[&lowercase_email]).await?;

    if !blocked_emails.is_empty() {
        return Err(SendMobileWelcomeEmailError::EmailBlocked);
    }

    // Atomically claim the slot — returns false if the email was already sent
    let inserted =
        mobile_welcome_email_db_client::mobile_welcome_email::insert_mobile_welcome_email(
            &ctx.db,
            &lowercase_email,
        )
        .await?;

    if !inserted {
        return Ok(Json(SendMobileWelcomeEmailResponse { sent: false }));
    }

    // The "continue on desktop" link the phone confirmation screen promises.
    let url = desktop_signup_url(&default_redirect_url());
    if let Err(e) = ctx
        .ses_client
        .send_email(
            "auth@macro.com",
            req.email.trim(),
            DESKTOP_EMAIL_SUBJECT,
            &desktop_email_html(&url),
        )
        .await
    {
        tracing::error!(error=?e, "failed to send mobile desktop-link email");
        // Release the claim so a retry sends the email instead of no-oping.
        if let Err(release_err) =
            mobile_welcome_email_db_client::mobile_welcome_email::delete_mobile_welcome_email(
                &ctx.db,
                &lowercase_email,
            )
            .await
        {
            tracing::error!(error=?release_err, "failed to release mobile welcome email claim");
        }
        return Err(SendMobileWelcomeEmailError::InternalError(e));
    }

    // Enrolls the lead in the Loops welcome drip. Awaited rather than
    // fire-and-forget: `sent: true` tells the caller mail is on the way, so it
    // must not report success on a Loops failure. The key is namespaced by
    // event so it can't collide with the `user_registered` event sent when the
    // lead converts.
    ctx.loops_client
        .send_event(
            &lowercase_email,
            "mobile_lead_captured",
            // `hasAccount` is set explicitly rather than left unset: the
            // workflow's audience filter tests `isFalse`, which an absent
            // property would not satisfy.
            &serde_json::json!({
                "signupStage": "lead",
                "hasAccount": false,
                "source": "mobile-lead-capture",
            }),
            Some(&format!("mobile-lead-{lowercase_email}")),
        )
        .await
        .map_err(|e| SendMobileWelcomeEmailError::InternalError(e.into()))?;

    Ok(Json(SendMobileWelcomeEmailResponse { sent: true }))
}

fn is_personal_email(email: &str) -> bool {
    email
        .trim()
        .rsplit_once('@')
        .is_some_and(|(_, domain)| generic_email_domains::is_generic_email_domain(domain))
}

/// Desktop signup page. The local frontend origin has no `/app` prefix.
fn desktop_signup_url(base: &url::Url) -> String {
    let mut url = base.clone();
    let path = url.path().trim_end_matches('/').to_string();
    url.set_path(&format!("{path}/signup"));
    url.set_query(None);
    url.to_string()
}

fn desktop_email_html(url: &str) -> String {
    let url = url.replace('&', "&amp;").replace('"', "&quot;");
    format!(
        r##"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>{DESKTOP_EMAIL_SUBJECT}</title>
  </head>
  <body style="margin:0;padding:0;width:100%;background-color:#f5f5f4;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
      Open this link on desktop to finish signing up for Macro.
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f5f5f4" style="font-family:Arial,Helvetica,sans-serif;color:#222222;">
      <tr>
        <td align="center" style="padding:48px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
            <tr>
              <td bgcolor="#ffffff" style="padding:36px 40px 40px;border:1px solid #e7e7e5;border-radius:12px;">
                <a href="https://macro.com" style="text-decoration:none;">
                  <img src="https://macro.com/app/macro-email-icon.png" width="48" height="48" alt="Macro" style="display:block;border:0;" />
                </a>
                <h1 style="margin:36px 0 16px;font-size:28px;line-height:36px;font-weight:600;letter-spacing:-0.5px;color:#222222;">{DESKTOP_EMAIL_SUBJECT}</h1>
                <p style="margin:0 0 20px;font-size:16px;line-height:26px;color:#525252;">Macro is a better experience on desktop. Open this link to finish signing up — it only takes a minute.</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
                  <tr>
                    <td bgcolor="#222222" style="border-radius:6px;text-align:center;">
                      <a href="{url}" style="display:inline-block;padding:14px 24px;border:1px solid #222222;border-radius:6px;color:#ffffff;background-color:#222222;font-size:15px;line-height:20px;font-weight:600;text-decoration:none;">Continue on desktop</a>
                    </td>
                  </tr>
                </table>
                <p style="margin:28px 0 0;font-size:14px;line-height:22px;color:#737373;">If you didn't request this, you can safely ignore this email.</p>
              </td>
            </tr>
            <tr>
              <td style="padding:24px 16px 0;text-align:center;font-size:12px;line-height:20px;color:#737373;">
                Need a hand? <a href="mailto:support@macro.com" style="color:#525252;text-decoration:underline;">Contact support</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>"##
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn desktop_link_points_at_signup() {
        let prod = url::Url::parse("https://macro.com/app").unwrap();
        assert_eq!(desktop_signup_url(&prod), "https://macro.com/app/signup");
        let local = url::Url::parse("http://localhost:3000").unwrap();
        assert_eq!(desktop_signup_url(&local), "http://localhost:3000/signup");
    }

    #[test]
    fn desktop_email_links_to_signup() {
        let html = desktop_email_html("https://macro.com/app/signup");
        assert!(html.contains(r#"href="https://macro.com/app/signup""#));
        assert!(html.contains(DESKTOP_EMAIL_SUBJECT));
    }

    #[test]
    fn personal_email_providers_are_rejected() {
        assert!(is_personal_email("someone@gmail.com"));
        assert!(is_personal_email(" Someone@GMAIL.com "));
        assert!(is_personal_email("someone@icloud.com"));
        assert!(!is_personal_email("someone@macro.com"));
        assert!(!is_personal_email("someone@acme.co"));
    }
}
