//! Signing a Claude account in on a Macro computer: Claude Code's own
//! interactive login, run in a herdr pane anyone on the computer can watch.
//!
//! macrod starts `claude` in a fresh herdr workspace, answers its first-run
//! questions, and runs `/login` when it opens already onboarded. Claude prints
//! a sign-in URL that the user opens in their own browser; the code Claude
//! shows them there comes back through Macro and macrod types it into the
//! pane. Claude Code then keeps its own credential, which every later
//! session on the computer uses.

use std::path::Path;
use std::time::Duration;

use super::claude_auth::{self, ClaudeAuth};
use super::herdr_pane::{Herdr, Pane};

/// How long Claude may take to reach its sign-in URL, and then to accept a code.
const URL_TIMEOUT: Duration = Duration::from_secs(45);
const COMPLETE_TIMEOUT: Duration = Duration::from_secs(60);
const SCREEN_POLL: Duration = Duration::from_millis(500);
/// Longest pasted code accepted; real ones are far shorter.
const MAX_CODE_CHARS: usize = 512;
/// The herdr workspace label people see.
pub const WORKSPACE_LABEL: &str = "Claude sign-in";

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

/// What Claude Code's screen asks for, from what it shows.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(super) enum Screen {
    /// First run: the text style picker. Enter takes the default.
    ThemePicker,
    /// The login method picker; the subscription login is the first choice.
    LoginMethod { subscription_selected: bool },
    /// The sign-in URL, waiting for the pasted code.
    AwaitingCode { url: String },
    /// Claude rejected the code.
    OAuthError,
    /// The login finished.
    LoggedIn,
    /// The folder trust question; Yes is the second choice.
    TrustFolder,
    /// The ordinary prompt, where `/login` starts a login.
    Prompt,
    /// Anything else, such as Claude still starting.
    Unknown,
}

impl Screen {
    pub(super) fn read(screen: &str) -> Self {
        // Older Claude Code prints the OAuth error; newer explains the code.
        if screen.contains("OAuth error") || screen.contains("That code wasn't accepted") {
            return Self::OAuthError;
        }
        if screen.contains("Login successful") || screen.contains("Logged in as") {
            return Self::LoggedIn;
        }
        if let Some(url) = sign_in_url(screen) {
            return Self::AwaitingCode { url };
        }
        if screen.contains("Select login method") {
            return Self::LoginMethod {
                subscription_selected: screen
                    .lines()
                    .any(|line| line.trim_start().starts_with("❯ 1.")),
            };
        }
        if screen.contains("Choose the text style") {
            return Self::ThemePicker;
        }
        if screen.contains("Yes, I trust this folder") {
            return Self::TrustFolder;
        }
        if screen
            .lines()
            .any(|line| line.trim_start().starts_with('❯'))
        {
            return Self::Prompt;
        }
        Self::Unknown
    }
}

/// The OAuth URL on the screen. Claude hard-wraps it to the pane's width,
/// so its lines run up to the first blank line.
pub(super) fn sign_in_url(screen: &str) -> Option<String> {
    let mut lines = screen
        .lines()
        .skip_while(|line| !line.trim_start().starts_with("https://"));
    let mut url = lines.next()?.trim().to_owned();
    for line in lines {
        let line = line.trim();
        if line.is_empty() || line.contains(' ') {
            break;
        }
        url.push_str(line);
    }
    url.contains("/oauth/authorize?").then_some(url)
}

/// A pasted code, checked before it is typed into a terminal.
pub(super) fn pasted_code(pasted: &str) -> Result<&str, CompleteError> {
    let code = pasted.trim();
    if code.is_empty()
        || code.chars().count() > MAX_CODE_CHARS
        || code
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
    {
        return Err(CompleteError::Internal(rootcause::report!(
            "paste the code Claude showed you"
        )));
    }
    Ok(code)
}

/// How long a sign-in URL nobody has used yet is handed out again. Claude
/// Code itself waits at its paste prompt indefinitely, but its PKCE verifier
/// lives only in that process and claude.ai does not say how long an unused
/// authorization request stays valid, so an older one is replaced.
pub const FRESH_FOR: Duration = Duration::from_secs(10 * 60);

/// A Claude login waiting in its herdr pane.
pub struct SignIn {
    pane: Option<Pane>,
    claude: std::path::PathBuf,
    url: Option<String>,
    started: tokio::time::Instant,
}

impl SignIn {
    /// Open the pane and start Claude Code in `cwd`.
    pub async fn spawn(herdr: &Herdr, claude: &Path, cwd: &Path) -> rootcause::Result<Self> {
        herdr.ensure_server().await?;
        let pane = herdr.open_workspace(WORKSPACE_LABEL, cwd).await?;
        // The login is for this computer's own account, never a key in the
        // environment macrod inherited.
        let command = format!(
            "env -u ANTHROPIC_API_KEY -u ANTHROPIC_AUTH_TOKEN -u ANTHROPIC_BASE_URL -u CLAUDE_CODE_OAUTH_TOKEN {}",
            shell_words::quote(&claude.to_string_lossy())
        );
        pane.run(&command).await?;
        Ok(Self {
            pane: Some(pane),
            claude: claude.to_owned(),
            url: None,
            started: tokio::time::Instant::now(),
        })
    }

    /// The URL it showed, while it is young enough to hand out again and
    /// Claude is still waiting for its code.
    pub async fn fresh_url(&self) -> Option<String> {
        let url = self.url.clone()?;
        if self.started.elapsed() >= FRESH_FOR {
            return None;
        }
        let screen = self.pane().ok()?.screen().await.ok()?;
        (Screen::read(&screen) == Screen::AwaitingCode { url: url.clone() }).then_some(url)
    }

    fn pane(&self) -> rootcause::Result<&Pane> {
        self.pane
            .as_ref()
            .ok_or_else(|| rootcause::report!("the sign-in pane is closed"))
    }

    /// Answer Claude's questions until it shows the sign-in URL.
    pub async fn url(&mut self) -> rootcause::Result<String> {
        let pane = self.pane()?;
        let url: String = tokio::time::timeout(URL_TIMEOUT, async {
            let mut asked_login = false;
            loop {
                match Screen::read(&pane.screen().await?) {
                    Screen::AwaitingCode { url } => {
                        return Ok::<_, rootcause::Report>(url);
                    }
                    Screen::ThemePicker => pane.press(&["enter"]).await?,
                    Screen::LoginMethod {
                        subscription_selected: true,
                    } => pane.press(&["enter"]).await?,
                    Screen::LoginMethod {
                        subscription_selected: false,
                    } => pane.press(&["up"]).await?,
                    Screen::TrustFolder => pane.press(&["down", "enter"]).await?,
                    Screen::Prompt if !asked_login => {
                        pane.type_text("/login").await?;
                        pane.press(&["enter"]).await?;
                        asked_login = true;
                    }
                    Screen::OAuthError => pane.press(&["enter"]).await?,
                    Screen::Prompt | Screen::LoggedIn | Screen::Unknown => {}
                }
                tokio::time::sleep(SCREEN_POLL).await;
            }
        })
        .await
        .map_err(|_| rootcause::report!("Claude Code showed no sign-in URL in time"))??;
        self.url = Some(url.clone());
        Ok(url)
    }

    /// Type the pasted code and wait for Claude to accept or reject it.
    pub async fn complete(&mut self, pasted: &str) -> Result<ClaudeAuth, CompleteError> {
        let code = pasted_code(pasted)?;
        let pane = self.pane().map_err(CompleteError::Internal)?;
        pane.type_text(code)
            .await
            .map_err(CompleteError::Internal)?;
        pane.press(&["enter"])
            .await
            .map_err(CompleteError::Internal)?;
        tokio::time::timeout(COMPLETE_TIMEOUT, async {
            loop {
                let screen = pane.screen().await.map_err(CompleteError::Internal)?;
                match Screen::read(&screen) {
                    Screen::OAuthError => return Err(CompleteError::InvalidCode),
                    Screen::LoggedIn | Screen::TrustFolder | Screen::Prompt => {
                        let auth = claude_auth::status(&self.claude)
                            .await
                            .map_err(CompleteError::Internal)?;
                        if auth.is_signed_in() {
                            return Ok(auth);
                        }
                    }
                    _ => {}
                }
                tokio::time::sleep(SCREEN_POLL).await;
            }
        })
        .await
        .map_err(|_| CompleteError::Timeout)?
    }

    /// Close the pane, ending Claude Code in it.
    pub async fn close(mut self) {
        if let Some(pane) = self.pane.take()
            && let Err(error) = pane.close().await
        {
            tracing::warn!(error = ?error, "could not close the Claude sign-in pane");
        }
    }
}

impl Drop for SignIn {
    fn drop(&mut self) {
        let Some(pane) = self.pane.take() else {
            return;
        };
        if let Ok(runtime) = tokio::runtime::Handle::try_current() {
            runtime.spawn(async move {
                if let Err(error) = pane.close().await {
                    tracing::warn!(error = ?error, "could not close an abandoned Claude sign-in pane");
                }
            });
        }
    }
}
