use axum::{
    Json, Router,
    extract::{self, State},
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use entity_access::domain::models::{
    Entity, EntityAccessReceipt, EntityPermission, EntityType, MemberTeamRole, TeamRole,
};
use fusionauth::error::FusionAuthClientError;
use macro_middleware::tracking::ClientIp;
use macro_user_id::{email::Email, lowercased::Lowercase, user_id::MacroUserIdStr};
use model::{
    authentication::login::response::SsoRequiredResponse,
    response::ErrorResponse,
};
use thiserror::Error;
use tower::ServiceBuilder;
use utoipa::ToSchema;

use teams::domain::team_repo::TeamService;

use crate::{
    api::{context::ApiContext, middleware, utils::default_redirect_url},
    generate_password::generate_random_password,
};

const MAX_TEAM_NAME_LEN: usize = 80;
const MAX_INVITES: usize = 8;
const WORKSPACE_ACCENTS: [&str; 6] = [
    "#e8e2db", "#b8a1ed", "#f77d67", "#f4c65c", "#65d8ac", "#7abde5",
];

#[derive(Debug, Error)]
pub enum MobileWorkspaceError {
    #[error("Invalid email address")]
    InvalidEmail,
    #[error("Invalid team name")]
    InvalidTeamName,
    #[error("Invalid workspace color")]
    InvalidAccent,
    #[error("Invalid teammate email")]
    InvalidInvite,
    #[error("Too many teammates")]
    TooManyInvites,
    #[error("Use a Google Workspace work email")]
    NotWorkspaceEmail,
    #[error("Email is blocked")]
    EmailBlocked,
    #[error("signup is not allowed")]
    SignupDenied,
    #[error("Internal error")]
    Internal(#[from] anyhow::Error),
}

impl IntoResponse for MobileWorkspaceError {
    fn into_response(self) -> Response {
        let status = match &self {
            MobileWorkspaceError::InvalidEmail
            | MobileWorkspaceError::InvalidTeamName
            | MobileWorkspaceError::InvalidAccent
            | MobileWorkspaceError::InvalidInvite
            | MobileWorkspaceError::TooManyInvites
            | MobileWorkspaceError::NotWorkspaceEmail => StatusCode::BAD_REQUEST,
            MobileWorkspaceError::EmailBlocked | MobileWorkspaceError::SignupDenied => {
                StatusCode::FORBIDDEN
            }
            MobileWorkspaceError::Internal(_) => StatusCode::INTERNAL_SERVER_ERROR,
        };
        (
            status,
            Json(ErrorResponse {
                message: self.to_string().into(),
            }),
        )
            .into_response()
    }
}

#[derive(Debug, serde::Deserialize, serde::Serialize, ToSchema)]
pub struct CreateMobileWorkspaceRequest {
    /// The visitor's email. This becomes the team owner. No session is issued.
    pub email: String,
    /// Workspace name, matching desktop onboarding.
    pub team_name: String,
    /// One of the onboarding accent colors, `#` plus six hex digits.
    pub accent: Option<String>,
    /// Teammate emails to invite. The owner's address is ignored.
    #[serde(default)]
    pub invites: Vec<String>,
}

#[derive(Debug, serde::Serialize, ToSchema)]
pub struct CreateMobileWorkspaceResponse {
    /// Whether a team was created on this request. False when they already own one.
    pub created: bool,
}

struct NormalizedWorkspace {
    email: String,
    team_name: String,
    accent: Option<String>,
    invites: Vec<String>,
}

pub fn router(state: ApiContext) -> Router<ApiContext> {
    Router::new().route(
        "/mobile-workspace",
        post(handler).layer(
            ServiceBuilder::new().layer(axum::middleware::from_fn_with_state(
                state,
                middleware::rate_limit::mobile_welcome_email::handler,
            )),
        ),
    )
}

/// Creates a team for a Meta in-app visitor and emails a desktop login link.
///
/// The browser that calls this is not signed in. A Google-required domain
/// with no account gets `202` and an email that opens Gmail connect on a
/// computer. This browser never starts Google.
#[utoipa::path(
    post,
    path = "/mobile-workspace",
    operation_id = "create_mobile_workspace",
    request_body = CreateMobileWorkspaceRequest,
    responses(
        (status = 200, body = CreateMobileWorkspaceResponse),
        (status = 202, body = SsoRequiredResponse),
        (status = 400, body = ErrorResponse),
        (status = 403, body = ErrorResponse),
        (status = 429, body = ErrorResponse),
        (status = 500, body = ErrorResponse),
    )
)]
#[tracing::instrument(skip(ctx, req), fields(email = %req.email), err)]
pub async fn handler(
    State(ctx): State<ApiContext>,
    ip_context: ClientIp,
    extract::Json(req): extract::Json<CreateMobileWorkspaceRequest>,
) -> Result<Response, MobileWorkspaceError> {
    let normalized = normalize_mobile_workspace(&req)?;
    ensure_email_allowed(&ctx, &normalized.email).await?;
    crate::api::google_workspace_email::ensure_google_workspace_email(&normalized.email)
        .await
        .map_err(|error| match error {
            crate::api::google_workspace_email::WorkspaceEmailError::NotWorkspace => {
                MobileWorkspaceError::NotWorkspaceEmail
            }
            crate::api::google_workspace_email::WorkspaceEmailError::Lookup(error) => {
                tracing::warn!(?error, "unable to verify workspace email");
                MobileWorkspaceError::Internal(error)
            }
        })?;

    let idp_id = match ctx
        .auth_client
        .lookup_identity_provider(&normalized.email)
        .await
    {
        Ok(idp) => idp,
        Err(error) => {
            tracing::error!(?error, "unable to lookup identity providers");
            return Err(MobileWorkspaceError::Internal(error.into()));
        }
    };

    let user_exists = match ctx.auth_client.get_user_id_by_email(&normalized.email).await {
        Ok(_) => true,
        Err(FusionAuthClientError::UserDoesNotExist) => false,
        Err(error) => {
            tracing::error!(?error, "unable to look up user");
            return Err(MobileWorkspaceError::Internal(error.into()));
        }
    };

    if !user_exists {
        if let Some(idp_id) = idp_id.clone() {
            send_desktop_link(
                &ctx,
                &normalized.email,
                &normalized.team_name,
                normalized.accent.as_deref(),
                false,
            )
            .await?;
            return Ok((
                StatusCode::ACCEPTED,
                Json(SsoRequiredResponse { idp_id }),
            )
                .into_response());
        }

        ctx.signup_policy
            .authorize_public_email(&normalized.email)
            .map_err(|denial| {
                tracing::warn!(?denial, "signup policy denied mobile workspace");
                MobileWorkspaceError::SignupDenied
            })?;

        ctx.auth_client
            .create_user(
                fusionauth::user::create::User {
                    email: (&normalized.email).into(),
                    password: generate_random_password().into(),
                    username: None,
                },
                true,
                ip_context.origin_ip(),
            )
            .await
            .map_err(|error| {
                tracing::error!(?error, "unable to create user");
                MobileWorkspaceError::Internal(error.into())
            })?;
    }

    let user_id = MacroUserIdStr::try_from_email(&normalized.email)
        .map_err(|_| MobileWorkspaceError::InvalidEmail)?;
    let created = ensure_owned_team(&ctx, &user_id, &normalized.team_name).await?;
    invite_teammates(&ctx, &user_id, &created.team_id, &normalized.invites).await?;
    send_desktop_link(
        &ctx,
        &normalized.email,
        &normalized.team_name,
        normalized.accent.as_deref(),
        true,
    )
    .await?;

    ctx.loops_client
        .send_event(
            &normalized.email,
            "mobile_lead_captured",
            &serde_json::json!({
                "signupStage": "lead",
                "hasAccount": true,
                "source": "meta-mobile-workspace",
            }),
            Some(&format!("meta-workspace-{}", normalized.email)),
        )
        .await
        .inspect_err(|error| tracing::error!(?error, "unable to record mobile workspace lead"))
        .ok();

    Ok((
        StatusCode::OK,
        Json(CreateMobileWorkspaceResponse {
            created: created.created,
        }),
    )
        .into_response())
}

struct OwnedTeam {
    team_id: String,
    created: bool,
}

async fn ensure_owned_team(
    ctx: &ApiContext,
    user_id: &MacroUserIdStr<'_>,
    team_name: &str,
) -> Result<OwnedTeam, MobileWorkspaceError> {
    let teams = ctx
        .teams_service
        .get_user_teams(user_id)
        .await
        .map_err(|error| MobileWorkspaceError::Internal(error.into()))?;
    if let Some(team) = teams
        .iter()
        .find(|team| team.owner_id() == user_id.as_ref())
    {
        return Ok(OwnedTeam {
            team_id: team.id().to_string(),
            created: false,
        });
    }

    let subscription_id = ctx
        .teams_service
        .is_user_premium(user_id)
        .await
        .map_err(|error| MobileWorkspaceError::Internal(error.into()))?;
    let team = ctx
        .teams_service
        .create_team(user_id, team_name, subscription_id.as_ref())
        .await
        .map_err(|error| match error {
            teams::domain::model::CreateTeamError::InvalidTeamName(_) => {
                MobileWorkspaceError::InvalidTeamName
            }
            other => MobileWorkspaceError::Internal(other.into()),
        })?;
    Ok(OwnedTeam {
        team_id: team.id().to_string(),
        created: true,
    })
}

async fn invite_teammates(
    ctx: &ApiContext,
    user_id: &MacroUserIdStr<'_>,
    team_id: &str,
    invites: &[String],
) -> Result<(), MobileWorkspaceError> {
    if invites.is_empty() {
        return Ok(());
    }
    let parsed: Vec<Email<Lowercase<'_>>> = invites
        .iter()
        .map(|address| {
            Email::parse_from_str(address)
                .map(|email| email.lowercase())
                .map_err(|_| MobileWorkspaceError::InvalidInvite)
        })
        .collect::<Result<_, _>>()?;
    let invites = non_empty::NonEmpty::new(parsed.as_slice())
        .map_err(|_| MobileWorkspaceError::InvalidInvite)?;
    let receipt = EntityAccessReceipt::<MemberTeamRole>::try_new_authenticated_user(
        user_id.clone(),
        Entity {
            entity_id: team_id.to_string(),
            entity_type: EntityType::Team,
        },
        EntityPermission::TeamRole {
            role: TeamRole::Owner,
        },
    )
    .map_err(|error| MobileWorkspaceError::Internal(anyhow::anyhow!(error.to_string())))?;
    ctx.teams_service
        .invite_users_to_team(receipt, invites)
        .await
        .map_err(|error| MobileWorkspaceError::Internal(error.into()))?;
    Ok(())
}

async fn send_desktop_link(
    ctx: &ApiContext,
    email: &str,
    team_name: &str,
    accent: Option<&str>,
    team_created: bool,
) -> Result<(), MobileWorkspaceError> {
    let url = desktop_signup_url(&default_redirect_url(), accent);
    let (subject, content) = desktop_signup_message(team_name, &url, team_created);
    ctx.ses_client
        .send_email("auth@macro.com", email, subject, &content)
        .await
        .map_err(|error| {
            tracing::error!(?error, "unable to send desktop workspace email");
            MobileWorkspaceError::Internal(error.into())
        })?;
    Ok(())
}

/// Signup page on the computer, carrying the workspace color when one was chosen.
fn desktop_signup_url(base: &url::Url, accent: Option<&str>) -> String {
    let mut url = base.clone();
    let path = url.path().trim_end_matches('/').to_string();
    let signup_path = if path.is_empty() || path == "/" {
        "/app/signup".to_string()
    } else if path.ends_with("/signup") {
        path
    } else {
        format!("{path}/signup")
    };
    url.set_path(&signup_path);
    url.set_query(None);
    if let Some(accent) = accent {
        url.query_pairs_mut().append_pair("accent", accent);
    }
    url.to_string()
}

fn desktop_signup_message(team_name: &str, url: &str, team_created: bool) -> (&'static str, String) {
    let subject = "Finish onboarding on your computer";
    let safe_name = escape_html(team_name);
    let safe_url = escape_html(url);
    let intro = if team_created {
        format!(
            "{safe_name} is ready. Open Macro on your computer to finish signing up and connect Gmail."
        )
    } else {
        "Open Macro on your computer to finish signing up and connect Gmail.".to_string()
    };
    let html = format!(
        r#"<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="x-apple-disable-message-reformatting" />
    <meta name="color-scheme" content="light" />
    <meta name="supported-color-schemes" content="light" />
    <title>{subject}</title>
  </head>
  <body style="margin:0;padding:0;width:100%;background-color:#f5f5f4;">
    <div style="display:none;max-height:0;overflow:hidden;opacity:0;mso-hide:all;">
      {intro}
    </div>
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" bgcolor="#f5f5f4" style="font-family:Arial,Helvetica,sans-serif;color:#222222;">
      <tr>
        <td align="center" style="padding:48px 20px;">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;">
            <tr>
              <td bgcolor="#ffffff" style="padding:36px 40px 40px;border:1px solid #e7e7e5;border-radius:12px;">
                <a href="https://macro.com" style="text-decoration:none;">
                  <img src="https://macro.com/app/macro-email-logo.png" width="36" height="36" alt="Macro" style="display:block;border:0;background-color:#ffffff;" />
                </a>
                <h1 style="margin:36px 0 16px;font-size:28px;line-height:36px;font-weight:600;letter-spacing:-0.5px;color:#222222;">Finish onboarding on your computer</h1>
                <p style="margin:0 0 20px;font-size:16px;line-height:26px;color:#525252;">{intro}</p>
                <table role="presentation" cellpadding="0" cellspacing="0" style="margin:28px 0 8px;">
                  <tr>
                    <td bgcolor="#222222" style="border-radius:6px;text-align:center;">
                      <a href="{safe_url}" style="display:inline-block;padding:14px 24px;border:1px solid #222222;border-radius:6px;color:#ffffff;background-color:#222222;font-size:15px;line-height:20px;font-weight:600;text-decoration:none;">Finish onboarding on your computer</a>
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
</html>"#
    );
    (subject, html)
}

async fn ensure_email_allowed(ctx: &ApiContext, email: &str) -> Result<(), MobileWorkspaceError> {
    let owned = email.to_string();
    let alias = email_validator::remove_email_alias(email)
        .map(|value| value.into_owned())
        .unwrap_or_else(|| owned.clone());
    let blocked = macro_db_client::blocked_email::get_blocked_emails(&ctx.db, &[&owned, &alias])
        .await
        .map_err(|error| MobileWorkspaceError::Internal(error.into()))?;
    if blocked.is_empty() {
        Ok(())
    } else {
        Err(MobileWorkspaceError::EmailBlocked)
    }
}

fn escape_html(value: &str) -> String {
    value
        .replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

fn normalize_mobile_workspace(
    req: &CreateMobileWorkspaceRequest,
) -> Result<NormalizedWorkspace, MobileWorkspaceError> {
    if !email_validator::is_valid_email(&req.email) {
        return Err(MobileWorkspaceError::InvalidEmail);
    }
    let email = req.email.trim().to_lowercase();
    let team_name = req.team_name.trim();
    if team_name.is_empty() || team_name.chars().count() > MAX_TEAM_NAME_LEN {
        return Err(MobileWorkspaceError::InvalidTeamName);
    }
    let accent = match req.accent.as_deref().map(str::trim).filter(|value| !value.is_empty()) {
        None => None,
        Some(value) => {
            let lower = value.to_lowercase();
            if !WORKSPACE_ACCENTS.contains(&lower.as_str()) {
                return Err(MobileWorkspaceError::InvalidAccent);
            }
            Some(lower)
        }
    };
    if req.invites.len() > MAX_INVITES {
        return Err(MobileWorkspaceError::TooManyInvites);
    }
    let mut invites = Vec::new();
    for invite in &req.invites {
        let address = invite.trim().to_lowercase();
        if address.is_empty() {
            continue;
        }
        if !email_validator::is_valid_email(&address) {
            return Err(MobileWorkspaceError::InvalidInvite);
        }
        if address == email || invites.contains(&address) {
            continue;
        }
        invites.push(address);
    }
    Ok(NormalizedWorkspace {
        email,
        team_name: team_name.to_string(),
        accent,
        invites,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    fn request(email: &str, name: &str) -> CreateMobileWorkspaceRequest {
        CreateMobileWorkspaceRequest {
            email: email.into(),
            team_name: name.into(),
            accent: Some("#65d8ac".into()),
            invites: vec!["Teammate@Acme.com".into(), "owner@acme.com".into()],
        }
    }

    #[test]
    fn normalize_keeps_a_palette_color_and_drops_the_owner() {
        let normalized = normalize_mobile_workspace(&request("Owner@Acme.com", " Acme ")).unwrap();
        assert_eq!(normalized.email, "owner@acme.com");
        assert_eq!(normalized.team_name, "Acme");
        assert_eq!(normalized.accent.as_deref(), Some("#65d8ac"));
        assert_eq!(normalized.invites, vec!["teammate@acme.com".to_string()]);
    }

    #[test]
    fn signup_link_opens_desktop_signup_with_the_accent() {
        let base = url::Url::parse("https://macro.com/app").unwrap();
        assert_eq!(
            desktop_signup_url(&base, Some("#65d8ac")),
            "https://macro.com/app/signup?accent=%2365d8ac"
        );
        let local = url::Url::parse("http://localhost:3000/").unwrap();
        assert_eq!(
            desktop_signup_url(&local, None),
            "http://localhost:3000/app/signup"
        );
    }

    #[test]
    fn desktop_email_asks_them_to_sign_up_on_the_computer() {
        let (subject, html) = desktop_signup_message(
            "Acme & Co",
            "https://macro.com/app/signup?accent=%2365d8ac",
            true,
        );
        assert_eq!(subject, "Finish onboarding on your computer");
        assert!(html.contains("Finish onboarding on your computer"));
        assert!(html.contains("Acme &amp; Co is ready."));
        assert!(html.contains("https://macro.com/app/signup?accent=%2365d8ac"));
        assert!(!html.to_lowercase().contains("code"));
        let (subject, html) = desktop_signup_message("Acme", "https://macro.com/app/signup", false);
        assert_eq!(subject, "Finish onboarding on your computer");
        assert!(html.contains("Finish onboarding on your computer"));
        assert!(!html.contains("Acme is ready"));
    }

    #[test]
    fn normalize_rejects_an_unknown_color_and_a_blank_name() {
        let mut colored = request("a@acme.com", "Acme");
        colored.accent = Some("#000000".into());
        assert!(matches!(
            normalize_mobile_workspace(&colored),
            Err(MobileWorkspaceError::InvalidAccent)
        ));
        assert!(matches!(
            normalize_mobile_workspace(&request("a@acme.com", "  ")),
            Err(MobileWorkspaceError::InvalidTeamName)
        ));
    }
}
