//! Signing a Claude account in on a Macro computer: `claude setup-token` in a
//! hidden terminal. It prints an OAuth URL the user opens in their own
//! browser; the user then pastes back either the code Claude shows them or,
//! when Claude redirects to the computer's localhost (which their browser
//! cannot reach), that callback URL, which macrod opens inside the computer.
//! Either way `setup-token` prints a long-lived OAuth token.

use std::path::Path;
use std::time::Duration;

use reqwest::Url;
use rootcause::prelude::ResultExt as _;

use super::pty::Pty;

/// How long `setup-token` may take to print its URL, and then its token.
const URL_TIMEOUT: Duration = Duration::from_secs(30);
const TOKEN_TIMEOUT: Duration = Duration::from_secs(60);
const CALLBACK_TIMEOUT: Duration = Duration::from_secs(30);
/// Longest pasted code accepted; real ones are far shorter.
const MAX_CODE_CHARS: usize = 512;

/// A rejected code is distinct from a silent or broken CLI.
#[derive(Debug, thiserror::Error)]
pub(super) enum CompleteError {
    #[error("That code didn't work — sign in again to get a new one")]
    InvalidCode,
    #[error("Claude did not accept the sign-in in time")]
    Timeout,
    #[error("{0}")]
    Internal(rootcause::Report),
}

/// A `claude setup-token` waiting for the user.
pub struct SignIn {
    pty: Pty,
    http: reqwest::Client,
}

impl SignIn {
    /// Start `setup-token`.
    pub fn spawn(claude: &Path) -> rootcause::Result<Self> {
        let http = reqwest::Client::builder()
            .timeout(CALLBACK_TIMEOUT)
            .redirect(reqwest::redirect::Policy::none())
            .no_proxy()
            .build()
            .context("could not build the callback client")?;
        Ok(Self {
            pty: Pty::spawn(claude, &["setup-token"])?,
            http,
        })
    }

    /// The URL the user signs in at.
    pub async fn url(&mut self) -> rootcause::Result<String> {
        tokio::time::timeout(URL_TIMEOUT, self.pty.wait_for(sign_in_url))
            .await
            .map_err(|_| rootcause::report!("claude setup-token printed no sign-in URL in time"))?
    }

    /// Finish with what the user pasted and return the OAuth token.
    pub async fn complete(&mut self, pasted: &str) -> Result<String, CompleteError> {
        match Pasted::parse(pasted).map_err(CompleteError::Internal)? {
            Pasted::Callback(url) => open_callback(&self.http, url)
                .await
                .map_err(CompleteError::Internal)?,
            Pasted::Code(code) => self.pty.type_line(&code).map_err(CompleteError::Internal)?,
        }
        tokio::time::timeout(TOKEN_TIMEOUT, self.pty.wait_for(token_result))
            .await
            .map_err(|_| CompleteError::Timeout)?
            .map_err(CompleteError::Internal)?
    }
}

/// Open the localhost callback `setup-token` is listening on.
#[tracing::instrument(name = "macrod.claude.callback", skip_all, err)]
async fn open_callback(http: &reqwest::Client, url: Url) -> rootcause::Result<()> {
    let response = http
        .get(url)
        .send()
        .await
        .map_err(|_| rootcause::report!("could not reach claude setup-token's callback"))?;
    if !response.status().is_success() && !response.status().is_redirection() {
        rootcause::bail!(
            "claude setup-token's callback answered {}",
            response.status()
        );
    }
    Ok(())
}

/// What the user pasted back.
#[derive(Debug, PartialEq, Eq)]
pub(super) enum Pasted {
    /// A `http://localhost:<port>/callback?code=...` URL.
    Callback(Url),
    /// The code Claude showed them.
    Code(String),
}

impl Pasted {
    pub(super) fn parse(pasted: &str) -> rootcause::Result<Self> {
        let pasted = pasted.trim();
        if let Ok(url) = Url::parse(pasted)
            && url.scheme().starts_with("http")
        {
            let local = matches!(url.host_str(), Some("localhost" | "127.0.0.1"));
            let has_code = url
                .query_pairs()
                .any(|(key, value)| key == "code" && !value.is_empty());
            if url.scheme() == "http"
                && local
                && url.port().is_some()
                && url.username().is_empty()
                && url.password().is_none()
                && has_code
            {
                return Ok(Self::Callback(url));
            }
            rootcause::bail!("that link is not Claude's localhost sign-in callback");
        }
        if pasted.is_empty()
            || pasted.chars().count() > MAX_CODE_CHARS
            || pasted
                .chars()
                .any(|character| character.is_whitespace() || character.is_control())
        {
            rootcause::bail!("paste the code Claude showed you, or the page's full address");
        }
        Ok(Self::Code(pasted.to_owned()))
    }
}

/// The OAuth URL in `setup-token`'s output so far.
pub(super) fn sign_in_url(output: &str) -> Option<String> {
    let visible = strip_terminal_codes(output);
    lazy_regex::regex!(
        r#"(https://[A-Za-z0-9.\-]+/[^\s"'<>]*oauth/authorize\?[^\s"'<>]+)[\r\n\t ]"#
    )
    .captures(&visible)?
    .get(1)
    .map(|url| url.as_str().to_owned())
}

/// The long-lived OAuth token in `setup-token`'s output so far.
pub(super) fn oauth_token(output: &str) -> Option<String> {
    let visible = strip_terminal_codes(output);
    lazy_regex::regex!(r"(sk-ant-oat01-[A-Za-z0-9_\-]{20,})[\r\n\t ]")
        .captures(&visible)?
        .get(1)
        .map(|token| token.as_str().to_owned())
}

/// Rejections from the OAuth flow in the pinned Claude Code 2.1.214 binary
/// (nixpkgs in flake.lock). Keep the provider's phrases together and do not
/// match generic "expired" text, which also appears in successful output.
fn token_result(output: &str) -> Option<Result<String, CompleteError>> {
    let visible = strip_terminal_codes(output);
    if lazy_regex::regex!(
        r"(?i)\b(?:Invalid code\. Please make sure the full code was copied|Authentication failed: Invalid authorization code|OAuth error:|OAuth state mismatch)"
    ).is_match(&visible) {
        return Some(Err(CompleteError::InvalidCode));
    }
    oauth_token(output).map(Ok)
}

/// Terminal output without escape sequences: CSI (colors, cursor moves) and
/// OSC (titles, hyperlinks, whose visible text stays).
pub(super) fn strip_terminal_codes(output: &str) -> String {
    let without_osc =
        lazy_regex::regex_replace_all!(r"\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)", output, "");
    lazy_regex::regex_replace_all!(r"\x1b\[[0-9;?]*[ -/]*[@-~]|\x1b[@-Z\\-_]", &without_osc, "")
        .into_owned()
}
