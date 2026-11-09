//! Redis carriage for computer commands across replicas.
//!
//! `agent-harness.computer-control` carries `request`, `accepted` and
//! `answered` messages. The replica holding the harness's runtime connection
//! claims a request (`SET NX`, so a redial racing a displaced socket runs it
//! once), acknowledges it at once, and answers when macrod does. A request
//! nobody acknowledges within [`ACCEPT_TIMEOUT`] means the computer is not
//! connected anywhere.

use std::sync::Arc;
use std::time::Duration;

use agent_harness::inbound::runtime_gateway::GatewaySender;
use agent_harness::outbound::runtime_registry::RuntimeRegistry;
use agent_runtime_protocol::domain::schema::v0::{ComputerCommand, ComputerControlResult};
use dashmap::DashMap;
use futures::StreamExt as _;
use harness_id::HarnessId;
use redis::aio::MultiplexedConnection;
use redis::{AsyncCommands as _, ExistenceCheck, SetExpiry, SetOptions};
use serde_json::{Map, Value};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;
use uuid::Uuid;

use super::claude::ComputerRouteError;

const CONTROL_CHANNEL: &str = "agent-harness.computer-control";
/// How long the holding replica has to acknowledge a command.
const ACCEPT_TIMEOUT: Duration = Duration::from_secs(3);
const CLAIM_SECONDS: u64 = 300;
const RESUBSCRIBE_DELAY: Duration = Duration::from_secs(1);

/// How long macrod may take to answer each command.
fn command_timeout(command: &ComputerCommand) -> Duration {
    match command {
        ComputerCommand::ClaudeSignInStart => Duration::from_secs(45),
        ComputerCommand::ClaudeSignInComplete { .. } => Duration::from_secs(100),
        ComputerCommand::ClaudeSignInCancel | ComputerCommand::ClaudeSignOut => {
            Duration::from_secs(15)
        }
    }
}

fn command_name(command: &ComputerCommand) -> &'static str {
    match command {
        ComputerCommand::ClaudeSignInStart => "claude_sign_in_start",
        ComputerCommand::ClaudeSignInComplete { .. } => "claude_sign_in_complete",
        ComputerCommand::ClaudeSignInCancel => "claude_sign_in_cancel",
        ComputerCommand::ClaudeSignOut => "claude_sign_out",
    }
}

#[derive(serde::Serialize, serde::Deserialize)]
#[serde(tag = "type", rename_all = "snake_case")]
enum BusMessage {
    Request {
        request_id: Uuid,
        harness: HarnessId,
        command: ComputerCommand,
        #[serde(default)]
        trace_context: Map<String, Value>,
    },
    Accepted {
        request_id: Uuid,
    },
    Answered {
        request_id: Uuid,
        result: ComputerControlResult,
    },
}

enum Reply {
    Accepted,
    Answered(ComputerControlResult),
}

/// Sends computer commands to whichever replica holds the runtime.
#[derive(Clone)]
pub struct ComputerControl {
    inner: Arc<Inner>,
}

struct Inner {
    runtimes: Arc<RuntimeRegistry<GatewaySender>>,
    redis: redis::Client,
    pending: DashMap<Uuid, mpsc::Sender<Reply>>,
}

impl ComputerControl {
    /// Start consuming the command channel until `shutdown`.
    pub fn start(
        runtimes: Arc<RuntimeRegistry<GatewaySender>>,
        redis: redis::Client,
        tasks: &TaskTracker,
        shutdown: CancellationToken,
    ) -> Self {
        let control = Self {
            inner: Arc::new(Inner {
                runtimes,
                redis,
                pending: DashMap::new(),
            }),
        };
        tasks.spawn(control.clone().consume(tasks.clone(), shutdown));
        control
    }

    /// Run `command` on `harness`'s computer and return macrod's answer.
    pub async fn send(
        &self,
        harness: HarnessId,
        command: ComputerCommand,
    ) -> Result<ComputerControlResult, ComputerRouteError> {
        let request_id = Uuid::now_v7();
        let span = tracing::info_span!(
            "computer_control.request",
            otel.kind = "producer",
            harness_id = %harness,
            request_id = %request_id,
            command = command_name(&command),
            route = tracing::field::Empty,
            outcome = tracing::field::Empty,
        );
        let result = self
            .send_inner(request_id, harness, command)
            .instrument(span.clone())
            .await;
        span.record(
            "outcome",
            match &result {
                Ok(ComputerControlResult::Failed { .. }) => "failed",
                Ok(_) => "ok",
                Err(ComputerRouteError::Conflict(_)) => "not_connected",
                Err(ComputerRouteError::Timeout) => "timeout",
                Err(_) => "error",
            },
        );
        result
    }

    async fn send_inner(
        &self,
        request_id: Uuid,
        harness: HarnessId,
        command: ComputerCommand,
    ) -> Result<ComputerControlResult, ComputerRouteError> {
        let deadline = command_timeout(&command);
        if self.inner.runtimes.is_connected(harness) {
            tracing::Span::current().record("route", "local");
            return run_local(&self.inner.runtimes, harness, command, deadline)
                .await
                .ok_or_else(not_connected);
        }
        tracing::Span::current().record("route", "bus");
        let (replies, mut received) = mpsc::channel(2);
        self.inner.pending.insert(request_id, replies);
        let _pending = PendingGuard {
            pending: &self.inner.pending,
            request_id,
        };
        let mut trace_context = Map::new();
        genai_telemetry::propagation::inject(&tracing::Span::current(), &mut trace_context);
        self.publish(&BusMessage::Request {
            request_id,
            harness,
            command,
            trace_context,
        })
        .await?;
        match tokio::time::timeout(ACCEPT_TIMEOUT, received.recv()).await {
            Ok(Some(Reply::Accepted)) => {}
            Ok(Some(Reply::Answered(result))) => return Ok(result),
            Ok(None) | Err(_) => return Err(not_connected()),
        }
        loop {
            match tokio::time::timeout(deadline, received.recv()).await {
                Ok(Some(Reply::Answered(result))) => return Ok(result),
                Ok(Some(Reply::Accepted)) => {}
                Ok(None) => return Err(not_connected()),
                Err(_) => return Err(ComputerRouteError::Timeout),
            }
        }
    }

    async fn publish(&self, message: &BusMessage) -> Result<(), ComputerRouteError> {
        publish_message(&self.inner.redis, message).await
    }

    async fn consume(self, tasks: TaskTracker, shutdown: CancellationToken) {
        loop {
            let ended = tokio::select! {
                () = shutdown.cancelled() => return,
                ended = self.consume_subscription(&tasks) => ended,
            };
            tracing::warn!(error = ?ended, "computer control subscription ended; resubscribing");
            tokio::select! {
                () = shutdown.cancelled() => return,
                () = tokio::time::sleep(RESUBSCRIBE_DELAY) => {}
            }
        }
    }

    async fn consume_subscription(&self, tasks: &TaskTracker) -> rootcause::Result<()> {
        let mut subscriber = self
            .inner
            .redis
            .get_async_pubsub()
            .await
            .map_err(|error| rootcause::report!("could not open the subscriber: {error}"))?;
        subscriber
            .subscribe(CONTROL_CHANNEL)
            .await
            .map_err(|error| rootcause::report!("could not subscribe: {error}"))?;
        let mut messages = subscriber.into_on_message();
        while let Some(message) = messages.next().await {
            let Ok(payload) = message.get_payload::<String>() else {
                tracing::warn!("dropping a malformed computer control message");
                continue;
            };
            match serde_json::from_str::<BusMessage>(&payload) {
                Ok(BusMessage::Request {
                    request_id,
                    harness,
                    command,
                    trace_context,
                }) => {
                    if self.inner.runtimes.is_connected(harness) && self.claim(request_id).await {
                        let span = tracing::info_span!(
                            "computer_control.execute",
                            otel.kind = "consumer",
                            harness_id = %harness,
                            request_id = %request_id,
                            command = command_name(&command),
                        );
                        genai_telemetry::propagation::set_parent(&span, Some(&trace_context));
                        tasks.spawn(
                            self.clone()
                                .execute(request_id, harness, command)
                                .instrument(span),
                        );
                    }
                }
                Ok(BusMessage::Accepted { request_id }) => self.reply(request_id, Reply::Accepted),
                Ok(BusMessage::Answered { request_id, result }) => {
                    self.reply(request_id, Reply::Answered(result));
                }
                Err(error) => {
                    tracing::warn!(error = %error, "dropping a malformed computer control message");
                }
            }
        }
        rootcause::bail!("the subscriber stream ended")
    }

    async fn claim(&self, request_id: Uuid) -> bool {
        let Ok(mut connection) = self.inner.redis.get_multiplexed_async_connection().await else {
            return false;
        };
        connection
            .set_options::<_, _, Option<String>>(
                format!("agent-harness.computer-control.claim.{request_id}"),
                "1",
                SetOptions::default()
                    .conditional_set(ExistenceCheck::NX)
                    .with_expiration(SetExpiry::EX(CLAIM_SECONDS)),
            )
            .await
            .is_ok_and(|claimed| claimed.is_some())
    }

    async fn execute(self, request_id: Uuid, harness: HarnessId, command: ComputerCommand) {
        if let Err(error) = self.publish(&BusMessage::Accepted { request_id }).await {
            tracing::error!(error = ?error, "could not acknowledge a computer command");
            return;
        }
        let deadline = command_timeout(&command);
        let result = run_local(&self.inner.runtimes, harness, command, deadline)
            .await
            .unwrap_or_else(|| ComputerControlResult::Failed {
                message: "the computer disconnected".to_owned(),
            });
        if let Err(error) = self
            .publish(&BusMessage::Answered { request_id, result })
            .await
        {
            tracing::error!(error = ?error, "could not answer a computer command");
        }
    }

    fn reply(&self, request_id: Uuid, reply: Reply) {
        if let Some(waiter) = self.inner.pending.get(&request_id) {
            let _ = waiter.try_send(reply);
        }
    }
}

/// Removes a request's waiter however its sender returns.
struct PendingGuard<'map> {
    pending: &'map DashMap<Uuid, mpsc::Sender<Reply>>,
    request_id: Uuid,
}

impl Drop for PendingGuard<'_> {
    fn drop(&mut self) {
        self.pending.remove(&self.request_id);
    }
}

/// `None` when this replica no longer holds the runtime.
async fn run_local(
    runtimes: &RuntimeRegistry<GatewaySender>,
    harness: HarnessId,
    command: ComputerCommand,
    deadline: Duration,
) -> Option<ComputerControlResult> {
    match tokio::time::timeout(deadline, runtimes.computer_control(harness, command)).await {
        Ok(None) => None,
        Ok(Some(Ok(result))) => Some(result),
        Ok(Some(Err(error))) => {
            tracing::warn!(error = %error, "a computer command found no answer");
            None
        }
        Err(_) => Some(ComputerControlResult::Failed {
            message: "the computer did not answer in time".to_owned(),
        }),
    }
}

fn not_connected() -> ComputerRouteError {
    ComputerRouteError::Conflict("the computer is not connected".to_owned())
}

async fn publish_message(
    redis: &redis::Client,
    message: &BusMessage,
) -> Result<(), ComputerRouteError> {
    let payload = serde_json::to_string(message)
        .map_err(|error| ComputerRouteError::Internal(rootcause::report!("{error}")))?;
    let mut connection = redis
        .get_multiplexed_async_connection()
        .await
        .map_err(redis_error)?;
    connection
        .publish::<_, _, ()>(CONTROL_CHANNEL, payload)
        .await
        .map_err(redis_error)
}

fn redis_error(error: redis::RedisError) -> ComputerRouteError {
    ComputerRouteError::Internal(rootcause::report!("redis: {error}"))
}

/// Serializes account mutations through their database confirmation, across
/// replicas. Drop schedules owner-checked cleanup when a request is abandoned.
pub(crate) struct AccountChange {
    connection: MultiplexedConnection,
    key: String,
    token: String,
    cleanup: TaskTracker,
    released: bool,
    cancel: Option<(ComputerControl, HarnessId)>,
}

impl AccountChange {
    pub(crate) async fn claim(
        redis: &redis::Client,
        harness: HarnessId,
        cleanup: &TaskTracker,
    ) -> Result<Self, ComputerRouteError> {
        let connection = redis
            .get_multiplexed_async_connection()
            .await
            .map_err(redis_error)?;
        let key = format!("agent-harness.computer-account.{harness}");
        let token = Uuid::now_v7().to_string();
        let mut lease = Self {
            connection,
            key,
            token,
            cleanup: cleanup.clone(),
            released: false,
            cancel: None,
        };
        // Arm cleanup before SET: dropping the request during the Redis write
        // must release a lease the server may already have accepted.
        // Longer than the longest command deadline plus bus admission.
        const LEASE_SECONDS: u64 = 180;
        let acquired: Option<String> = lease
            .connection
            .set_options(
                &lease.key,
                &lease.token,
                SetOptions::default()
                    .conditional_set(ExistenceCheck::NX)
                    .with_expiration(SetExpiry::EX(LEASE_SECONDS)),
            )
            .await
            .map_err(redis_error)?;
        if acquired.is_none() {
            return Err(ComputerRouteError::Conflict(
                "another Claude account change is in progress".to_owned(),
            ));
        }
        Ok(lease)
    }

    /// Abandon the runtime process before releasing a dropped sign-in request.
    pub(crate) fn cancel_on_drop(mut self, control: ComputerControl, harness: HarnessId) -> Self {
        self.cancel = Some((control, harness));
        self
    }

    /// Release only our own lease after its runtime result and mode write.
    pub(crate) async fn release(mut self) -> Result<(), ComputerRouteError> {
        release_account_lease(&mut self.connection, &self.key, &self.token).await?;
        self.released = true;
        Ok(())
    }
}

impl Drop for AccountChange {
    fn drop(&mut self) {
        if self.released {
            return;
        }
        let mut connection = self.connection.clone();
        let key = self.key.clone();
        let token = self.token.clone();
        let cancel = self.cancel.take();
        self.cleanup.spawn(async move {
            if let Some((control, harness)) = cancel
                && let Err(error) = control.send(harness, ComputerCommand::ClaudeSignInCancel).await {
                tracing::warn!(error = ?error, "could not cancel the abandoned sign-in");
            }
            if let Err(error) = release_account_lease(&mut connection, &key, &token).await {
                tracing::error!(error = ?error, "could not release the abandoned account lease");
            }
        }.instrument(tracing::Span::current()));
    }
}

async fn release_account_lease(
    connection: &mut MultiplexedConnection,
    key: &str,
    token: &str,
) -> Result<(), ComputerRouteError> {
    const RELEASE: &str = "if redis.call('GET', KEYS[1]) == ARGV[1] then redis.call('DEL', KEYS[1]); redis.call('PUBLISH', KEYS[1] .. '.released', ARGV[1]); return 1 else return 0 end";
    redis::cmd("EVAL")
        .arg(RELEASE)
        .arg(1)
        .arg(key)
        .arg(token)
        .query_async::<()>(connection)
        .await
        .map_err(redis_error)
}

/// Waits for the account operation observed before Cancel to finish its mode
/// write and lease release. Subscribing before GET avoids a missed release.
pub(crate) struct AccountChangeRelease {
    subscriber: redis::aio::PubSub,
    connection: MultiplexedConnection,
    key: String,
    token: Option<String>,
}

impl AccountChangeRelease {
    pub(crate) async fn watch(
        redis: &redis::Client,
        harness: HarnessId,
    ) -> Result<Self, ComputerRouteError> {
        let key = format!("agent-harness.computer-account.{harness}");
        let mut subscriber = redis.get_async_pubsub().await.map_err(redis_error)?;
        subscriber
            .subscribe(format!("{key}.released"))
            .await
            .map_err(redis_error)?;
        let mut connection = redis
            .get_multiplexed_async_connection()
            .await
            .map_err(redis_error)?;
        let token = connection.get(&key).await.map_err(redis_error)?;
        Ok(Self {
            subscriber,
            connection,
            key,
            token,
        })
    }

    pub(crate) async fn wait(mut self) -> Result<(), ComputerRouteError> {
        if self.token.is_none() {
            return Ok(());
        }
        let mut messages = self.subscriber.into_on_message();
        tokio::time::timeout(Duration::from_secs(15), async {
            loop {
                let current: Option<String> =
                    self.connection.get(&self.key).await.map_err(redis_error)?;
                if current != self.token {
                    return Ok(());
                }
                if messages.next().await.is_none() {
                    return Err(ComputerRouteError::Internal(rootcause::report!(
                        "account release subscription ended"
                    )));
                }
            }
        })
        .await
        .map_err(|_| ComputerRouteError::Timeout)?
    }
}

#[cfg(test)]
mod test;
