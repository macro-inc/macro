//! Email sign-in as a resumable state machine: email → (CAPTCHA) → emailed
//! code → workspace → (two-factor) → token and `d` cookie.
//!
//! Every step takes the current [`LoginState`] by value and returns the next
//! one, so a login can hop between processes: the state (cookie jar
//! included) serializes with serde. It holds secrets; seal it before storing.
//! Ported from mautrix-slack's `login-email-api.go` / `login-email.go`.

mod http;

use std::time::Duration;

use serde::{Deserialize, Serialize};
use url::Url;

pub use http::CookieJar;
use http::LoginHttp;

use crate::credentials::{CookieToken, Secret, SessionCredentials, SessionToken};
use crate::endpoints::SlackEndpoints;
use crate::error::{SlackError, SlackErrorCode};
use crate::ids::TeamId;
use crate::method::SlackMethod;

#[cfg(test)]
mod test;

/// Where a login stands. Serialize it between steps; it holds secrets.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "step", rename_all = "snake_case")]
#[expect(
    clippy::large_enum_variant,
    reason = "one short-lived state per sign-in, serialized between steps"
)]
pub enum LoginState {
    /// Waiting for the email address.
    AwaitingEmail,
    /// Slack wants a CAPTCHA solved before it emails the code. Render the
    /// challenge for `site_key` on the sign-in page and submit the solution.
    AwaitingCaptcha {
        /// The email address.
        email: Secret,
        /// The CAPTCHA site key from `auth.captcha`.
        site_key: String,
        /// Slack's cookies so far.
        jar: CookieJar,
    },
    /// Slack emailed a six-character code.
    AwaitingEmailCode {
        /// The email address.
        email: Secret,
        /// Slack's cookies so far.
        jar: CookieJar,
    },
    /// The account belongs to several workspaces; pick one.
    ChoosingWorkspace {
        /// The workspaces, in Slack's order.
        workspaces: Vec<LoginWorkspace>,
        /// Slack's cookies so far.
        jar: CookieJar,
    },
    /// The workspace wants a two-factor code (app or SMS).
    AwaitingTwoFactor {
        /// The workspace.
        workspace: LoginWorkspace,
        /// Slack's cookies so far.
        jar: CookieJar,
    },
}

/// What the user supplies for the current step.
#[derive(Clone, Debug)]
pub enum LoginInput {
    /// For [`LoginState::AwaitingEmail`].
    Email(String),
    /// For [`LoginState::AwaitingCaptcha`]: the challenge's solution token.
    CaptchaSolution(Secret),
    /// For [`LoginState::AwaitingEmailCode`]: `ABC-123` or `abc123`.
    EmailCode(Secret),
    /// For [`LoginState::ChoosingWorkspace`].
    Workspace(TeamId),
    /// For [`LoginState::AwaitingTwoFactor`]: six digits.
    TwoFactorCode(Secret),
}

/// A workspace the account can sign in to.
#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize)]
pub struct LoginWorkspace {
    /// The workspace.
    pub team_id: TeamId,
    /// Name.
    pub name: String,
    /// `acme` in `acme.slack.com`.
    pub domain: Option<String>,
    /// Web URL.
    pub url: Option<Url>,
    /// Needs single sign-on in a browser.
    pub sso_required: bool,
    /// Needs a two-factor code.
    pub two_factor_required: bool,
    /// The workspace icon.
    #[serde(default)]
    pub icon_url: Option<String>,
    /// The Enterprise Grid org it belongs to, by name.
    #[serde(default)]
    pub enterprise_name: Option<String>,
    /// Single-use magic login code.
    magic_login_code: Option<Secret>,
    /// Single-use magic login link.
    magic_login_url: Option<Secret>,
}

/// What a step led to.
#[derive(Debug)]
pub enum LoginStep {
    /// Waiting for more input.
    Next(LoginState),
    /// This workspace can't sign in by email (SSO or no magic link); sign in
    /// in a browser at `sign_in_url` and capture the token and cookie there.
    BrowserRequired {
        /// The workspace.
        workspace: LoginWorkspace,
        /// Why.
        reason: BrowserReason,
        /// Where to sign in.
        sign_in_url: Url,
    },
    /// Signed in.
    Complete {
        /// The workspace.
        workspace: LoginWorkspace,
        /// The session. Validate it with [`crate::api::validate_session`].
        credentials: SessionCredentials,
    },
}

/// Why a workspace needs a browser.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum BrowserReason {
    /// The workspace enforces single sign-on.
    SsoRequired,
    /// Slack offered no email magic link for it, or wants an extra step.
    NoMagicLogin,
}

/// A step that didn't advance. Continue from `resume_from`: the same step
/// for retryable mistakes, an earlier one when the login must restart.
#[derive(Debug, thiserror::Error)]
#[error("slack login step failed: {kind}")]
pub struct LoginError {
    /// What went wrong.
    pub kind: LoginErrorKind,
    /// The state to continue from.
    pub resume_from: LoginState,
}

/// What went wrong in a login step.
#[derive(Debug, thiserror::Error)]
pub enum LoginErrorKind {
    /// The input doesn't belong to the current step.
    #[error("input does not match the current step")]
    WrongInput,
    /// Slack rejected the email address (or it is malformed).
    #[error("invalid email address")]
    InvalidEmail,
    /// Slack rejected the CAPTCHA solution; solve a new challenge.
    #[error("captcha rejected")]
    CaptchaRejected,
    /// The emailed code is wrong (or malformed).
    #[error("invalid email code")]
    InvalidCode,
    /// The emailed code expired; start again.
    #[error("email code expired")]
    CodeExpired,
    /// The account has no workspace that allows email sign-in.
    #[error("no workspaces")]
    NoWorkspaces,
    /// The chosen workspace isn't in the list.
    #[error("unknown workspace")]
    UnknownWorkspace,
    /// The two-factor code is wrong (or malformed).
    #[error("invalid two-factor code")]
    InvalidTwoFactorCode,
    /// The two-factor challenge expired; a new one was started.
    #[error("two-factor challenge expired")]
    TwoFactorExpired,
    /// Slack is rate limiting sign-in.
    #[error("rate limited")]
    RateLimited {
        /// Slack's `Retry-After`, when it sent one.
        retry_after: Option<Duration>,
    },
    /// Slack signed in but didn't hand out a token and `d` cookie.
    #[error("slack did not return a complete session")]
    SessionIncomplete,
    /// Any other Slack failure; retry the same step later.
    #[error(transparent)]
    Slack(SlackError),
}

#[derive(Deserialize)]
struct CheckEmail {
    #[serde(default)]
    challenge_response: bool,
}

#[derive(Deserialize)]
struct Captcha {
    sitekey: String,
}

#[derive(Deserialize)]
struct Acknowledged {}

#[derive(Deserialize)]
struct FoundWorkspaces {
    #[serde(default)]
    current_teams: Vec<WorkspaceGroup>,
    #[serde(default)]
    current_orgs: Vec<WorkspaceOrg>,
}

#[derive(Deserialize)]
struct WorkspaceGroup {
    #[serde(default)]
    teams: Vec<FoundWorkspace>,
}

#[derive(Deserialize)]
struct WorkspaceOrg {
    org: Option<FoundWorkspace>,
    #[serde(default)]
    teams: Vec<FoundWorkspace>,
}

#[derive(Deserialize)]
struct FoundWorkspace {
    id: TeamId,
    #[serde(default)]
    name: String,
    domain: Option<String>,
    url: Option<String>,
    magic_login_code: Option<String>,
    magic_login_url: Option<String>,
    #[serde(default)]
    sso_required: bool,
    #[serde(default)]
    two_factor_required: bool,
    #[serde(default)]
    icon: Option<crate::models::TeamIcon>,
}

#[derive(Deserialize)]
struct LoginMagic {
    token: Option<Secret>,
}

#[derive(Deserialize)]
struct MagicLoginBulk {
    #[serde(default)]
    token_results: std::collections::BTreeMap<String, MagicLoginResult>,
}

#[derive(Deserialize)]
struct MagicLoginResult {
    error: Option<SlackErrorCode>,
    auth_redir: Option<String>,
}

#[derive(Deserialize)]
struct AppAuth {
    #[serde(default)]
    teams: std::collections::BTreeMap<String, AppAuthTeam>,
}

#[derive(Deserialize)]
struct AppAuthTeam {
    token: Option<Secret>,
}

/// Drives email sign-in against Slack (or a fake).
pub struct EmailLogin {
    http: LoginHttp,
}

impl EmailLogin {
    /// A login client for `endpoints`.
    pub fn new(endpoints: SlackEndpoints) -> Result<Self, SlackError> {
        Ok(Self {
            http: LoginHttp::new(endpoints)?,
        })
    }

    /// Advances `state` with `input`.
    pub async fn step(
        &self,
        state: LoginState,
        input: LoginInput,
    ) -> Result<LoginStep, LoginError> {
        match (state, input) {
            (LoginState::AwaitingEmail, LoginInput::Email(email)) => self.submit_email(email).await,
            (
                LoginState::AwaitingCaptcha {
                    email,
                    site_key,
                    jar,
                },
                LoginInput::CaptchaSolution(solution),
            ) => self.submit_captcha(email, site_key, jar, solution).await,
            (LoginState::AwaitingEmailCode { email, jar }, LoginInput::EmailCode(code)) => {
                self.submit_code(email, jar, code).await
            }
            (LoginState::ChoosingWorkspace { workspaces, jar }, LoginInput::Workspace(team_id)) => {
                let Some(workspace) = workspaces
                    .iter()
                    .find(|workspace| workspace.team_id == team_id)
                    .cloned()
                else {
                    return Err(LoginError {
                        kind: LoginErrorKind::UnknownWorkspace,
                        resume_from: LoginState::ChoosingWorkspace { workspaces, jar },
                    });
                };
                let back = LoginState::ChoosingWorkspace {
                    workspaces,
                    jar: jar.clone(),
                };
                self.finish_workspace(workspace, jar, back).await
            }
            (LoginState::AwaitingTwoFactor { workspace, jar }, LoginInput::TwoFactorCode(code)) => {
                self.submit_two_factor(workspace, jar, code).await
            }
            (state, _) => Err(LoginError {
                kind: LoginErrorKind::WrongInput,
                resume_from: state,
            }),
        }
    }

    async fn submit_email(&self, email: String) -> Result<LoginStep, LoginError> {
        let email = Secret::new(email.trim().to_owned());
        if !lazy_regex::regex_is_match!(r"^[^@\s]+@[^@\s]+\.[^@\s]+$", email.expose()) {
            return Err(rejected(
                LoginErrorKind::InvalidEmail,
                LoginState::AwaitingEmail,
            ));
        }
        let mut jar = CookieJar::default();
        let checked: Result<CheckEmail, SlackError> = self
            .http
            .post_api(
                SlackMethod::SignupCheckEmail,
                None,
                &[("email", email.expose()), ("get_info", "undefined")],
                &mut jar,
            )
            .await;
        let needs_captcha = match checked {
            Ok(checked) => checked.challenge_response,
            Err(error) if error.code() == Some(&SlackErrorCode::CaptchaRequired) => true,
            Err(error) => {
                return Err(classify(
                    error,
                    LoginState::AwaitingEmail,
                    LoginState::AwaitingEmail,
                ));
            }
        };

        if needs_captcha {
            let captcha: Captcha = self
                .http
                .post_api(
                    SlackMethod::AuthCaptcha,
                    Some("fetch-auth-captcha-signin"),
                    &[],
                    &mut jar,
                )
                .await
                .map_err(|error| {
                    classify(error, LoginState::AwaitingEmail, LoginState::AwaitingEmail)
                })?;
            return Ok(LoginStep::Next(LoginState::AwaitingCaptcha {
                email,
                site_key: captcha.sitekey,
                jar,
            }));
        }

        self.confirm_email(&email, None, &mut jar)
            .await
            .map_err(|error| {
                classify(error, LoginState::AwaitingEmail, LoginState::AwaitingEmail)
            })?;
        Ok(LoginStep::Next(LoginState::AwaitingEmailCode {
            email,
            jar,
        }))
    }

    async fn submit_captcha(
        &self,
        email: Secret,
        site_key: String,
        mut jar: CookieJar,
        solution: Secret,
    ) -> Result<LoginStep, LoginError> {
        let outcome = self.confirm_email(&email, Some(&solution), &mut jar).await;
        match outcome {
            Ok(()) => Ok(LoginStep::Next(LoginState::AwaitingEmailCode {
                email,
                jar,
            })),
            Err(error) => {
                let same = LoginState::AwaitingCaptcha {
                    email,
                    site_key,
                    jar,
                };
                Err(classify(error, same, LoginState::AwaitingEmail))
            }
        }
    }

    async fn confirm_email(
        &self,
        email: &Secret,
        captcha: Option<&Secret>,
        jar: &mut CookieJar,
    ) -> Result<(), SlackError> {
        let mut fields = vec![
            ("email", email.expose()),
            ("locale", "en-US"),
            ("entry_point", "signin"),
        ];
        if let Some(captcha) = captcha {
            fields.push(("captcha_response", captcha.expose()));
        }
        self.http
            .post_api::<Acknowledged>(SlackMethod::SignupConfirmEmail, None, &fields, jar)
            .await
            .map(|_| ())
    }

    async fn submit_code(
        &self,
        email: Secret,
        mut jar: CookieJar,
        code: Secret,
    ) -> Result<LoginStep, LoginError> {
        let code = Secret::new(code.expose().trim().to_uppercase().replace('-', ""));
        if !lazy_regex::regex_is_match!(r"^[A-Z0-9]{6}$", code.expose()) {
            return Err(rejected(
                LoginErrorKind::InvalidCode,
                LoginState::AwaitingEmailCode { email, jar },
            ));
        }
        let confirmed = self
            .http
            .post_api::<Acknowledged>(
                SlackMethod::SigninConfirmCode,
                None,
                &[("email", email.expose()), ("code", code.expose())],
                &mut jar,
            )
            .await;
        let found = match confirmed {
            Ok(_) => {
                self.http
                    .post_api::<FoundWorkspaces>(
                        SlackMethod::SigninFindWorkspaces,
                        Some("get_started_workspaces"),
                        &[],
                        &mut jar,
                    )
                    .await
            }
            Err(error) => Err(error),
        };
        let found = match found {
            Ok(found) => found,
            Err(error) => {
                let same = LoginState::AwaitingEmailCode { email, jar };
                return Err(classify(error, same, LoginState::AwaitingEmail));
            }
        };

        let workspaces = flatten_workspaces(found);
        match workspaces.as_slice() {
            [] => Err(rejected(
                LoginErrorKind::NoWorkspaces,
                LoginState::AwaitingEmail,
            )),
            [only] => {
                let only = only.clone();
                self.finish_workspace(only, jar, LoginState::AwaitingEmail)
                    .await
            }
            _ => Ok(LoginStep::Next(LoginState::ChoosingWorkspace {
                workspaces,
                jar,
            })),
        }
    }

    /// Signs in to a chosen workspace, or says why it needs a browser or a
    /// two-factor code. `back` is where a failure resumes.
    async fn finish_workspace(
        &self,
        workspace: LoginWorkspace,
        mut jar: CookieJar,
        back: LoginState,
    ) -> Result<LoginStep, LoginError> {
        if workspace.sso_required {
            return Ok(self.browser_required(workspace, BrowserReason::SsoRequired));
        }
        if workspace.magic_login_code.is_none() && workspace.magic_login_url.is_none() {
            return Ok(self.browser_required(workspace, BrowserReason::NoMagicLogin));
        }
        if workspace.two_factor_required {
            return match self.start_two_factor(&workspace, &mut jar).await {
                Ok(()) => Ok(LoginStep::Next(LoginState::AwaitingTwoFactor {
                    workspace,
                    jar,
                })),
                Err(error) => Err(classify(error, back.clone(), back)),
            };
        }
        match self.login_workspace(&workspace, &mut jar).await {
            Ok(WorkspaceLogin::Signed(credentials)) => Ok(LoginStep::Complete {
                workspace,
                credentials,
            }),
            Ok(WorkspaceLogin::NeedsBrowser) => {
                Ok(self.browser_required(workspace, BrowserReason::NoMagicLogin))
            }
            Ok(WorkspaceLogin::Incomplete) => {
                Err(rejected(LoginErrorKind::SessionIncomplete, back))
            }
            Err(error) => Err(classify(error, back.clone(), back)),
        }
    }

    fn browser_required(&self, workspace: LoginWorkspace, reason: BrowserReason) -> LoginStep {
        let sign_in_url = workspace
            .url
            .clone()
            .filter(|url| self.http.is_trusted(url))
            .or_else(|| self.http.endpoints.slack.join("signin").ok())
            .unwrap_or_else(|| self.http.endpoints.slack.clone());
        LoginStep::BrowserRequired {
            workspace,
            reason,
            sign_in_url,
        }
    }

    /// `auth.loginMagic` without a PIN: Slack answers that it wants one and
    /// sends the SMS, if that's the user's method.
    async fn start_two_factor(
        &self,
        workspace: &LoginWorkspace,
        jar: &mut CookieJar,
    ) -> Result<(), SlackError> {
        let Some(magic) = &workspace.magic_login_code else {
            return Err(SlackError::Api {
                method: SlackMethod::AuthLoginMagic,
                code: SlackErrorCode::TwoFactorStateExpired,
            });
        };
        let outcome = self
            .http
            .post_api::<LoginMagic>(
                SlackMethod::AuthLoginMagic,
                None,
                &[
                    ("magic_token", magic.expose()),
                    ("two_factor_native_supported", "1"),
                    ("two_factor_is_backup", "0"),
                ],
                jar,
            )
            .await;
        match outcome {
            Ok(_) => Ok(()),
            Err(error) if error.code().is_some_and(asks_for_pin) => Ok(()),
            Err(error) => Err(error),
        }
    }

    async fn submit_two_factor(
        &self,
        workspace: LoginWorkspace,
        mut jar: CookieJar,
        code: Secret,
    ) -> Result<LoginStep, LoginError> {
        let code = Secret::new(code.expose().trim().to_owned());
        if !lazy_regex::regex_is_match!(r"^\d{6}$", code.expose()) {
            return Err(rejected(
                LoginErrorKind::InvalidTwoFactorCode,
                LoginState::AwaitingTwoFactor { workspace, jar },
            ));
        }
        let Some(magic) = workspace.magic_login_code.clone() else {
            return Err(rejected(
                LoginErrorKind::TwoFactorExpired,
                LoginState::AwaitingEmail,
            ));
        };
        let outcome = self
            .http
            .post_api::<LoginMagic>(
                SlackMethod::AuthLoginMagic,
                None,
                &[
                    ("magic_token", magic.expose()),
                    ("two_factor_native_supported", "1"),
                    ("two_factor_is_backup", "0"),
                    ("two_factor_pin", code.expose()),
                ],
                &mut jar,
            )
            .await;
        let signed = match outcome {
            Ok(signed) => signed,
            Err(error)
                if matches!(
                    error.code(),
                    Some(SlackErrorCode::TwoFactorExpired | SlackErrorCode::TwoFactorStateExpired)
                ) =>
            {
                return match self.start_two_factor(&workspace, &mut jar).await {
                    Ok(()) => Err(rejected(
                        LoginErrorKind::TwoFactorExpired,
                        LoginState::AwaitingTwoFactor { workspace, jar },
                    )),
                    Err(error) => Err(classify(
                        error,
                        LoginState::AwaitingEmail,
                        LoginState::AwaitingEmail,
                    )),
                };
            }
            Err(error) => {
                let same = LoginState::AwaitingTwoFactor { workspace, jar };
                return Err(classify(error, same, LoginState::AwaitingEmail));
            }
        };
        match credentials(signed.token, &jar) {
            Some(credentials) => Ok(LoginStep::Complete {
                workspace,
                credentials,
            }),
            None => Err(rejected(
                LoginErrorKind::SessionIncomplete,
                LoginState::AwaitingTwoFactor { workspace, jar },
            )),
        }
    }

    /// Exchanges the workspace's magic login for a token, picking the token
    /// out of the page like the web client, then asking the app's `/auth`
    /// endpoint when the page had none.
    async fn login_workspace(
        &self,
        workspace: &LoginWorkspace,
        jar: &mut CookieJar,
    ) -> Result<WorkspaceLogin, SlackError> {
        let page = if let Some(code) = &workspace.magic_login_code {
            let method = SlackMethod::AuthLoginMagicBulk;
            let mut url = self
                .http
                .endpoints
                .app
                .join("api/auth.loginMagicBulk")
                .map_err(|error| crate::client::invalid_request(method, error))?;
            url.query_pairs_mut()
                .append_pair("magic_tokens", code.expose())
                .append_pair("ssb", "1");
            let page = self.http.get_page(method, url, jar).await?;
            let bulk: MagicLoginBulk =
                crate::client::decode(method, reqwest::StatusCode::OK, &page.body)?;
            let result = bulk
                .token_results
                .get(code.expose())
                .or_else(|| bulk.token_results.values().next());
            match result {
                Some(MagicLoginResult {
                    error: Some(code), ..
                }) => {
                    return Err(SlackError::Api {
                        method,
                        code: code.clone(),
                    });
                }
                Some(MagicLoginResult {
                    auth_redir: Some(_),
                    ..
                }) => return Ok(WorkspaceLogin::NeedsBrowser),
                _ => {}
            }
            page
        } else if let Some(link) = &workspace.magic_login_url {
            let method = SlackMethod::LoginPage;
            let url = Url::parse(link.expose())
                .map_err(|error| crate::client::invalid_request(method, error))?;
            self.http.get_page(method, url, jar).await?
        } else {
            return Ok(WorkspaceLogin::NeedsBrowser);
        };

        let mut token = find_token(&page.body);
        if token.is_none() {
            token = self.fetch_app_token(workspace, jar).await?;
        }
        Ok(match credentials(token, jar) {
            Some(credentials) => WorkspaceLogin::Signed(credentials),
            None => WorkspaceLogin::Incomplete,
        })
    }

    async fn fetch_app_token(
        &self,
        workspace: &LoginWorkspace,
        jar: &mut CookieJar,
    ) -> Result<Option<Secret>, SlackError> {
        let method = SlackMethod::LoginPage;
        let mut url = self
            .http
            .endpoints
            .app
            .join("auth")
            .map_err(|error| crate::client::invalid_request(method, error))?;
        url.query_pairs_mut()
            .append_pair("app", "client")
            .append_pair("response_type", "json")
            .append_pair("return_to", &format!("/client/{}", workspace.team_id))
            .append_pair("teams", workspace.team_id.as_str());
        let page = self.http.get_page(method, url, jar).await?;
        let auth: AppAuth = serde_json::from_slice(&page.body)
            .map_err(|source| SlackError::Decode { method, source })?;
        Ok(auth
            .teams
            .get(workspace.team_id.as_str())
            .and_then(|team| team.token.clone()))
    }
}

enum WorkspaceLogin {
    Signed(SessionCredentials),
    NeedsBrowser,
    Incomplete,
}

fn find_token(body: &[u8]) -> Option<Secret> {
    let body = String::from_utf8_lossy(body);
    lazy_regex::regex_find!(r"xoxc-[A-Za-z0-9-]+", &body).map(|token| Secret::new(token.to_owned()))
}

fn credentials(token: Option<Secret>, jar: &CookieJar) -> Option<SessionCredentials> {
    let token = SessionToken::new(token?.expose().to_owned()).ok()?;
    let cookie = CookieToken::new(jar.get("d")?.expose().to_owned()).ok()?;
    Some(SessionCredentials {
        token,
        cookie,
        cookie_session_start: jar.get("d-s").cloned(),
    })
}

fn flatten_workspaces(found: FoundWorkspaces) -> Vec<LoginWorkspace> {
    let grouped = found
        .current_teams
        .into_iter()
        .flat_map(|group| group.teams);
    let orgs = found.current_orgs.into_iter().flat_map(|org| {
        let enterprise = org.org.as_ref().map(|org| org.name.clone());
        org.org
            .into_iter()
            .chain(org.teams)
            .map(move |team| (team, enterprise.clone()))
    });
    let mut workspaces: Vec<LoginWorkspace> = Vec::new();
    for (found, enterprise_name) in grouped.map(|team| (team, None)).chain(orgs) {
        if workspaces.iter().any(|known| known.team_id == found.id) {
            continue;
        }
        workspaces.push(LoginWorkspace {
            team_id: found.id,
            name: found.name,
            domain: found.domain,
            url: found.url.and_then(|url| Url::parse(&url).ok()),
            sso_required: found.sso_required,
            two_factor_required: found.two_factor_required,
            icon_url: found
                .icon
                .and_then(|icon| icon.image_88.or(icon.image_230).or(icon.image_original)),
            enterprise_name,
            magic_login_code: found
                .magic_login_code
                .filter(|code| !code.is_empty())
                .map(Secret::new),
            magic_login_url: found
                .magic_login_url
                .filter(|url| !url.is_empty())
                .map(Secret::new),
        });
    }
    workspaces
}

fn asks_for_pin(code: &SlackErrorCode) -> bool {
    matches!(
        code,
        SlackErrorCode::TwoFactorRequired
            | SlackErrorCode::MissingPin
            | SlackErrorCode::MissingPinApp
            | SlackErrorCode::MissingPinSms
    ) || code.as_str().starts_with("missing_pin_")
}

fn rejected(kind: LoginErrorKind, resume_from: LoginState) -> LoginError {
    LoginError { kind, resume_from }
}

/// Maps a Slack failure to a login error: mistakes the user can fix resume
/// from `same`; expired codes and rejected emails restart from `restart`.
fn classify(error: SlackError, same: LoginState, restart: LoginState) -> LoginError {
    if let SlackError::RateLimited { retry_after, .. } = &error {
        return rejected(
            LoginErrorKind::RateLimited {
                retry_after: Some(*retry_after),
            },
            same,
        );
    }
    let Some(code) = error.code() else {
        return rejected(LoginErrorKind::Slack(error), same);
    };
    match code {
        SlackErrorCode::Ratelimited
        | SlackErrorCode::RateLimited
        | SlackErrorCode::CodeRequestLimitReached => {
            rejected(LoginErrorKind::RateLimited { retry_after: None }, same)
        }
        SlackErrorCode::CaptchaRequired
        | SlackErrorCode::CaptchaFailed
        | SlackErrorCode::InvalidCaptcha => rejected(LoginErrorKind::CaptchaRejected, same),
        SlackErrorCode::InvalidEmail => {
            rejected(LoginErrorKind::InvalidEmail, LoginState::AwaitingEmail)
        }
        SlackErrorCode::InvalidCode
        | SlackErrorCode::InvalidEmailCode
        | SlackErrorCode::CodeAlreadyUsed => rejected(LoginErrorKind::InvalidCode, same),
        SlackErrorCode::ExpiredCode | SlackErrorCode::CodeExpired => {
            rejected(LoginErrorKind::CodeExpired, restart)
        }
        SlackErrorCode::InvalidPin
        | SlackErrorCode::Invalid2faCode
        | SlackErrorCode::InvalidTwoFactorCode => {
            rejected(LoginErrorKind::InvalidTwoFactorCode, same)
        }
        _ => rejected(LoginErrorKind::Slack(error), same),
    }
}
