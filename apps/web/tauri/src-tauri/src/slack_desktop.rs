//! Signs in to Slack in a throwaway window and hands the web app Slack's
//! web-client session, which it then sends to the backend.
//!
//! Slack's session cookie (`d`) is HttpOnly and its pages refuse to be framed,
//! so the web app cannot read it; the desktop app opens slack.com in its own
//! window instead. That window uses an in-memory (incognito) profile that
//! shares nothing with the Macro window, has no IPC capability (it is a remote
//! origin, and every capability names only `main`), and is exempt from
//! `MacroNavigationPlugin`, enforcing its own navigation policy
//! ([`validation::allows_navigation`]). Once it reaches Slack's web client the
//! command reads the cookies and every workspace's `xoxc-` token, wipes the
//! profile, closes the window, and returns them to the calling webview only.
//!
//! The same kind of window renders Slack's reCAPTCHA on slack.com for the
//! email sign-in flow ([`slack_desktop_captcha`]).
//!
//! Built for the macOS Chromium (CEF) runtime, whose cookie reads include
//! HttpOnly cookies. Linux and Windows compile against the same Tauri APIs on
//! wry, where that is unverified; mobile is unsupported (Tauri mobile is
//! single-window).

#[cfg(desktop)]
mod validation;
#[cfg(desktop)]
mod window;

use serde::Serialize;

use crate::AppRuntime;

/// The one Slack window; sign-in and captcha share it, so only one runs at a time.
pub(crate) const WINDOW_LABEL: &str = "slack-sign-in";

/// A Slack credential. Its `Debug` never prints the value.
#[derive(Serialize, Clone, PartialEq, Eq)]
#[serde(transparent)]
pub struct SlackSecret(String);

impl std::fmt::Debug for SlackSecret {
    fn fmt(&self, formatter: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        formatter.write_str("SlackSecret(<redacted>)")
    }
}

/// One workspace's web-client token.
#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SlackWorkspaceToken {
    token: SlackSecret,
    team_id: Option<String>,
}

/// Slack's web-client session: the `d` and `d-s` cookies and every signed-in
/// workspace's `xoxc-` token.
#[derive(Serialize, Debug, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct SlackDesktopSession {
    cookie: SlackSecret,
    cookie_ds: Option<SlackSecret>,
    tokens: Vec<SlackWorkspaceToken>,
}

#[derive(Debug, thiserror::Error, Serialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum SlackDesktopError {
    #[cfg(mobile)]
    #[error("Signing in to Slack this way needs Macro on a computer.")]
    Unsupported,
    #[error("That isn't a Slack page.")]
    InvalidUrl,
    #[error("A Slack window is already open. Finish or close it first.")]
    Busy,
    #[error("The Slack window was closed.")]
    Cancelled,
    #[error("Slack sign-in took too long. Try again.")]
    TimedOut,
    #[error("Slack didn't finish signing you in. Try again.")]
    NoSession,
    #[error("Slack's verification couldn't load. Try again.")]
    CaptchaUnavailable,
    #[error("The Slack window couldn't be opened.")]
    WindowFailed,
}

impl SlackDesktopError {
    /// The serialized name, recorded as the span outcome.
    fn code(&self) -> &'static str {
        match self {
            #[cfg(mobile)]
            Self::Unsupported => "unsupported",
            Self::InvalidUrl => "invalid_url",
            Self::Busy => "busy",
            Self::Cancelled => "cancelled",
            Self::TimedOut => "timed_out",
            Self::NoSession => "no_session",
            Self::CaptchaUnavailable => "captcha_unavailable",
            Self::WindowFailed => "window_failed",
        }
    }
}

/// Sign in to Slack in a throwaway window, starting at `sign_in_url` (an https
/// page on slack.com or a subdomain, e.g. a workspace's SSO start URL) or at
/// `https://app.slack.com/signin`.
#[tauri::command]
#[tracing::instrument(
    name = "slack.desktop_sign_in",
    skip_all,
    err,
    fields(outcome = tracing::field::Empty, team_count = tracing::field::Empty)
)]
pub async fn slack_desktop_sign_in(
    webview: tauri::Webview<AppRuntime>,
    sign_in_url: Option<String>,
) -> Result<SlackDesktopSession, SlackDesktopError> {
    #[cfg(desktop)]
    let result = window::sign_in(webview, sign_in_url).await;
    #[cfg(mobile)]
    let result = {
        let _ = (webview, sign_in_url);
        Err(SlackDesktopError::Unsupported)
    };

    let span = tracing::Span::current();
    match &result {
        Ok(session) => {
            span.record("outcome", "signed_in");
            span.record("team_count", session.tokens.len());
        }
        Err(error) => {
            span.record("outcome", error.code());
        }
    }
    result
}

/// Render Slack's reCAPTCHA (`site_key`) over `page_url` (an https page on
/// slack.com or a subdomain) in a throwaway window, and return the solved token.
#[tauri::command]
#[tracing::instrument(
    name = "slack.desktop_captcha",
    skip_all,
    err,
    fields(outcome = tracing::field::Empty)
)]
pub async fn slack_desktop_captcha(
    webview: tauri::Webview<AppRuntime>,
    site_key: String,
    page_url: String,
) -> Result<String, SlackDesktopError> {
    #[cfg(desktop)]
    let result = window::captcha(webview, site_key, page_url).await;
    #[cfg(mobile)]
    let result = {
        let _ = (webview, site_key, page_url);
        Err(SlackDesktopError::Unsupported)
    };

    let outcome = match &result {
        Ok(_) => "solved",
        Err(error) => error.code(),
    };
    tracing::Span::current().record("outcome", outcome);
    result
}
