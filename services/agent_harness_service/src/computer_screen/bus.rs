//! Redis carriage for computer commands and screen bytes across replicas.
//!
//! Commands: `agent-harness.computer-control` carries `request`, `accepted`
//! and `answered` messages. The replica holding the harness's runtime
//! connection claims a request (`SET NX`, so a redial racing a displaced
//! socket runs it once), acknowledges it at once, and answers when macrod
//! does. A request nobody acknowledges within [`ACCEPT_TIMEOUT`] means the
//! computer is not connected anywhere.
//!
//! Screens: one channel per direction per stream, each message a tag byte
//! (`0` data, `1` closed) and the bytes. The viewer binds the stream to its
//! harness in `agent-harness.screen.<stream_id>.binding` before asking
//! macrod to dial; macrod's socket consumes the binding (`GETDEL`), so a
//! stream id opens one computer socket, for that harness only.

use std::pin::Pin;
use std::sync::Arc;
use std::time::Duration;

use agent_harness::inbound::runtime_gateway::GatewaySender;
use agent_harness::outbound::runtime_registry::RuntimeRegistry;
use agent_runtime_protocol::domain::schema::v0::{ComputerCommand, ComputerControlResult};
use dashmap::DashMap;
use futures::{Stream, StreamExt as _};
use harness_id::HarnessId;
use redis::aio::MultiplexedConnection;
use redis::{AsyncCommands as _, ExistenceCheck, SetExpiry, SetOptions};
use serde_json::{Map, Value};
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;
use tokio_util::task::TaskTracker;
use tracing::Instrument as _;
use uuid::Uuid;

use super::{ComputerRouteError, STREAM_BINDING_SECONDS};

const CONTROL_CHANNEL: &str = "agent-harness.computer-control";
/// How long the holding replica has to acknowledge a command.
const ACCEPT_TIMEOUT: Duration = Duration::from_secs(3);
const CLAIM_SECONDS: u64 = 300;
const RESUBSCRIBE_DELAY: Duration = Duration::from_secs(1);
const DATA: u8 = 0;
const CLOSED: u8 = 1;

/// How long macrod may take to answer each command.
fn command_timeout(command: &ComputerCommand) -> Duration {
    match command {
        ComputerCommand::ClaudeSignInStart => Duration::from_secs(45),
        ComputerCommand::ClaudeSignInComplete { .. } => Duration::from_secs(100),
        ComputerCommand::ClaudeSignOut => Duration::from_secs(15),
        ComputerCommand::ScreenOpen { .. } => Duration::from_secs(20),
    }
}

fn command_name(command: &ComputerCommand) -> &'static str {
    match command {
        ComputerCommand::ClaudeSignInStart => "claude_sign_in_start",
        ComputerCommand::ClaudeSignInComplete { .. } => "claude_sign_in_complete",
        ComputerCommand::ClaudeSignOut => "claude_sign_out",
        ComputerCommand::ScreenOpen { .. } => "screen_open",
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

/// One frame of a screen stream off the bus.
pub enum Frame {
    /// Bytes for this side's socket.
    Data(Vec<u8>),
    /// The other side ended the stream.
    Closed,
}

/// The bound stream as the viewer left it for macrod's socket.
#[derive(serde::Serialize, serde::Deserialize)]
struct Binding {
    harness: HarnessId,
    #[serde(default)]
    trace_context: Map<String, Value>,
}

/// One side of a screen stream on the bus.
pub struct ScreenRelay {
    pub publisher: MultiplexedConnection,
    pub incoming: Pin<Box<dyn Stream<Item = Frame> + Send>>,
    pub outgoing_channel: String,
    pub span: tracing::Span,
}

fn channel(stream_id: Uuid, direction: &str) -> String {
    format!("agent-harness.screen.{stream_id}.{direction}")
}

fn binding_key(stream_id: Uuid) -> String {
    format!("agent-harness.screen.{stream_id}.binding")
}

impl ScreenRelay {
    /// The viewer's side: bind the stream to `harness`, then listen for the
    /// computer's bytes before anyone asks macrod to send them.
    pub async fn open_viewer(
        redis: &redis::Client,
        stream_id: Uuid,
        harness: HarnessId,
        span: &tracing::Span,
    ) -> Result<Self, ComputerRouteError> {
        let mut publisher = redis
            .get_multiplexed_async_connection()
            .await
            .map_err(redis_error)?;
        let mut trace_context = Map::new();
        genai_telemetry::propagation::inject(span, &mut trace_context);
        let binding = serde_json::to_string(&Binding {
            harness,
            trace_context,
        })
        .map_err(|error| ComputerRouteError::Internal(rootcause::report!("{error}")))?;
        publisher
            .set_ex::<_, _, ()>(binding_key(stream_id), binding, STREAM_BINDING_SECONDS)
            .await
            .map_err(redis_error)?;
        let incoming = subscribe(redis, channel(stream_id, "down")).await?;
        Ok(Self {
            publisher,
            incoming,
            outgoing_channel: channel(stream_id, "up"),
            span: span.clone(),
        })
    }

    /// macrod's side: only for the harness the stream was bound to, once.
    pub async fn open_computer(
        redis: &redis::Client,
        stream_id: Uuid,
        harness: HarnessId,
    ) -> Result<Self, ComputerRouteError> {
        let mut publisher = redis
            .get_multiplexed_async_connection()
            .await
            .map_err(redis_error)?;
        let binding: Option<String> = publisher
            .get(binding_key(stream_id))
            .await
            .map_err(redis_error)?;
        let binding = binding
            .and_then(|binding| serde_json::from_str::<Binding>(&binding).ok())
            .ok_or_else(|| ComputerRouteError::NotFound("unknown screen stream".to_owned()))?;
        if binding.harness != harness {
            return Err(ComputerRouteError::Forbidden);
        }
        let consumed: Option<String> = publisher
            .get_del(binding_key(stream_id))
            .await
            .map_err(redis_error)?;
        if consumed.is_none() {
            return Err(ComputerRouteError::NotFound(
                "unknown screen stream".to_owned(),
            ));
        }
        let span = tracing::info_span!(
            "computer_screen.computer",
            harness_id = %harness,
            stream_id = %stream_id,
            bytes_to_computer = tracing::field::Empty,
            bytes_to_viewer = tracing::field::Empty,
            outcome = tracing::field::Empty,
        );
        genai_telemetry::propagation::set_parent(&span, Some(&binding.trace_context));
        let incoming = subscribe(redis, channel(stream_id, "up")).await?;
        Ok(Self {
            publisher,
            incoming,
            outgoing_channel: channel(stream_id, "down"),
            span,
        })
    }
}

async fn subscribe(
    redis: &redis::Client,
    channel: String,
) -> Result<Pin<Box<dyn Stream<Item = Frame> + Send>>, ComputerRouteError> {
    let mut subscriber = redis.get_async_pubsub().await.map_err(redis_error)?;
    subscriber.subscribe(&channel).await.map_err(redis_error)?;
    Ok(Box::pin(
        subscriber
            .into_on_message()
            .map(|message| decode_frame(message.get_payload_bytes())),
    ))
}

/// A bus payload as a frame; anything unreadable ends the stream.
pub(super) fn decode_frame(payload: &[u8]) -> Frame {
    match payload.split_first() {
        Some((&DATA, bytes)) => Frame::Data(bytes.to_vec()),
        _ => Frame::Closed,
    }
}

/// Publish bytes for the other side.
pub(crate) async fn publish_data(
    publisher: &mut MultiplexedConnection,
    channel: &str,
    bytes: &[u8],
) -> redis::RedisResult<()> {
    let mut payload = Vec::with_capacity(bytes.len() + 1);
    payload.push(DATA);
    payload.extend_from_slice(bytes);
    publisher.publish(channel, payload).await
}

/// Tell the other side the stream ended.
pub(crate) async fn publish_close(
    publisher: &mut MultiplexedConnection,
    channel: &str,
) -> redis::RedisResult<()> {
    publisher.publish(channel, vec![CLOSED]).await
}

/// Serializes account mutations through their database confirmation, across
/// replicas. A cancelled or unanswered command retains the lease until expiry:
/// macrod may still be finishing its side effect.
pub(super) struct AccountChange {
    connection: MultiplexedConnection,
    key: String,
    token: String,
}

impl AccountChange {
    pub(super) async fn claim(
        redis: &redis::Client,
        harness: HarnessId,
    ) -> Result<Self, ComputerRouteError> {
        let mut connection = redis
            .get_multiplexed_async_connection()
            .await
            .map_err(redis_error)?;
        let key = format!("agent-harness.computer-account.{harness}");
        let token = Uuid::now_v7().to_string();
        // Longer than the longest command deadline plus bus admission.
        const LEASE_SECONDS: u64 = 180;
        let acquired: Option<String> = connection
            .set_options(
                &key,
                &token,
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
        Ok(Self {
            connection,
            key,
            token,
        })
    }

    /// Release only our own lease after its runtime result and mode write.
    pub(super) async fn release(mut self) -> Result<(), ComputerRouteError> {
        const RELEASE: &str = "if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end";
        redis::cmd("EVAL")
            .arg(RELEASE)
            .arg(1)
            .arg(self.key)
            .arg(self.token)
            .query_async::<()>(&mut self.connection)
            .await
            .map_err(redis_error)
    }
}
