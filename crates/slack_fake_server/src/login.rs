//! The sign-in endpoints: email check, CAPTCHA, emailed code, workspace
//! list, magic login and two-factor. Progress is tracked by cookies the fake
//! sets, so a client that drops its cookie jar between steps fails.

use std::collections::BTreeMap;

use serde_json::{Value, json};

use crate::state::{LoginAccount, LoginMagic, LoginWorkspace, State};
use crate::web_api::{Fields, error};

/// The browser cookie the fake sets on `signup.checkEmail`.
pub(crate) const BROWSER_COOKIE: &str = "b";
/// The cookie the fake sets on `signin.confirmCode`.
pub(crate) const EMAIL_SESSION_COOKIE: &str = "email-session";

/// A sign-in response: JSON plus cookies to set.
pub(crate) struct LoginResponse {
    pub(crate) body: Value,
    pub(crate) set_cookies: Vec<String>,
}

impl LoginResponse {
    fn json(body: Value) -> Self {
        Self {
            body,
            set_cookies: Vec::new(),
        }
    }
}

fn ok(mut body: Value) -> Value {
    if let Some(object) = body.as_object_mut() {
        object.insert("ok".to_owned(), json!(true));
    }
    body
}

fn account<'state>(state: &'state State, email: &str) -> Option<&'state LoginAccount> {
    state
        .login_accounts
        .iter()
        .find(|account| account.email == email)
}

/// The workspace whose magic login code (`magic-<team>`) this is.
pub(crate) fn workspace_by_magic<'state>(
    state: &'state State,
    magic: &str,
) -> Option<&'state LoginWorkspace> {
    state
        .login_accounts
        .iter()
        .flat_map(|account| &account.workspaces)
        .find(|workspace| format!("magic-{}", workspace.team_id) == magic)
}

/// `Set-Cookie` values handing out a workspace's session.
pub(crate) fn session_cookies(workspace: &LoginWorkspace) -> Vec<String> {
    vec![
        format!(
            "d={}; Domain=.slack.com; Path=/; Secure; HttpOnly",
            encode_cookie(&workspace.cookie)
        ),
        "d-s=1700000000; Domain=.slack.com; Path=/; Secure; HttpOnly".to_owned(),
    ]
}

fn encode_cookie(value: &str) -> String {
    value
        .replace('%', "%25")
        .replace('/', "%2F")
        .replace('+', "%2B")
        .replace('=', "%3D")
}

/// Dispatches a sign-in API call.
pub(crate) fn call(
    state: &mut State,
    method: &str,
    fields: &Fields,
    cookies: &BTreeMap<String, String>,
) -> Option<LoginResponse> {
    let email = fields.get("email").map(String::as_str).unwrap_or_default();
    let response = match method {
        "signup.checkEmail" => {
            let challenge = account(state, email).is_some_and(|account| account.captcha.is_some());
            LoginResponse {
                body: ok(json!({ "challenge_response": challenge })),
                set_cookies: vec![format!("{BROWSER_COOKIE}=browser-{email}; Path=/")],
            }
        }
        "auth.captcha" => {
            let site_key = cookies
                .get(BROWSER_COOKIE)
                .and_then(|browser| browser.strip_prefix("browser-"))
                .and_then(|email| account(state, email))
                .and_then(|account| account.captcha.as_ref())
                .map(|captcha| captcha.site_key.clone());
            match site_key {
                Some(site_key) => LoginResponse::json(ok(json!({ "sitekey": site_key }))),
                None => LoginResponse::json(error("invalid_auth")),
            }
        }
        "signup.confirmEmail" => {
            if cookies.get(BROWSER_COOKIE).is_none() {
                return Some(LoginResponse::json(error("invalid_auth")));
            }
            let captcha = account(state, email).and_then(|account| account.captcha.clone());
            let solved = match captcha {
                None => true,
                Some(captcha) => fields.get("captcha_response") == Some(&captcha.solution),
            };
            LoginResponse::json(if solved {
                ok(json!({}))
            } else {
                error("captcha_failed")
            })
        }
        "signin.confirmCode" => {
            if cookies.get(BROWSER_COOKIE).is_none() {
                return Some(LoginResponse::json(error("invalid_auth")));
            }
            let code = fields.get("code").map(String::as_str);
            match account(state, email) {
                Some(account) if code == Some(account.code.as_str()) => LoginResponse {
                    body: ok(json!({})),
                    set_cookies: vec![format!("{EMAIL_SESSION_COOKIE}={email}; Path=/")],
                },
                _ => LoginResponse::json(error("invalid_code")),
            }
        }
        "signin.findWorkspaces" => {
            let Some(account) = cookies
                .get(EMAIL_SESSION_COOKIE)
                .and_then(|email| account(state, email))
            else {
                return Some(LoginResponse::json(error("invalid_auth")));
            };
            let teams: Vec<Value> = account
                .workspaces
                .iter()
                .map(|workspace| {
                    let (code, link) = match workspace.magic {
                        LoginMagic::Code => (format!("magic-{}", workspace.team_id), String::new()),
                        LoginMagic::Link => (
                            String::new(),
                            format!("{}magic/{}", state.base_url, workspace.team_id),
                        ),
                        LoginMagic::None => (String::new(), String::new()),
                    };
                    json!({
                        "id": workspace.team_id,
                        "name": workspace.name,
                        "domain": workspace.domain,
                        "url": format!("https://{}.slack.com/", workspace.domain),
                        "magic_login_code": code,
                        "magic_login_url": link,
                        "sso_required": workspace.sso_required,
                        "two_factor_required": workspace.two_factor_pin.is_some(),
                        "icon": { "image_88": format!("{}icons/{}.png", state.base_url, workspace.team_id) },
                    })
                })
                .collect();
            LoginResponse::json(ok(json!({
                "confirmed_email": account.email,
                "current_teams": [{ "email": account.email, "teams": teams }],
                "current_orgs": [],
            })))
        }
        "auth.loginMagic" => {
            let magic = fields
                .get("magic_token")
                .map(String::as_str)
                .unwrap_or_default();
            let Some(workspace) = workspace_by_magic(state, magic) else {
                return Some(LoginResponse::json(error("invalid_magic_token")));
            };
            match (&workspace.two_factor_pin, fields.get("two_factor_pin")) {
                (Some(_), None) => LoginResponse::json(error("missing_pin_app")),
                (Some(expected), Some(pin)) if expected != pin => {
                    LoginResponse::json(error("invalid_pin"))
                }
                _ => LoginResponse {
                    body: ok(json!({ "token": workspace.token })),
                    set_cookies: session_cookies(workspace),
                },
            }
        }
        _ => return None,
    };
    Some(response)
}
