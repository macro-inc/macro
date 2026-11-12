//! Driving harnessd, the agent sign-in daemon on a Macro computer, through
//! the fleet's exec, and keeping the computer's login rows in step with it.
//!
//! Every command for a computer runs under that computer's lock, and so does
//! the status read that follows it and the login rows written from that
//! status. The timer pass takes the same lock, so an older status never
//! overwrites a newer outcome. A cancel is the one exception: it goes
//! straight to harnessd, because it has to interrupt a completion that holds
//! the lock while it waits on Claude.

#[cfg(test)]
pub(crate) mod fakes;
#[cfg(test)]
mod test;

use std::future::Future;
use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use harness_id::HarnessId;
use harnessd_protocol::{AgentProvider, ClaudeAccount, Request, Response};
use harnesses::domain::account_logins::{AccountLoginChange, ProviderAccountIdentity};
use harnesses::domain::ports::{HarnessError, HarnessService};
use hosted_runtimes::domain::ids::ComputerId;
use macro_user_id::user_id::MacroUserIdStr;

/// The program the control plane runs in a guest.
pub(crate) const HARNESSD: &str = "harnessd";

/// How long harnessd may take to answer `request`.
pub(crate) fn answer_timeout(request: &Request) -> Duration {
    match request {
        // Claude Code starts and shows its URL.
        Request::SignInStart { .. } => Duration::from_secs(60),
        // Claude exchanges the code with Anthropic.
        Request::SignInComplete { .. } => Duration::from_secs(100),
        Request::SignInCancel { .. } | Request::SignOut { .. } | Request::Status { .. } => {
            Duration::from_secs(20)
        }
    }
}

/// The most one answer may hold. harnessd answers one short JSON line; a
/// guest that streams more is stopped rather than buffered.
pub(crate) const MAX_ANSWER_BYTES: u64 = 1024 * 1024;

/// Send `request` to a `harnessd` process and read its one answer line.
/// Over [`MAX_ANSWER_BYTES`] the process is dropped, which stops it.
pub(crate) async fn exchange<Err: std::fmt::Display>(
    process: hosted_runtimes::domain::ports::GuestProcess<Err>,
    request: &Request,
) -> Result<Response, HarnessdError> {
    use tokio::io::{AsyncBufReadExt as _, AsyncReadExt as _, AsyncWriteExt as _};

    let mut line = serde_json::to_string(request)
        .map_err(|error| HarnessdError::Unreadable(error.to_string()))?;
    line.push('\n');
    let mut stdin = process.stdin;
    stdin
        .write_all(line.as_bytes())
        .await
        .map_err(|error| HarnessdError::Unreachable(error.to_string()))?;
    // A closed stdin tells harnessd this was the only request.
    drop(stdin);

    let mut answer = String::new();
    tokio::io::BufReader::new(process.stdout.take(MAX_ANSWER_BYTES + 1))
        .read_line(&mut answer)
        .await
        .map_err(|error| HarnessdError::Unreachable(error.to_string()))?;
    if answer.len() as u64 > MAX_ANSWER_BYTES {
        return Err(HarnessdError::AnswerTooLarge);
    }
    let exit = process
        .exit
        .await
        .map_err(|error| HarnessdError::Unreachable(error.to_string()))?;
    if answer.trim().is_empty() {
        return Err(HarnessdError::Unreachable(format!(
            "harnessd exited with {exit} without answering"
        )));
    }
    serde_json::from_str::<Response>(answer.trim())
        .map_err(|error| HarnessdError::Unreadable(error.to_string()))
}

/// Why harnessd gave no usable answer.
#[derive(Debug, thiserror::Error)]
pub enum HarnessdError {
    /// The guest could not be reached or the program could not run.
    #[error("could not reach harnessd on the computer: {0}")]
    Unreachable(String),
    /// harnessd did not answer in time.
    #[error("harnessd did not answer in time")]
    Timeout,
    /// harnessd's answer ran past [`MAX_ANSWER_BYTES`].
    #[error("harnessd's answer is too large")]
    AnswerTooLarge,
    /// harnessd answered something that is not a response.
    #[error("harnessd answered unexpectedly: {0}")]
    Unreadable(String),
    /// The computer's lock could not be taken.
    #[error("could not lock the computer: {0}")]
    Lock(String),
    /// The login rows could not be written.
    #[error(transparent)]
    Harness(#[from] HarnessError),
}

/// Carries one request to harnessd on a computer and its answer back.
pub trait HarnessdTransport: Send + Sync + 'static {
    /// Send `request` and read its one answer.
    fn round_trip(
        &self,
        computer_id: ComputerId,
        request: Request,
    ) -> Pin<Box<dyn Future<Output = Result<Response, HarnessdError>> + Send + '_>>;
}

/// A computer's lock, held until dropped.
pub type ComputerLock = Box<dyn Send>;

/// Serializes one computer's commands with their login writes, across
/// replicas.
pub trait ComputerLocks: Send + Sync + 'static {
    /// Wait for the computer's lock.
    fn lock(
        &self,
        computer_id: ComputerId,
    ) -> Pin<Box<dyn Future<Output = Result<ComputerLock, HarnessdError>> + Send + '_>>;
}

/// harnessd on every computer, with the login rows it decides.
pub struct Harnessd<Harnesses> {
    transport: Arc<dyn HarnessdTransport>,
    locks: Arc<dyn ComputerLocks>,
    harnesses: Arc<Harnesses>,
}

impl<Harnesses> Clone for Harnessd<Harnesses> {
    fn clone(&self) -> Self {
        Self {
            transport: Arc::clone(&self.transport),
            locks: Arc::clone(&self.locks),
            harnesses: Arc::clone(&self.harnesses),
        }
    }
}

impl<Harnesses: HarnessService> Harnessd<Harnesses> {
    /// Drive harnessd over `transport`, serialized by `locks`, recording
    /// logins through `harnesses`.
    pub fn new(
        transport: Arc<dyn HarnessdTransport>,
        locks: Arc<dyn ComputerLocks>,
        harnesses: Arc<Harnesses>,
    ) -> Self {
        Self {
            transport,
            locks,
            harnesses,
        }
    }

    /// The harness service the login rows go through.
    pub fn harnesses(&self) -> &Harnesses {
        &self.harnesses
    }

    /// Read and record the Claude sign-in of each of `computers`, as
    /// `(harness, computer)`. One computer's failure is logged and the rest
    /// still refresh.
    #[tracing::instrument(name = "computer.harnessd.refresh_all", skip_all, fields(computers = computers.len()))]
    pub async fn refresh_each(&self, computers: &[(HarnessId, ComputerId)]) {
        for &(harness_id, computer_id) in computers {
            if let Err(error) = self
                .refresh(harness_id, computer_id, AgentProvider::Claude)
                .await
            {
                tracing::warn!(%computer_id, error = ?error, "could not refresh a computer's sign-in");
            }
        }
    }

    /// Run `request` on the computer behind `harness_id` and record the
    /// sign-in state it leaves. `signed_in_by` is the person whose request
    /// it is, recorded on a sign-in it completes.
    #[tracing::instrument(
        name = "computer.harnessd.command",
        skip(self, request, signed_in_by),
        fields(%harness_id, %computer_id, command = command_name(&request)),
        err
    )]
    pub async fn run(
        &self,
        harness_id: HarnessId,
        computer_id: ComputerId,
        request: Request,
        signed_in_by: Option<MacroUserIdStr<'static>>,
    ) -> Result<Response, HarnessdError> {
        let agent = request.agent();
        if matches!(request, Request::SignInCancel { .. }) {
            let answer = self.transport.round_trip(computer_id, request).await?;
            self.refresh(harness_id, computer_id, agent).await?;
            return Ok(answer);
        }

        let _lock = self.locks.lock(computer_id).await?;
        let completes = matches!(request, Request::SignInComplete { .. });
        let answer = self.transport.round_trip(computer_id, request).await?;
        let status = match &answer {
            Response::SignedIn { .. } | Response::SignedOut { .. } | Response::Pending { .. } => {
                answer.clone()
            }
            Response::SignInStarted { .. } | Response::Error { .. } => {
                self.transport
                    .round_trip(computer_id, Request::Status { agent })
                    .await?
            }
        };
        let signer = if completes { signed_in_by } else { None };
        self.record(harness_id, &status, signer).await?;
        Ok(answer)
    }

    /// Read harnessd's status for `agent` and record it.
    #[tracing::instrument(name = "computer.harnessd.refresh", skip(self), err)]
    pub async fn refresh(
        &self,
        harness_id: HarnessId,
        computer_id: ComputerId,
        agent: AgentProvider,
    ) -> Result<Response, HarnessdError> {
        let _lock = self.locks.lock(computer_id).await?;
        let status = self
            .transport
            .round_trip(computer_id, Request::Status { agent })
            .await?;
        self.record(harness_id, &status, None).await?;
        Ok(status)
    }

    /// Make the harness's login rows match `status`.
    async fn record(
        &self,
        harness_id: HarnessId,
        status: &Response,
        signed_in_by: Option<MacroUserIdStr<'static>>,
    ) -> Result<(), HarnessdError> {
        let change = match status {
            Response::SignedIn {
                agent: AgentProvider::Claude,
                claude:
                    Some(ClaudeAccount {
                        credential_id,
                        expires_at,
                    }),
            } => AccountLoginChange::SignedIn {
                provider: AgentProvider::Claude,
                account: ProviderAccountIdentity {
                    external_account_id: credential_id.clone(),
                },
                expires_at: *expires_at,
                signed_in_by,
            },
            Response::SignedIn {
                agent: AgentProvider::Claude,
                claude: None,
            } => {
                return Err(HarnessdError::Unreadable(
                    "a Claude sign-in without its credential".to_owned(),
                ));
            }
            Response::SignedOut { agent } | Response::Pending { agent } => {
                AccountLoginChange::SignedOut { provider: *agent }
            }
            // Nothing is known about the sign-in.
            Response::SignInStarted { .. } | Response::Error { .. } => return Ok(()),
        };
        self.harnesses
            .record_account_login(harness_id, change)
            .await?;
        Ok(())
    }
}

fn command_name(request: &Request) -> &'static str {
    match request {
        Request::SignInStart { .. } => "sign_in_start",
        Request::SignInComplete { .. } => "sign_in_complete",
        Request::SignInCancel { .. } => "sign_in_cancel",
        Request::SignOut { .. } => "sign_out",
        Request::Status { .. } => "status",
    }
}

/// [`HarnessdTransport`] for a deployment without a fleet: the computer
/// routes refuse before they reach it, so it only reports that.
pub struct NoFleet;

impl HarnessdTransport for NoFleet {
    fn round_trip(
        &self,
        _computer_id: ComputerId,
        _request: Request,
    ) -> Pin<Box<dyn Future<Output = Result<Response, HarnessdError>> + Send + '_>> {
        Box::pin(async {
            Err(HarnessdError::Unreachable(
                "this deployment has no computer fleet".to_owned(),
            ))
        })
    }
}

/// [`ComputerLocks`] as a session-level Postgres advisory lock on a
/// connection of its own, outside the service's pool: a sign-in can hold it
/// for over a minute while Claude answers. Dropping the lock closes the
/// connection, which releases it.
pub struct PgComputerLocks {
    options: sqlx::postgres::PgConnectOptions,
}

impl PgComputerLocks {
    /// Lock on connections made like `pool`'s.
    pub fn new(pool: &sqlx::PgPool) -> Self {
        Self {
            options: pool.connect_options().as_ref().clone(),
        }
    }
}

impl ComputerLocks for PgComputerLocks {
    fn lock(
        &self,
        computer_id: ComputerId,
    ) -> Pin<Box<dyn Future<Output = Result<ComputerLock, HarnessdError>> + Send + '_>> {
        Box::pin(async move {
            use sqlx::ConnectOptions as _;

            let mut connection = self
                .options
                .connect()
                .await
                .map_err(|error| HarnessdError::Lock(error.to_string()))?;
            sqlx::query!(
                "SELECT pg_advisory_lock(hashtext('harnessd'), hashtext($1::text))",
                computer_id.to_string(),
            )
            .execute(&mut connection)
            .await
            .map_err(|error| HarnessdError::Lock(error.to_string()))?;
            Ok(Box::new(connection) as ComputerLock)
        })
    }
}
