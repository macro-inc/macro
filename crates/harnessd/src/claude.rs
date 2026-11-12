//! The Claude adapter: `claude setup-token` in a pseudo-terminal. Start
//! reads the sign-in URL off its screen; complete types the pasted code and
//! reads the long-lived token it prints, which is stored on this computer
//! and never leaves it.

mod credential;
mod screen;
mod terminal;

use crate::auth::{Account, AgentAuth, AgentStatus};
use chrono::{DateTime, Utc};
use credential::{Credential, CredentialStore};
use harnessd_protocol::ErrorKind;
use screen::{CodeOutcome, Validity};
use std::ffi::OsString;
use std::path::PathBuf;
use std::sync::{Arc, Mutex, OnceLock};
use std::time::{Duration, Instant};
use terminal::{Launch, Terminal, WaitError};
use tokio_util::sync::CancellationToken;

#[cfg(test)]
mod test;

/// Variables that would point Claude Code at another credential.
const CREDENTIAL_ENVIRONMENT: [&str; 4] = [
    "ANTHROPIC_BASE_URL",
    "ANTHROPIC_AUTH_TOKEN",
    "ANTHROPIC_API_KEY",
    "CLAUDE_CODE_OAUTH_TOKEN",
];
const LONGEST_CODE: usize = 512;

/// How the adapter runs Claude Code.
pub struct ClaudeConfig {
    /// The `claude` executable.
    pub program: PathBuf,
    /// harnessd's state directory; the credential goes under `claude/`.
    pub state_directory: PathBuf,
    /// Added to the CLI's environment.
    pub environment: Vec<(OsString, OsString)>,
    /// How long the CLI may take to show the URL.
    pub url_timeout: Duration,
    /// How long the CLI may take to answer a code.
    pub code_timeout: Duration,
    /// How long a started sign-in is handed out again rather than replaced.
    pub pending_lifetime: Duration,
    /// The terminal's width: wide, so the URL barely wraps.
    pub columns: u16,
    pub rows: u16,
}

impl ClaudeConfig {
    pub fn new(program: PathBuf, state_directory: PathBuf) -> Self {
        Self {
            program,
            state_directory,
            environment: Vec::new(),
            url_timeout: Duration::from_secs(45),
            code_timeout: Duration::from_secs(60),
            pending_lifetime: Duration::from_secs(10 * 60),
            columns: 500,
            rows: 100,
        }
    }
}

pub struct ClaudeAuth {
    config: ClaudeConfig,
    credentials: CredentialStore,
    pending: Mutex<Option<Arc<PendingSignIn>>>,
    /// One start at a time, so concurrent starts share one sign-in.
    starting: tokio::sync::Mutex<()>,
}

/// A running `claude setup-token`.
struct PendingSignIn {
    started_at: Instant,
    url: OnceLock<String>,
    terminal: Terminal,
    cancelled: CancellationToken,
    /// One code typed at a time.
    typing: tokio::sync::Mutex<()>,
}

impl PendingSignIn {
    fn close(&self) {
        self.cancelled.cancel();
        self.terminal.kill();
    }
}

impl ClaudeAuth {
    pub fn new(config: ClaudeConfig) -> Self {
        let credentials = CredentialStore::new(&config.state_directory);
        Self {
            config,
            credentials,
            pending: Mutex::new(None),
            starting: tokio::sync::Mutex::new(()),
        }
    }

    fn current(&self) -> Option<Arc<PendingSignIn>> {
        self.pending.lock().ok()?.clone()
    }

    fn replace(&self, sign_in: Option<Arc<PendingSignIn>>) -> Option<Arc<PendingSignIn>> {
        let mut pending = self.pending.lock().ok()?;
        std::mem::replace(&mut *pending, sign_in)
    }

    /// Close `sign_in` and forget it, unless a newer one replaced it.
    fn finish(&self, sign_in: &Arc<PendingSignIn>) {
        sign_in.close();
        if let Ok(mut pending) = self.pending.lock()
            && pending
                .as_ref()
                .is_some_and(|current| Arc::ptr_eq(current, sign_in))
        {
            *pending = None;
        }
    }

    fn stored(&self) -> Result<Option<Credential>, ErrorKind> {
        self.credentials.read().map_err(|error| {
            tracing::error!(%error, "reading the Claude credential failed");
            ErrorKind::Failed
        })
    }

    fn signed_in_or(&self, otherwise: AgentStatus) -> Result<AgentStatus, ErrorKind> {
        Ok(match self.stored()? {
            Some(credential) => AgentStatus::SignedIn(Account::Claude(credential.account())),
            None => otherwise,
        })
    }

    fn spawn(&self) -> Result<PendingSignIn, ErrorKind> {
        let terminal = Terminal::spawn(Launch {
            program: &self.config.program,
            arguments: &["setup-token"],
            remove_environment: &CREDENTIAL_ENVIRONMENT,
            environment: &self.config.environment,
            columns: self.config.columns,
            rows: self.config.rows,
        })
        .map_err(|error| {
            tracing::error!(%error, program = %self.config.program.display(), "starting claude setup-token failed");
            ErrorKind::Failed
        })?;
        Ok(PendingSignIn {
            started_at: Instant::now(),
            url: OnceLock::new(),
            terminal,
            cancelled: CancellationToken::new(),
            typing: tokio::sync::Mutex::new(()),
        })
    }

    async fn type_code(
        &self,
        sign_in: &PendingSignIn,
        code: &str,
    ) -> Result<CodeOutcome, ErrorKind> {
        let failed = |error: std::io::Error| {
            tracing::error!(%error, "typing into claude setup-token failed");
            ErrorKind::Failed
        };

        // A bracketed paste, then Enter once the CLI has drawn it, so the
        // Enter is a key press rather than part of the paste.
        let before = sign_in.terminal.screen().generation;
        sign_in
            .terminal
            .write(format!("\u{1b}[200~{code}\u{1b}[201~").as_bytes())
            .map_err(failed)?;
        sign_in
            .terminal
            .wait_for(self.config.code_timeout, |screen| {
                (screen.generation > before).then_some(())
            })
            .await
            .map_err(wait_error)?;
        sign_in.terminal.write(b"\r").map_err(failed)?;

        sign_in
            .terminal
            .wait_for(self.config.code_timeout, |screen| {
                screen::code_outcome(&screen.rows)
            })
            .await
            .map_err(wait_error)
    }

    fn store(&self, token: String, valid_for: Option<Validity>) -> Result<Account, ErrorKind> {
        let created_at = Utc::now();
        let expires_at = valid_for.and_then(|validity| expiry(created_at, validity));
        if expires_at.is_none() {
            tracing::warn!("claude setup-token did not say how long the token lasts");
        }

        let credential = Credential {
            token,
            expires_at,
            created_at,
        };
        self.credentials.write(&credential).map_err(|error| {
            tracing::error!(%error, "storing the Claude credential failed");
            ErrorKind::Failed
        })?;
        Ok(Account::Claude(credential.account()))
    }
}

fn wait_error(error: WaitError) -> ErrorKind {
    match error {
        WaitError::Timeout => ErrorKind::Timeout,
        WaitError::Closed => {
            tracing::error!("claude setup-token exited early");
            ErrorKind::Failed
        }
    }
}

fn expiry(created_at: DateTime<Utc>, validity: Validity) -> Option<DateTime<Utc>> {
    match validity {
        Validity::Years(years) => {
            created_at.checked_add_months(chrono::Months::new(years.checked_mul(12)?))
        }
        Validity::Months(months) => created_at.checked_add_months(chrono::Months::new(months)),
        Validity::Days(days) => created_at.checked_add_days(chrono::Days::new(u64::from(days))),
    }
}

/// A code the CLI could have shown: `<code>#<state>`, printable, bounded.
fn well_formed(code: &str) -> bool {
    !code.is_empty()
        && code.len() <= LONGEST_CODE
        && code.contains('#')
        && !code
            .chars()
            .any(|character| character.is_whitespace() || character.is_control())
}

impl AgentAuth for ClaudeAuth {
    async fn start(&self) -> Result<String, ErrorKind> {
        let _starting = self.starting.lock().await;

        if let Some(sign_in) = self.current() {
            let fresh = sign_in.started_at.elapsed() < self.config.pending_lifetime;
            if let Some(url) = sign_in.url.get()
                && fresh
                && !sign_in.terminal.closed()
            {
                return Ok(url.clone());
            }
            self.finish(&sign_in);
        }

        let sign_in = Arc::new(self.spawn()?);
        // Visible before the URL arrives, so a cancel can end it.
        if let Some(replaced) = self.replace(Some(Arc::clone(&sign_in))) {
            replaced.close();
        }

        let url = tokio::select! {
            url = sign_in.terminal.wait_for(self.config.url_timeout, |screen| {
                screen::sign_in_url(&screen.rows)
            }) => url,
            () = sign_in.cancelled.cancelled() => return Err(ErrorKind::Cancelled),
        };
        let url = match url {
            Ok(url) => url,
            Err(error) => {
                self.finish(&sign_in);
                return Err(wait_error(error));
            }
        };
        let url = sign_in.url.get_or_init(|| url).clone();
        Ok(url)
    }

    async fn complete(&self, code: String) -> Result<AgentStatus, ErrorKind> {
        let code = code.trim();
        if !well_formed(code) {
            return Err(ErrorKind::MalformedCode);
        }

        let no_sign_in = || match self.stored()? {
            // A retry of a complete that already succeeded.
            Some(credential) => Ok(AgentStatus::SignedIn(Account::Claude(credential.account()))),
            None => Err(ErrorKind::NoPendingSignIn),
        };
        let Some(sign_in) = self.current().filter(|sign_in| sign_in.url.get().is_some()) else {
            return no_sign_in();
        };
        let _typing = sign_in.typing.lock().await;
        let still_current = self
            .current()
            .is_some_and(|current| Arc::ptr_eq(&current, &sign_in));
        if !still_current {
            return no_sign_in();
        }

        let outcome = tokio::select! {
            outcome = self.type_code(&sign_in, code) => outcome,
            () = sign_in.cancelled.cancelled() => return Err(ErrorKind::Cancelled),
        };
        // Whatever the CLI answered, this sign-in is over.
        self.finish(&sign_in);
        match outcome? {
            CodeOutcome::Created { token, valid_for } => {
                self.store(token, valid_for).map(AgentStatus::SignedIn)
            }
            CodeOutcome::Rejected => Err(ErrorKind::InvalidCode),
            CodeOutcome::Malformed => Err(ErrorKind::MalformedCode),
        }
    }

    async fn cancel(&self) -> Result<AgentStatus, ErrorKind> {
        if let Some(sign_in) = self.replace(None) {
            sign_in.close();
        }
        self.signed_in_or(AgentStatus::SignedOut)
    }

    async fn sign_out(&self) -> Result<(), ErrorKind> {
        if let Some(sign_in) = self.replace(None) {
            sign_in.close();
        }
        self.credentials.delete().map_err(|error| {
            tracing::error!(%error, "deleting the Claude credential failed");
            ErrorKind::Failed
        })
    }

    async fn status(&self) -> Result<AgentStatus, ErrorKind> {
        let waiting = match self.current() {
            Some(sign_in) if sign_in.terminal.closed() => {
                self.finish(&sign_in);
                false
            }
            Some(_) => true,
            None => false,
        };
        let otherwise = if waiting {
            AgentStatus::Pending
        } else {
            AgentStatus::SignedOut
        };
        self.signed_in_or(otherwise)
    }
}
