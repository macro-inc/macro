//! The Slack boundary around the throwaway window: which pages it may open,
//! where it may navigate, and what it reads back out of Slack's web client.

use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use url::Url;

use super::{SlackDesktopError, SlackSecret, SlackWorkspaceToken};

/// Where sign-in starts when the caller names no workspace sign-in page.
pub(super) const DEFAULT_SIGN_IN_URL: &str = "https://app.slack.com/signin";
/// The origin whose cookies and `localStorage` hold the web-client session.
pub(super) const CLIENT_ORIGIN: &str = "https://app.slack.com";
/// Slack's session cookie (HttpOnly).
pub(super) const SESSION_COOKIE: &str = "d";
/// The companion cookie Slack sends next to `d`.
pub(super) const SESSION_COOKIE_DS: &str = "d-s";
/// Reads the web client's workspace list, tokens included, as a JSON string.
pub(super) const READ_LOCAL_CONFIG: &str = "localStorage.getItem('localConfig_v2')";

const SLACK_DOMAIN: &str = "slack.com";
const CLIENT_HOST: &str = "app.slack.com";
const CLIENT_PATH: &str = "/client";
const WEB_CLIENT_TOKEN_PREFIX: &str = "xoxc-";
const CAPTCHA_SCRIPT: &str = include_str!("captcha.js");

/// Parse a page the window may open: https on `slack.com` or a subdomain,
/// without credentials or a non-default port.
pub(super) fn slack_page_url(raw: &str) -> Result<Url, SlackDesktopError> {
    let url = Url::parse(raw).map_err(|_| SlackDesktopError::InvalidUrl)?;
    let has_credentials = !url.username().is_empty() || url.password().is_some();

    if url.scheme() != "https" || has_credentials || url.port().is_some() || !is_slack_host(&url) {
        return Err(SlackDesktopError::InvalidUrl);
    }
    Ok(url)
}

/// Whether `url` is served by `slack.com` or one of its subdomains.
pub(super) fn is_slack_host(url: &Url) -> bool {
    let Some(host) = url.domain() else {
        return false;
    };
    host == SLACK_DOMAIN
        || host
            .strip_suffix(SLACK_DOMAIN)
            .is_some_and(|prefix| prefix.ends_with('.'))
}

/// Whether the window has reached Slack's web client, i.e. sign-in finished.
pub(super) fn is_client_url(url: &Url) -> bool {
    let path = url.path();
    url.scheme() == "https"
        && url.domain() == Some(CLIENT_HOST)
        && (path == CLIENT_PATH || path.starts_with("/client/"))
}

/// Navigation policy for the Slack window. Sign-in may pass through any
/// identity provider, so every http(s) page loads in place; blank frames are
/// inert. Every other scheme (`slack://`, `file:`, `javascript:` ...) is
/// refused rather than handed to the operating system.
pub(super) fn allows_navigation(url: &Url) -> bool {
    match url.scheme() {
        "http" | "https" => true,
        "about" => matches!(url.path(), "blank" | "srcdoc"),
        _ => false,
    }
}

/// Whether a `window.open` from the Slack window may open a popup. Popups
/// stay inside the same throwaway profile, so SSO pages that rely on
/// `window.opener` keep working.
pub(super) fn allows_popup(url: &Url) -> bool {
    matches!(url.scheme(), "http" | "https")
}

/// The part of Slack's `localConfig_v2` this reads.
#[derive(Deserialize)]
struct LocalConfig {
    #[serde(default)]
    teams: BTreeMap<String, serde_json::Value>,
}

#[derive(Deserialize)]
struct LocalConfigTeam {
    id: Option<String>,
    token: Option<String>,
}

/// Every web-client (`xoxc-`) token in Slack's `localConfig_v2`, in team key
/// order. Malformed config or teams yield nothing for that part instead of
/// failing the rest, so the caller can retry until Slack has written it.
pub(super) fn web_client_tokens(local_config: &str) -> Vec<SlackWorkspaceToken> {
    let Ok(config) = serde_json::from_str::<LocalConfig>(local_config) else {
        return Vec::new();
    };

    config
        .teams
        .into_values()
        .filter_map(|team| serde_json::from_value::<LocalConfigTeam>(team).ok())
        .filter_map(|team| {
            let token = team.token?;
            token
                .starts_with(WEB_CLIENT_TOKEN_PREFIX)
                .then(|| SlackWorkspaceToken {
                    token: SlackSecret(token),
                    team_id: team.id,
                })
        })
        .collect()
}

/// `eval_with_callback` hands back the JSON of the evaluated value: here a
/// JSON string holding `localConfig_v2`, or `null` before Slack writes it.
/// An empty result means the evaluation failed (e.g. mid-navigation).
pub(super) fn local_config_from_eval(result: &str) -> Option<String> {
    serde_json::from_str::<Option<String>>(result)
        .ok()
        .flatten()
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct CaptchaConfig<'a> {
    site_key: &'a str,
}

/// The script that renders Slack's reCAPTCHA and reports its state, applied to
/// `site_key`. The key is JSON-encoded, never spliced into the source.
pub(super) fn captcha_script(site_key: &str) -> String {
    let config = serde_json::to_string(&CaptchaConfig { site_key })
        .expect("a struct of one string always serializes");
    format!("({CAPTCHA_SCRIPT})({config})")
}

#[derive(Deserialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub(super) enum CaptchaStatus {
    /// The page has not finished loading; the widget is not installed yet.
    Loading,
    /// The challenge is showing.
    Pending,
    Solved,
    /// reCAPTCHA could not be loaded.
    Failed,
}

#[derive(Deserialize, Debug, PartialEq, Eq)]
pub(super) struct CaptchaState {
    pub(super) status: CaptchaStatus,
    pub(super) token: Option<String>,
}

/// Parse one evaluation of [`captcha_script`]. `None` when the evaluation
/// failed or returned something else (e.g. the page was navigating).
pub(super) fn captcha_state_from_eval(result: &str) -> Option<CaptchaState> {
    serde_json::from_str(result).ok()
}

#[cfg(test)]
mod test;
